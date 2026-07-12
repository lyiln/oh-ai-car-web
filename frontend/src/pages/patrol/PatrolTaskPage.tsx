import { useEffect, useState } from 'react';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import type { PatrolRoute, PatrolTask } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';
import * as patrolClient from '../../services/patrolClient.js';

export function PatrolTaskPage() {
  const { devices, selectedId, setSelectedId } = useSelectedDevice();
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [routeId, setRouteId] = useState('');
  const [shift, setShift] = useState('morning');
  const [whitelistCount, setWhitelistCount] = useState(0);
  const [status, setStatus] = useState<PatrolTask | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (deviceId?: string | null) => {
    const next = await patrolClient.status(deviceId ?? undefined);
    setStatus(next);
    if (next?.id) {
      const nextEvents = await patrolClient.events(next.id);
      setEvents(nextEvents.slice(0, 10).map((event) => `${new Date(event.occurredAt).toLocaleTimeString()} ${event.plate ?? event.message ?? event.verdict ?? '事件'}`));
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [nextRoutes, list] = await Promise.all([
          patrolClient.routes(selectedId),
          opsClient.whitelist(),
        ]);
        setRoutes(nextRoutes);
        setRouteId(nextRoutes[0]?.id ?? '');
        setWhitelistCount(list.length);
        await refresh(selectedId);
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : '巡检配置加载失败');
        setRoutes([]);
        setRouteId('');
      }
    })();
  }, [selectedId]);

  const start = async () => {
    if (!selectedId || !routeId) return;
    if (whitelistCount <= 0) {
      setMessage('白名单为空，禁止启动巡检');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const task = await patrolClient.start({ deviceId: selectedId, routeId, shift });
      setStatus(task);
      setMessage('巡检已启动');
      await refresh(selectedId);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '启动失败');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await patrolClient.stop(selectedId ?? undefined);
      setMessage('已发送停止指令');
      await refresh(selectedId);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '停止失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>巡检任务</h1>
          <p>下发并监控巡逻任务</p>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      <div className="split-grid">
        <section className="panel stack-form">
          <h2>任务配置</h2>
          <label>
            选择设备
            <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)}>
              <option value="">请选择</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </label>
          <label>
            路线方案
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
            </select>
          </label>
          <label>
            班次
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="morning">早班</option>
              <option value="noon">午班</option>
              <option value="evening">晚班</option>
            </select>
          </label>
          <p>
            白名单检查：
            <span className={whitelistCount > 0 ? 'tag tag-success' : 'tag tag-danger'}>
              已导入 {whitelistCount} 条
            </span>
          </p>
          <div className="button-row">
            <button type="button" className="primary" disabled={busy || !selectedId} onClick={() => void start()}>开始巡检</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void stop()}>停止巡检</button>
          </div>
        </section>
        <section className="panel">
          <h2>任务状态</h2>
          {!status ? (
            <div className="empty-state">空闲</div>
          ) : (
            <>
              <dl className="status-dl">
                <dt>状态</dt><dd><span className="tag tag-info">{status.status}</span></dd>
                <dt>当前航点</dt><dd>{status.currentWaypoint ?? '-'}</dd>
                <dt>进度</dt><dd>{status.waypointDone ?? 0}/{status.waypointTotal ?? 0}</dd>
                <dt>已识别</dt><dd>{status.recognizedCount ?? status.eventCount ?? 0}</dd>
              </dl>
              <h3>实时事件</h3>
              {events.length === 0 ? <div className="empty-state">暂无事件</div> : (
                <ul className="event-stream">{events.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
