import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FormModal } from '../../components/layout/FormModal.js';
import { GlobalMap, type GlobalMapMode, type MapLayers } from '../../components/map/GlobalMap.js';
import type { MapZone, ResidentDestination, TrackPoint, Violation, Waypoint } from '../../services/api.js';
import * as deviceClient from '../../services/deviceClient.js';
import * as mapClient from '../../services/mapClient.js';
import * as opsClient from '../../services/opsClient.js';
import * as responseClient from '../../services/responseClient.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import { useAuth } from '../../contexts/AuthContext.js';

function parseCoordinates(text: string): Array<[number, number]> {
  return text
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [lngRaw, latRaw] = line.split(/[,，\s]+/);
      const lng = Number(lngRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`无效坐标：${line}`);
      return [lng, lat] as [number, number];
    });
}

export function MapPage() {
  const { selectedId } = useSelectedDevice();
  const { user } = useAuth();
  const [zones, setZones] = useState<MapZone[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [name, setName] = useState('');
  const [coordsText, setCoordsText] = useState('');
  const [pendingCoords, setPendingCoords] = useState<Array<[number, number]> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [destinations, setDestinations] = useState<ResidentDestination[]>([]);
  const [destinationForm, setDestinationForm] = useState({ building: '', displayName: '', mapVersion: '', x: '', y: '', yaw: '0' });
  const [layers, setLayers] = useState<MapLayers>({ waypoints: true, zones: true, violations: true, track: false });
  const [mode, setMode] = useState<GlobalMapMode>('view');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);

  const refresh = async () => {
    const [nextZones, nextWaypoints, nextDestinations, nextViolations] = await Promise.all([
      mapClient.zones(),
      mapClient.waypoints(),
      selectedId ? responseClient.destinations(selectedId) : Promise.resolve([]),
      opsClient.violations().catch(() => [] as Violation[]),
    ]);
    setZones(nextZones);
    setWaypoints(nextWaypoints);
    setDestinations(nextDestinations);
    setViolations(nextViolations);
    if (selectedId && layers.track) {
      setTrackPoints(await deviceClient.track(selectedId).catch(() => []));
    } else {
      setTrackPoints([]);
    }
  };

  useEffect(() => {
    void refresh().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : '加载失败'));
  }, [selectedId, layers.track]);

  const closeDrawer = () => {
    setAddOpen(false);
    setPendingCoords(null);
    setAdvancedOpen(false);
    setError('');
  };

  const openNameModal = (coordinates: Array<[number, number]>) => {
    if (coordinates.length < 3) {
      setError('多边形至少需要 3 个坐标点');
      return;
    }
    setPendingCoords(coordinates);
    setCoordsText(coordinates.map(([lng, lat]) => `${lng},${lat}`).join('\n'));
    setName('');
    setAddOpen(true);
    setAdvancedOpen(false);
  };

  const addZone = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const coordinates = pendingCoords ?? parseCoordinates(coordsText);
      if (coordinates.length < 3) throw new Error('多边形至少需要 3 个坐标点');
      await mapClient.createZone({ name: name.trim() || '未命名禁停区', type: 'no_parking', coordinates });
      setName('');
      setCoordsText('');
      setPendingCoords(null);
      setMessage('禁停区已保存');
      setAddOpen(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    }
  };

  const remove = async (id: string) => {
    try {
      await mapClient.deleteZone(id);
      if (selectedZoneId === id) setSelectedZoneId(null);
      setMessage('禁停区已删除');
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  const saveEditedZone = async (zoneId: string, coordinates: Array<[number, number]>) => {
    try {
      if (coordinates.length < 3) throw new Error('多边形至少需要 3 个坐标点');
      await mapClient.updateZone(zoneId, { coordinates });
      setMessage('禁停区已更新');
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '更新失败');
    }
  };

  const addDestination = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!selectedId) return setError('请先选择设备');
    try {
      await responseClient.createDestination({
        vehicleId: selectedId, building: destinationForm.building, displayName: destinationForm.displayName,
        mapVersion: destinationForm.mapVersion, x: Number(destinationForm.x), y: Number(destinationForm.y), yaw: Number(destinationForm.yaw),
      });
      setDestinationOpen(false); setDestinationForm({ building: '', displayName: '', mapVersion: '', x: '', y: '', yaw: '0' });
      setMessage('住户一层目的地已保存'); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '目的地保存失败'); }
  };

  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? null;

  return (
    <div className="page map-page">
      <header className="page-header">
        <div>
          <h1>全局地图</h1>
          <p>在地图上绘制禁停区多边形，管理航点、违规车辆与图层</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" disabled={!selectedId || user?.role !== 'admin'} onClick={() => setDestinationOpen(true)}>新增住户目的地</button>
          <button
            type="button"
            className="secondary"
            disabled={!selectedZoneId || mode === 'draw'}
            onClick={() => setMode('edit')}
          >
            编辑禁停区
          </button>
          <button
            type="button"
            className="danger"
            disabled={!selectedZoneId || mode !== 'view'}
            onClick={() => selectedZoneId && void remove(selectedZoneId)}
          >
            删除选中
          </button>
          <button
            type="button"
            className="primary"
            disabled={mode === 'draw'}
            onClick={() => { setSelectedZoneId(null); setMode('draw'); }}
          >
            绘制禁停区
          </button>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {error && !addOpen && <p className="error">{error}</p>}

      <section className="panel filter-row">
        <label className="toggle"><input type="checkbox" checked={layers.waypoints} onChange={(e) => setLayers({ ...layers, waypoints: e.target.checked })} /><span />航点</label>
        <label className="toggle"><input type="checkbox" checked={layers.zones} onChange={(e) => setLayers({ ...layers, zones: e.target.checked })} /><span />禁停区</label>
        <label className="toggle"><input type="checkbox" checked={layers.violations} onChange={(e) => setLayers({ ...layers, violations: e.target.checked })} /><span />违规车辆</label>
        <label className="toggle"><input type="checkbox" checked={layers.track} onChange={(e) => setLayers({ ...layers, track: e.target.checked })} /><span />巡逻轨迹</label>
        {selectedZone && <span className="tag tag-info">已选：{selectedZone.name}</span>}
      </section>

      <div className="global-map-layout">
        <GlobalMap
          zones={zones}
          waypoints={waypoints}
          violations={violations}
          trackPoints={trackPoints}
          layers={layers}
          mode={mode}
          selectedZoneId={selectedZoneId}
          onModeChange={setMode}
          onZoneDrawn={openNameModal}
          onZoneEdited={(zoneId, coordinates) => void saveEditedZone(zoneId, coordinates)}
          onZoneSelect={(zoneId) => { setSelectedZoneId(zoneId); setMode('view'); }}
          onViolationClick={setSelectedViolation}
        />

        <aside className="global-map-side panel">
          <h2>禁停区列表</h2>
          {!layers.zones ? <div className="empty-state">图层已关闭</div> : zones.length === 0 ? (
            <div className="empty-state">
              <p>暂无禁停区</p>
              <button type="button" className="primary" onClick={() => setMode('draw')}>绘制禁停区</button>
            </div>
          ) : (
            <ul className="zone-list">
              {zones.map((zone) => (
                <li key={zone.id} className={zone.id === selectedZoneId ? 'zone-list-active' : undefined}>
                  <button type="button" className="zone-list-item" onClick={() => setSelectedZoneId(zone.id)}>
                    <strong>{zone.name}</strong>
                    <small>{zone.coordinates?.length ?? 0} 个顶点</small>
                  </button>
                  <button type="button" className="danger" onClick={() => void remove(zone.id)}>删除</button>
                </li>
              ))}
            </ul>
          )}

          {layers.waypoints && (
            <>
              <h3 className="mt-16">航点</h3>
              {waypoints.length === 0 ? <div className="empty-state">暂无航点</div> : (
                <ul className="event-stream">
                  {waypoints.map((point) => (
                    <li key={point.id}>{point.name}（{point.longitude.toFixed(5)}, {point.latitude.toFixed(5)}）</li>
                  ))}
                </ul>
              )}
            </>
          )}

          <h3 className="mt-16">一层住户目的地</h3>
          {destinations.length === 0 ? <div className="empty-state">当前设备暂无住户目的地</div> : (
            <table>
              <thead><tr><th>楼栋</th><th>名称</th><th>地图版本</th><th>状态</th></tr></thead>
              <tbody>
                {destinations.map((destination) => (
                  <tr key={destination.id}>
                    <td>{destination.building}</td>
                    <td>{destination.displayName}</td>
                    <td>{destination.mapVersion}</td>
                    <td>{destination.active ? '启用' : '停用'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      </div>

      {selectedViolation && (
        <aside className="map-violation-drawer panel">
          <div className="panel-heading">
            <h2>{selectedViolation.plate || '未识别车牌'}</h2>
            <button type="button" className="secondary" onClick={() => setSelectedViolation(null)}>关闭</button>
          </div>
          <dl className="status-dl">
            <dt>类型</dt><dd>{selectedViolation.type}</dd>
            <dt>时间</dt><dd>{new Date(selectedViolation.occurredAt).toLocaleString()}</dd>
            <dt>禁停区</dt><dd>{selectedViolation.zoneName ?? '-'}</dd>
            <dt>航点</dt><dd>{selectedViolation.waypoint ?? '-'}</dd>
            <dt>优先级</dt><dd>{selectedViolation.priority ?? '-'}</dd>
            <dt>状态</dt><dd>{selectedViolation.status ?? '-'}</dd>
          </dl>
          {selectedViolation.evidenceUrl && (
            <img className="review-thumb" src={selectedViolation.evidenceUrl} alt="证据截图" />
          )}
          <div className="button-row">
            <Link className="primary" to="/reviews">去审核</Link>
          </div>
        </aside>
      )}

      <FormModal open={addOpen} title="保存禁停区" onClose={closeDrawer}>
        <form className="stack-form" onSubmit={(event) => void addZone(event)}>
          <label>区域名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：东门禁停区" /></label>
          {pendingCoords && <p className="muted">已从地图绘制 {pendingCoords.length} 个顶点</p>}
          <button type="button" className="secondary" onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? '收起高级模式' : '高级模式（手填坐标）'}
          </button>
          {advancedOpen && (
            <label>
              坐标（每行 lng,lat）
              <textarea
                rows={8}
                value={coordsText}
                onChange={(e) => { setCoordsText(e.target.value); setPendingCoords(null); }}
                placeholder={'116.397428,39.90923\n116.397528,39.90933\n116.397628,39.90913'}
                required={!pendingCoords}
              />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">保存</button>
        </form>
      </FormModal>
      <FormModal open={destinationOpen} title="新增一层住户目的地" onClose={() => setDestinationOpen(false)}>
        <form className="stack-form" onSubmit={(event) => void addDestination(event)}>
          <label>楼栋标识<input required value={destinationForm.building} onChange={(e) => setDestinationForm({ ...destinationForm, building: e.target.value })} placeholder="1号楼" /></label>
          <label>显示名称<input required value={destinationForm.displayName} onChange={(e) => setDestinationForm({ ...destinationForm, displayName: e.target.value })} placeholder="1号楼一层公共门口" /></label>
          <label>地图版本<input required value={destinationForm.mapVersion} onChange={(e) => setDestinationForm({ ...destinationForm, mapVersion: e.target.value })} placeholder="community-map-v1" /></label>
          <label>X<input required type="number" step="any" value={destinationForm.x} onChange={(e) => setDestinationForm({ ...destinationForm, x: e.target.value })} /></label>
          <label>Y<input required type="number" step="any" value={destinationForm.y} onChange={(e) => setDestinationForm({ ...destinationForm, y: e.target.value })} /></label>
          <label>Yaw<input required type="number" step="any" value={destinationForm.yaw} onChange={(e) => setDestinationForm({ ...destinationForm, yaw: e.target.value })} /></label>
          {error && <p className="error">{error}</p>}<button type="submit" className="primary">保存目的地</button>
        </form>
      </FormModal>
    </div>
  );
}
