import { useEffect, useState } from 'react';
import { FormModal } from '../../components/layout/FormModal.js';
import type { MapZone, Waypoint } from '../../services/api.js';
import * as mapClient from '../../services/mapClient.js';

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
  const [zones, setZones] = useState<MapZone[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [name, setName] = useState('');
  const [coordsText, setCoordsText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [layers, setLayers] = useState({ waypoints: true, zones: true, violations: true, track: false });

  const refresh = async () => {
    const [nextZones, nextWaypoints] = await Promise.all([mapClient.zones(), mapClient.waypoints()]);
    setZones(nextZones);
    setWaypoints(nextWaypoints);
  };

  useEffect(() => { void refresh().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : '加载失败')); }, []);

  const closeDrawer = () => {
    setAddOpen(false);
    setError('');
  };

  const addZone = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const coordinates = parseCoordinates(coordsText);
      if (coordinates.length < 3) throw new Error('多边形至少需要 3 个坐标点');
      await mapClient.createZone({ name: name.trim() || '未命名禁停区', type: 'no_parking', coordinates });
      setName('');
      setCoordsText('');
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
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '删除失败');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>全局地图</h1>
          <p>禁停区、航点与图层管理</p>
        </div>
        <button type="button" className="primary" onClick={() => setAddOpen(true)}>新增禁停区</button>
      </header>
      {message && <p className="notice">{message}</p>}
      {error && !addOpen && <p className="error">{error}</p>}
      <section className="panel filter-row">
        <label className="toggle"><input type="checkbox" checked={layers.waypoints} onChange={(e) => setLayers({ ...layers, waypoints: e.target.checked })} /><span />航点</label>
        <label className="toggle"><input type="checkbox" checked={layers.zones} onChange={(e) => setLayers({ ...layers, zones: e.target.checked })} /><span />禁停区</label>
        <label className="toggle"><input type="checkbox" checked={layers.violations} onChange={(e) => setLayers({ ...layers, violations: e.target.checked })} /><span />违规车辆</label>
        <label className="toggle"><input type="checkbox" checked={layers.track} onChange={(e) => setLayers({ ...layers, track: e.target.checked })} /><span />巡逻轨迹</label>
      </section>
      <section className="panel mt-16">
        <h2>禁停区列表</h2>
        {!layers.zones ? <div className="empty-state">图层已关闭</div> : zones.length === 0 ? (
          <div className="empty-state">
            <p>暂无禁停区</p>
            <button type="button" className="primary" onClick={() => setAddOpen(true)}>新增禁停区</button>
          </div>
        ) : (
          <table>
            <thead><tr><th>名称</th><th>点数</th><th>操作</th></tr></thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.id}>
                  <td>{zone.name}</td>
                  <td>{zone.coordinates?.length ?? 0}</td>
                  <td><button type="button" className="danger" onClick={() => void remove(zone.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </section>

      <FormModal open={addOpen} title="新增禁停区" onClose={closeDrawer}>
        <form className="stack-form" onSubmit={(event) => void addZone(event)}>
          <label>区域名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：东门禁停区" /></label>
          <label>
            坐标（每行 lng,lat）
            <textarea
              rows={8}
              value={coordsText}
              onChange={(e) => setCoordsText(e.target.value)}
              placeholder={'116.397428,39.90923\n116.397528,39.90933\n116.397628,39.90913'}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">保存</button>
        </form>
      </FormModal>
    </div>
  );
}
