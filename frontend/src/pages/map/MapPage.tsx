import { useEffect, useMemo, useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import { FloorMap, type FloorMapDestination } from '../../components/map/FloorMap.js';
import { VideoPanel } from '../../components/VideoPanel.js';
import { hasBasemap, type FloorMapMeta, type WorldPoint } from '../../lib/floormap.js';
import type { ResidentDestination } from '../../services/api.js';
import * as mapClient from '../../services/mapClient.js';
import * as responseClient from '../../services/responseClient.js';
import * as patrolClient from '../../services/patrolClient.js';
import * as gotoClient from '../../services/gotoClient.js';
import type { GotoGoal } from '../../services/gotoClient.js';
import * as navClient from '../../services/navClient.js';
import type { NavStatus } from '../../services/navClient.js';
import { usePoseStream } from '../../hooks/usePoseStream.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import { useAuth } from '../../contexts/AuthContext.js';

type MapMode = 'idle' | 'mark' | 'goto' | 'setPose' | 'zone';

function computeYaw(points: WorldPoint[], index: number): number {
  const from = points[index];
  const to = points[index + 1] ?? points[index - 1];
  if (!to || (to.x === from.x && to.y === from.y)) return 0;
  const forward = points[index + 1] ? to : from;
  const backward = points[index + 1] ? from : to;
  return Math.atan2(forward.y - backward.y, forward.x - backward.x);
}

function buildRouteYaml(points: WorldPoint[]): string {
  const lines = ['waypoints:'];
  points.forEach((point, index) => {
    const yaw = computeYaw(points, index);
    lines.push(
      `  - { name: "点${index + 1}", x: ${point.x.toFixed(3)}, y: ${point.y.toFixed(3)}, yaw: ${yaw.toFixed(4)}, dwellSeconds: 8 }`,
    );
  });
  return lines.join('\n');
}

function readImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onload = () => resolve({ dataUrl, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('无法解析图片尺寸'));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function MapPage() {
  const { selectedId, selectedDevice } = useSelectedDevice();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [meta, setMeta] = useState<FloorMapMeta | null>(null);
  const [destinations, setDestinations] = useState<FloorMapDestination[]>([]);
  const [mode, setMode] = useState<MapMode>('idle');
  const [pendingPoints, setPendingPoints] = useState<WorldPoint[]>([]);
  const [activeGoal, setActiveGoal] = useState<GotoGoal | null>(null);
  const [navStatus, setNavStatus] = useState<NavStatus | null>(null);
  const [lastInitialPose, setLastInitialPose] = useState<{ x: number; y: number; yaw: number } | null>(null);
  const [floorZones, setFloorZones] = useState<mapClient.FloorMapZone[]>([]);
  const [draftZone, setDraftZone] = useState<WorldPoint[]>([]);
  const [zoneName, setZoneName] = useState('禁停区');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [routeMapVersion, setRouteMapVersion] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({ mapVersion: 'floor-map-v1', resolution: '0.05', originX: '0', originY: '0', originYaw: '0' });
  const [uploadImage, setUploadImage] = useState<{ dataUrl: string; width: number; height: number } | null>(null);

  const { pose, trail, connected, clearTrail, seedPose } = usePoseStream(selectedId);

  const refresh = async () => {
    const [nextMeta, nextDestinations, nextGoal, nextNav, nextZones] = await Promise.all([
      mapClient.basemap(selectedId),
      selectedId ? responseClient.destinations(selectedId) : Promise.resolve([] as ResidentDestination[]),
      selectedId ? gotoClient.activeGoto(selectedId) : Promise.resolve(null),
      selectedId ? navClient.navStatus(selectedId) : Promise.resolve(null),
      selectedId ? mapClient.floorZones(selectedId) : Promise.resolve([] as mapClient.FloorMapZone[]),
    ]);
    setMeta(nextMeta);
    setDestinations(nextDestinations.map((item) => ({ id: item.id, displayName: item.displayName, x: item.x, y: item.y })));
    setActiveGoal(nextGoal);
    setNavStatus(nextNav);
    setFloorZones(nextMeta?.mapVersion
      ? nextZones.filter((zone) => zone.mapVersion === nextMeta.mapVersion)
      : nextZones);
    if (nextMeta?.mapVersion && !routeMapVersion) setRouteMapVersion(nextMeta.mapVersion);
  };

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads selectedId directly
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const timer = window.setInterval(() => {
      void Promise.all([
        gotoClient.activeGoto(selectedId).then(setActiveGoal),
        navClient.navStatus(selectedId).then(setNavStatus),
      ]).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  const enterGotoMode = async () => {
    if (!selectedId) {
      setError('请先选择设备');
      return;
    }
    setError('');
    setPendingPoints([]);
    setMode('goto');
    try {
      const status = await navClient.prepareNav(selectedId);
      setNavStatus(status);
      setMessage(
        status.ready
          ? '导航已就绪：可点地图前往。若车位不准，先用「设初始位」。'
          : '已请求车上准备导航，请等待就绪指示灯变绿（需 Jetson 上运行 nav_supervisor）',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '准备导航失败');
    }
  };

  const onMapClick = (world: WorldPoint) => {
    if (mode === 'mark') {
      setPendingPoints((current) => [...current, world]);
      return;
    }
    if (mode === 'zone') {
      setDraftZone((current) => [...current, world]);
      setMessage(`禁停区顶点 ${draftZone.length + 1}（至少 3 点，双击或点「完成禁停区」闭合）`);
      return;
    }
    if (mode === 'goto') {
      if (!selectedId) return setError('请先选择设备');
      if (navStatus && !navStatus.ready) {
        setError(`导航未就绪：${navStatus.detail || '等待车上 supervisor'}`);
        return;
      }
      const yaw = pose ? Math.atan2(world.y - pose.y, world.x - pose.x) : 0;
      void gotoClient
        .createGoto(selectedId, { x: world.x, y: world.y, yaw })
        .then((goal) => {
          setActiveGoal(goal);
          setError('');
          setMessage(`已下发前往目标 (${world.x.toFixed(2)}, ${world.y.toFixed(2)})`);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '下发前往失败'));
    }
  };

  const finishZone = async () => {
    if (!selectedId || !meta) return setError('请先选择设备并加载底图');
    if (draftZone.length < 3) return setError('禁停区至少需要 3 个顶点');
    setError('');
    try {
      await mapClient.createFloorZone(selectedId, {
        name: zoneName.trim() || '禁停区',
        mapVersion: meta.mapVersion,
        ring: draftZone.map((point) => [point.x, point.y] as [number, number]),
      });
      setDraftZone([]);
      setMode('idle');
      setMessage('禁停区已保存；控制台识别提交违规时会用小车位姿判定是否在区内');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存禁停区失败');
    }
  };

  const removeFloorZone = async (zoneId: string) => {
    if (!selectedId) return;
    try {
      await mapClient.deleteFloorZone(selectedId, zoneId);
      setMessage('已删除禁停区');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  useEffect(() => {
    const onRejected = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      setError(detail?.reason || '初始位设置无效');
    };
    window.addEventListener('floormap-pose-estimate-rejected', onRejected);
    return () => window.removeEventListener('floormap-pose-estimate-rejected', onRejected);
  }, []);

  const onPoseEstimate = (estimate: { x: number; y: number; yaw: number }) => {
    if (!selectedId) return setError('请先选择设备');
    void (async () => {
      try {
        // 设位前先清掉活跃前往，否则错误初始位会触发 Nav2 recovery 原地转圈。
        if (activeGoal) {
          await gotoClient.cancelGoto(selectedId, { force: true });
          setActiveGoal(null);
        }
        const status = await navClient.setInitialPose(selectedId, estimate);
        setNavStatus(status);
        setLastInitialPose(estimate);
        // 立刻把红三角放到设位点，并清空旧轨迹（不等 AMCL/代理回传）。
        seedPose(estimate);
        setError('');
        const deg = ((estimate.yaw * 180) / Math.PI).toFixed(0);
        setMessage(
          `已下发初始位姿 x=${estimate.x.toFixed(2)} y=${estimate.y.toFixed(2)} 朝向=${deg}°（请等车标稳定后再前往）`,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '设置初始位失败');
      }
    })();
  };

  const clearPending = () => setPendingPoints([]);
  const undoPending = () => setPendingPoints((current) => current.slice(0, -1));

  const openSaveModal = () => {
    if (pendingPoints.length < 3 || pendingPoints.length > 8) {
      setError('巡航路线需要 3 到 8 个航点');
      return;
    }
    setError('');
    setRouteName(`楼道巡航 ${new Date().toLocaleString()}`);
    setRouteMapVersion((current) => current || meta?.mapVersion || 'floor-map-v1');
    setSaveOpen(true);
  };

  const saveRoute = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!selectedId) return setError('请先选择设备');
    try {
      await patrolClient.importRoute(selectedId, {
        name: routeName.trim() || '楼道巡航路线',
        mapVersion: routeMapVersion.trim() || meta?.mapVersion || 'floor-map-v1',
        yaml: buildRouteYaml(pendingPoints),
      });
      setSaveOpen(false);
      setMode('idle');
      setPendingPoints([]);
      setMessage('巡航路线已保存，可在巡检任务中启动');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存路线失败');
    }
  };

  const cancelGoto = async () => {
    if (!selectedId) return;
    try {
      const stuck = activeGoal?.status === 'cancellation_requested';
      await gotoClient.cancelGoto(selectedId, { force: stuck });
      setMessage(stuck ? '已强制结束前往' : '已请求取消前往');
      setActiveGoal(await gotoClient.activeGoto(selectedId));
    } catch (reason) {
      // 普通取消失败时再强制一次（代理离线导致卡死）
      try {
        await gotoClient.cancelGoto(selectedId, { force: true });
        setMessage('已强制结束前往');
        setActiveGoal(await gotoClient.activeGoto(selectedId));
        setError('');
      } catch {
        setError(reason instanceof Error ? reason.message : '取消失败');
      }
    }
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setUploadImage(await readImageFile(file));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取图片失败');
    }
  };

  const uploadBasemap = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!uploadImage) return setError('请先选择楼道底图 PNG');
    try {
      const next = await mapClient.uploadBasemap({
        vehicleId: selectedId ?? undefined,
        mapVersion: uploadForm.mapVersion.trim() || 'floor-map-v1',
        resolution: Number(uploadForm.resolution),
        originX: Number(uploadForm.originX),
        originY: Number(uploadForm.originY),
        originYaw: Number(uploadForm.originYaw),
        imageWidth: uploadImage.width,
        imageHeight: uploadImage.height,
        imageDataUrl: uploadImage.dataUrl,
      });
      setMeta(next);
      setUploadOpen(false);
      setUploadImage(null);
      setMessage('楼道底图已更新');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '底图上传失败');
    }
  };

  const poseText = useMemo(() => {
    if (!pose) return '暂无位姿（设初始位后应出现三角车标）';
    const deg = ((pose.yaw * 180) / Math.PI).toFixed(0);
    return `x=${pose.x.toFixed(2)}m, y=${pose.y.toFixed(2)}m, 朝向=${deg}°`;
  }, [pose]);

  const ready = hasBasemap(meta);
  const clickable = mode === 'mark' || mode === 'goto' || mode === 'zone';
  const navReady = Boolean(navStatus?.ready);

  return (
    <div className="page map-page">
      <header className="page-header">
        <div>
          <h1>楼道地图</h1>
          <p>设初始位请按住拖出朝向箭头（对准真实车头）→ 前往模式 → 先点近处目标</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className={mode === 'setPose' ? 'primary' : 'secondary'}
            disabled={!ready || !selectedId}
            onClick={() => {
              setMode((value) => (value === 'setPose' ? 'idle' : 'setPose'));
              setPendingPoints([]);
            }}
          >
            {mode === 'setPose' ? '退出设位' : '设初始位'}
          </button>
          <button
            type="button"
            className={mode === 'goto' ? 'primary' : 'secondary'}
            disabled={!ready || !selectedId}
            onClick={() => {
              if (mode === 'goto') setMode('idle');
              else void enterGotoMode();
            }}
          >
            {mode === 'goto' ? '退出前往' : '前往模式'}
          </button>
          <button
            type="button"
            className={mode === 'mark' ? 'primary' : 'secondary'}
            disabled={!ready}
            onClick={() => {
              setMode((value) => (value === 'mark' ? 'idle' : 'mark'));
              setDraftZone([]);
            }}
          >
            {mode === 'mark' ? '退出标点' : '标点模式'}
          </button>
          {isAdmin && (
            <button
              type="button"
              className={mode === 'zone' ? 'primary' : 'secondary'}
              disabled={!ready || !selectedId}
              onClick={() => {
                setMode((value) => (value === 'zone' ? 'idle' : 'zone'));
                setPendingPoints([]);
                setDraftZone([]);
                setMessage(mode === 'zone' ? '' : '单击加点，至少 3 点后双击或点「完成禁停区」');
              }}
            >
              {mode === 'zone' ? '退出绘制禁停' : '绘制禁停区'}
            </button>
          )}
          {mode === 'zone' && (
            <>
              <input
                value={zoneName}
                onChange={(event) => setZoneName(event.target.value)}
                placeholder="禁停区名称"
                style={{ maxWidth: 140 }}
              />
              <button type="button" className="secondary" disabled={draftZone.length < 3} onClick={() => void finishZone()}>
                完成禁停区
              </button>
              <button type="button" className="secondary" disabled={!draftZone.length} onClick={() => setDraftZone((c) => c.slice(0, -1))}>
                撤销顶点
              </button>
            </>
          )}
          <button type="button" className="secondary" disabled={!pendingPoints.length} onClick={undoPending}>撤销</button>
          <button type="button" className="secondary" disabled={!pendingPoints.length} onClick={clearPending}>清除标点</button>
          <button
            type="button"
            className="secondary"
            disabled={trail.length <= 1}
            onClick={() => {
              clearTrail();
              setMessage('已清除轨迹（保留当前车标）');
            }}
          >
            清除轨迹
          </button>
          <button type="button" className="primary" disabled={pendingPoints.length < 3} onClick={openSaveModal}>保存为巡航路线</button>
          <button type="button" className="secondary" disabled={!activeGoal || !selectedId} onClick={() => void cancelGoto()}>取消前往</button>
          {isAdmin && <button type="button" className="secondary" onClick={() => setUploadOpen(true)}>上传底图</button>}
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="global-map-layout">
        <section className="global-map floor-map">
          <div className="global-map-toolbar">
            <span>
              {ready ? `${meta?.name ?? '楼道地图'} · ${meta?.mapVersion}` : '未配置底图'}
              {mode === 'mark' ? ' · 点击添加巡航航点' : ''}
              {mode === 'goto' ? ' · 点击地图下发单点前往' : ''}
              {mode === 'setPose' ? ' · 按下定点，拖拽调朝向，松开提交' : ''}
            </span>
            <span className={navReady ? 'tag tag-success' : 'tag tag-info'}>{navReady ? '导航就绪' : '导航未就绪'}</span>
            <span className={navStatus?.supervisorOnline ? 'tag tag-success' : 'tag tag-info'}>
              {navStatus?.supervisorOnline ? '车上代理在线' : '车上代理离线'}
            </span>
            <span className={pose ? 'tag tag-success' : 'tag tag-info'}>{pose ? '车标可见' : '等待位姿'}</span>
          </div>
          {ready && meta ? (
            <FloorMap
              meta={meta}
              destinations={destinations}
              pose={pose}
              trail={trail}
              pendingPoints={pendingPoints}
              goal={activeGoal}
              initialPose={lastInitialPose}
              zones={floorZones.map((zone) => ({
                id: zone.id,
                name: zone.name,
                active: zone.active,
                ring: zone.ring.map(([x, y]) => ({ x, y })),
              }))}
              draftZone={draftZone}
              clickable={clickable}
              poseEstimate={mode === 'setPose'}
              onMapClick={onMapClick}
              onMapDoubleClick={() => {
                if (mode === 'zone' && draftZone.length >= 3) void finishZone();
              }}
              onPoseEstimate={onPoseEstimate}
            />
          ) : (
            <div className="empty-state">
              <p>尚未配置楼道底图。</p>
              {isAdmin ? <button type="button" className="primary" onClick={() => setUploadOpen(true)}>上传楼道底图</button> : <p className="muted">请管理员在此上传 map.pgm 转出的 PNG 与 map.yaml 参数。</p>}
            </div>
          )}
        </section>

        <aside className="global-map-side panel">
          {selectedDevice && selectedDevice.host ? (
            <VideoPanel host={selectedDevice.host} port={selectedDevice.videoPort} />
          ) : (
            <div className="empty-state">选择设备后显示视频</div>
          )}
          <h3 className="mt-16">导航就绪</h3>
          <dl className="status-dl">
            <dt>代理</dt><dd>{navStatus?.supervisorOnline ? '在线' : '离线'}</dd>
            <dt>位姿桥</dt><dd>{navStatus?.poseOk ? 'OK' : '—'}</dd>
            <dt>前往调度</dt><dd>{navStatus?.gotoOk ? 'OK' : '—'}</dd>
            <dt>Nav2</dt><dd>{navStatus?.nav2Ok ? 'OK' : '—'}</dd>
            <dt>Bringup</dt><dd>{navStatus?.bringupOk ? 'OK' : '—'}</dd>
            <dt>说明</dt><dd className="muted">{navStatus?.detail || '点「前往模式」会请求准备'}</dd>
          </dl>

          <h3 className="mt-16">小车状态</h3>
          <dl className="status-dl">
            <dt>位姿通道</dt><dd>{connected ? '在线' : '离线'}</dd>
            <dt>位姿</dt><dd>{poseText}</dd>
            <dt>轨迹点</dt><dd>{trail.length}</dd>
            <dt>前往目标</dt>
            <dd>
              {activeGoal
                ? `${activeGoal.status} (${activeGoal.x.toFixed(2)}, ${activeGoal.y.toFixed(2)})`
                : '无'}
            </dd>
            <dt>待保存标点</dt><dd>{pendingPoints.length}</dd>
          </dl>

          <h3 className="mt-16">楼道禁停区</h3>
          {floorZones.length === 0 ? (
            <p className="muted">暂无。管理员可点「绘制禁停区」在底图上框选。</p>
          ) : (
            <ul className="event-stream">
              {floorZones.map((zone) => (
                <li key={zone.id}>
                  {zone.name}（{zone.ring.length} 点）
                  {isAdmin && (
                    <>
                      {' '}
                      <button type="button" className="secondary" onClick={() => void removeFloorZone(zone.id)}>删除</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-16">一层住户目的地</h3>
          {destinations.length === 0 ? <div className="empty-state">当前设备暂无住户目的地</div> : (
            <ul className="event-stream">
              {destinations.map((destination) => (
                <li key={destination.id}>{destination.displayName}（{destination.x.toFixed(2)}, {destination.y.toFixed(2)}）</li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <FormModal open={saveOpen} title="保存为巡航路线" onClose={() => setSaveOpen(false)}>
        <form className="stack-form" onSubmit={(event) => void saveRoute(event)}>
          <p className="muted">共 {pendingPoints.length} 个航点，将保存为可启动的巡检路线。</p>
          <label>路线名称<input value={routeName} onChange={(e) => setRouteName(e.target.value)} required /></label>
          <label>地图版本<input value={routeMapVersion} onChange={(e) => setRouteMapVersion(e.target.value)} placeholder="floor-map-v1" required /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">保存路线</button>
        </form>
      </FormModal>

      <FormModal open={uploadOpen} title="上传楼道底图" onClose={() => setUploadOpen(false)}>
        <form className="stack-form" onSubmit={(event) => void uploadBasemap(event)}>
          <p className="muted">上传 map.pgm 转出的 PNG，并填入 map.yaml 的 resolution 与 origin。{selectedId ? '将绑定当前设备。' : '将作为全局默认底图。'}</p>
          <label>底图 PNG<input type="file" accept="image/png,image/jpeg" onChange={(e) => void onPickImage(e.target.files?.[0])} required /></label>
          {uploadImage && <p className="muted">图片尺寸：{uploadImage.width} × {uploadImage.height}px</p>}
          <label>地图版本<input value={uploadForm.mapVersion} onChange={(e) => setUploadForm({ ...uploadForm, mapVersion: e.target.value })} required /></label>
          <label>分辨率 resolution（米/像素）<input type="number" step="any" value={uploadForm.resolution} onChange={(e) => setUploadForm({ ...uploadForm, resolution: e.target.value })} required /></label>
          <label>原点 origin X（米）<input type="number" step="any" value={uploadForm.originX} onChange={(e) => setUploadForm({ ...uploadForm, originX: e.target.value })} required /></label>
          <label>原点 origin Y（米）<input type="number" step="any" value={uploadForm.originY} onChange={(e) => setUploadForm({ ...uploadForm, originY: e.target.value })} required /></label>
          <label>原点朝向 yaw（弧度）<input type="number" step="any" value={uploadForm.originYaw} onChange={(e) => setUploadForm({ ...uploadForm, originYaw: e.target.value })} /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">上传底图</button>
        </form>
      </FormModal>
    </div>
  );
}
