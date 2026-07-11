import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { StateEnvelope } from '@oh-ai-car-web/shared';
import { LiveMap } from '../../components/map/LiveMap.js';
import { VideoPanel } from '../../components/VideoPanel.js';
import { ButtonControl } from '../../controls/ButtonControl.js';
import { RockerControl } from '../../controls/RockerControl.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import type { TrackPoint } from '../../services/api.js';
import { ControlClient } from '../../services/controlClient.js';
import * as deviceClient from '../../services/deviceClient.js';

export function ConsolePage() {
  const { selectedDevice, selectedId } = useSelectedDevice();
  const gateway = useMemo(() => new ControlClient(), []);
  const [state, setState] = useState<StateEnvelope>({
    type: 'state',
    connected: false,
    target: null,
    ownsControl: false,
    controlAvailable: true,
    lastError: null,
  });
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'buttons' | 'rocker'>('buttons');
  const [leaseId, setLeaseId] = useState<string | null>(null);

  useEffect(() => gateway.onState((next) => {
    setState(next);
    if (next.lastError) setError(next.lastError);
  }), [gateway]);

  useEffect(() => () => gateway.close(), [gateway]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void deviceClient.track(selectedId)
      .then((next) => { if (!cancelled) setPoints(next); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const send = useCallback(async (command: string, payload: unknown) => {
    try {
      return await gateway.send(command, payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '命令发送失败');
      throw reason;
    }
  }, [gateway]);

  const sendBackground = useCallback((command: string, payload: unknown) => {
    void send(command, payload).catch(() => undefined);
  }, [send]);

  const connect = async () => {
    if (!selectedDevice) return;
    setStatus('正在连接设备…');
    setError(null);
    try {
      const session = await deviceClient.connectDevice(selectedDevice.id);
      try {
        await gateway.open();
        await gateway.send('connect', {
          host: session.host,
          tcpPort: session.tcpPort,
          videoPort: session.videoPort,
          vehicleId: selectedDevice.id,
          leaseToken: session.gatewayToken,
        });
        setLeaseId(session.leaseId ?? null);
        setStatus(`已连接 ${selectedDevice.name}`);
      } catch (gatewayError) {
        setStatus('设备会话已申请，但本地网关不可用');
        setError(gatewayError instanceof Error ? gatewayError.message : '网关连接失败');
      }
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : '连接失败');
    }
  };

  const disconnect = async () => {
    try { await gateway.send('disconnect', {}); } catch { /* best effort */ }
    setLeaseId(null);
    setStatus('已断开');
  };

  if (!selectedId || !selectedDevice) return <Navigate to="/fleet" replace />;

  const disabled = !state.connected || !state.ownsControl;

  return (
    <div className="page console-page">
      <header className="page-header">
        <div>
          <h1>控制台</h1>
          <p>{selectedDevice.name} · {selectedDevice.host}:{selectedDevice.tcpPort}</p>
        </div>
        <div className="button-row">
          {state.connected ? (
            <button type="button" className="danger" onClick={() => void disconnect()}>断开</button>
          ) : (
            <button type="button" className="primary" onClick={() => void connect()}>连接设备</button>
          )}
        </div>
      </header>
      {status && <p className="notice">{status}</p>}
      {error && <p className="error">{error}</p>}
      <div className="console-layout">
        <section className="panel console-map-panel">
          <LiveMap points={points} follow />
        </section>
        <aside className="console-side">
          <section className="panel">
            <div className="panel-heading">
              <h2>{selectedDevice.name}</h2>
              <span className={state.connected ? 'tag tag-success' : 'tag'}>
                {state.connected ? (state.ownsControl ? '已接管' : '已连接') : '未连接'}
              </span>
            </div>
            <p className="muted">电量/信号：占位 · 租约 {leaseId ? '有效' : '无'}</p>
            <div className="login-tabs" role="tablist">
              <button type="button" className={tab === 'buttons' ? 'login-tab-active' : undefined} onClick={() => setTab('buttons')}>方向按钮</button>
              <button type="button" className={tab === 'rocker' ? 'login-tab-active' : undefined} onClick={() => setTab('rocker')}>摇杆</button>
            </div>
          </section>
          <VideoPanel host={selectedDevice.host} port={selectedDevice.videoPort} />
          {tab === 'buttons' ? (
            <ButtonControl disabled={disabled} send={sendBackground} />
          ) : (
            <RockerControl disabled={disabled} send={sendBackground} />
          )}
          <section className="panel">
            <div className="button-row">
              <button type="button" disabled={disabled} onClick={() => sendBackground('photo', {})}>拍照</button>
              <button type="button" disabled={disabled} onClick={() => sendBackground('button', { direction: 'Stop' })}>停止</button>
              <button type="button" className="danger" disabled={disabled} onClick={() => sendBackground('button', { direction: 'Brake' })}>急停</button>
            </div>
            <p className="muted">松开摇杆自动停止</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
