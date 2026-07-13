import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { ProbeResult, StateEnvelope } from '@oh-ai-car-web/shared';
import { LiveMap } from '../../components/map/LiveMap.js';
import { VideoPanel } from '../../components/VideoPanel.js';
import { ButtonControl } from '../../controls/ButtonControl.js';
import { MediaControls } from '../../controls/MediaControls.js';
import { RockerControl } from '../../controls/RockerControl.js';
import { TrackingToggle } from '../../controls/TrackingToggle.js';
import { WheelSpeedControl } from '../../controls/WheelSpeedControl.js';
import { useSelectedDevice } from '../../contexts/SelectedDeviceContext.js';
import type { TrackPoint } from '../../services/api.js';
import { ControlClient } from '../../services/controlClient.js';
import * as deviceClient from '../../services/deviceClient.js';

type ConnectStep = 'idle' | 'gateway' | 'lease' | 'probe' | 'tcp' | 'ready' | 'error';
type ControlTab = 'buttons' | 'rocker' | 'wheels';

function probeHint(probe: ProbeResult): string {
  switch (probe.status) {
    case 'REACHABLE': return `小车 TCP ${probe.host}:${probe.tcpPort} 可达`;
    case 'TIMEOUT': return `小车 TCP 探测超时（${probe.host}:${probe.tcpPort}）。请确认与小车同一局域网、IP/端口正确，且车端控制服务已启动。`;
    case 'REFUSED': return `小车拒绝连接（${probe.host}:${probe.tcpPort}）。请确认 TCP 端口为 6000 且车端服务在监听。`;
    default: return probe.message ?? `小车 TCP 探测失败（${probe.host}:${probe.tcpPort}）`;
  }
}

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
  const [tab, setTab] = useState<ControlTab>('buttons');
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [gatewayToken, setGatewayToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState<ConnectStep>('idle');
  const [gatewayReachable, setGatewayReachable] = useState(false);
  const [host, setHost] = useState('');
  const [tcpPort, setTcpPort] = useState(6000);
  const [videoPort, setVideoPort] = useState(6500);
  const [recording, setRecording] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const [trackingPending, setTrackingPending] = useState(false);
  const [speeds, setSpeeds] = useState({ l1: 0, l2: 0, r1: 0, r2: 0 });
  const [connecting, setConnecting] = useState(false);
  const leaseRef = useRef<{ leaseId: string; gatewayToken: string; host: string; tcpPort: number; videoPort: number } | null>(null);

  useEffect(() => {
    if (!selectedDevice) return;
    setHost(selectedDevice.host);
    setTcpPort(selectedDevice.tcpPort);
    setVideoPort(selectedDevice.videoPort);
  }, [selectedDevice]);

  useEffect(() => gateway.onState((next) => {
    setState(next);
    if (next.connected) setConnectStep('ready');
    if (!next.connected || !next.ownsControl) {
      setRecording(false);
      setTracking(false);
      setMediaPending(false);
      setTrackingPending(false);
    }
    if (next.lastError) setError(next.lastError);
  }), [gateway]);

  useEffect(() => () => {
    void (async () => {
      try { await gateway.send('disconnect', {}); } catch { /* best effort */ }
      const lease = leaseRef.current;
      if (lease) await deviceClient.releaseLease(lease.leaseId).catch(() => undefined);
      gateway.close();
    })();
  }, [gateway]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void deviceClient.track(selectedId)
      .then((next) => { if (!cancelled) setPoints(next); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await gateway.open();
        if (!cancelled) setGatewayReachable(true);
      } catch {
        if (!cancelled) setGatewayReachable(false);
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 8_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [gateway]);

  useEffect(() => {
    if (!leaseId || !gatewayToken || !state.connected || !state.ownsControl) return;
    const timer = window.setInterval(() => {
      void deviceClient.renewLease(leaseId).then(async (renewed) => {
        setExpiresAt(renewed.expiresAt);
        setGatewayToken(renewed.gatewayToken);
        leaseRef.current = {
          leaseId,
          gatewayToken: renewed.gatewayToken,
          host,
          tcpPort,
          videoPort,
        };
        await gateway.send('leaseRefresh', {
          host,
          tcpPort,
          videoPort,
          vehicleId: selectedId,
          leaseToken: renewed.gatewayToken,
        });
      }).catch(async () => {
        setStatus('控制租约续期失败，正在安全断开。');
        setError('租约已失效，请重新连接');
        try { await gateway.send('disconnect', {}); } catch { /* ignore */ }
        setLeaseId(null);
        setGatewayToken(null);
        setExpiresAt(null);
        leaseRef.current = null;
        setConnectStep('error');
      });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [leaseId, gatewayToken, state.connected, state.ownsControl, gateway, host, tcpPort, videoPort, selectedId]);

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

  useEffect(() => {
    const stop = () => {
      if (state.connected && state.ownsControl) sendBackground('button', { direction: 'Stop' });
    };
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, [sendBackground, state.connected, state.ownsControl]);

  const connect = async () => {
    if (!selectedDevice || !selectedId) return;
    setConnecting(true);
    setError(null);
    setStatus('');
    setConnectStep('gateway');
    try {
      setStatus('① 正在连接本地网关…');
      await gateway.open();
      setGatewayReachable(true);

      setConnectStep('lease');
      setStatus('② 正在申请控制租约…');
      const session = await deviceClient.connectDevice(selectedId, { host, tcpPort, videoPort });

      setConnectStep('probe');
      setStatus(`③ 正在探测小车 TCP ${session.host}:${session.tcpPort}…`);
      const probed = await gateway.send('probe', { host: session.host, tcpPort: session.tcpPort, timeoutMs: 2000 });
      if (!probed.probe || probed.probe.status !== 'REACHABLE') {
        const hint = probed.probe ? probeHint(probed.probe) : '小车 TCP 探测失败';
        setConnectStep('error');
        setError(hint);
        setStatus('探测失败，未建立控制连接');
        if (session.leaseId) await deviceClient.releaseLease(session.leaseId).catch(() => undefined);
        return;
      }

      setConnectStep('tcp');
      setStatus(`④ 正在连接小车 ${session.host}:${session.tcpPort}…`);
      await gateway.send('connect', {
        host: session.host,
        tcpPort: session.tcpPort,
        videoPort: session.videoPort,
        vehicleId: selectedDevice.id,
        leaseToken: session.gatewayToken,
      });

      setLeaseId(session.leaseId ?? null);
      setGatewayToken(session.gatewayToken ?? null);
      setExpiresAt(session.expiresAt ?? null);
      if (session.leaseId && session.gatewayToken) {
        leaseRef.current = {
          leaseId: session.leaseId,
          gatewayToken: session.gatewayToken,
          host: session.host,
          tcpPort: session.tcpPort,
          videoPort: session.videoPort,
        };
      }
      setHost(session.host);
      setTcpPort(session.tcpPort);
      setVideoPort(session.videoPort);
      setConnectStep('ready');
      setStatus(`已连接 ${selectedDevice.name}（${session.host}:${session.tcpPort}）`);
    } catch (reason) {
      setConnectStep('error');
      const message = reason instanceof Error ? reason.message : '连接失败';
      setError(message);
      if (message.includes('本地网关') || message.includes('gateway')) {
        setGatewayReachable(false);
        setStatus('本地网关不可用');
      } else if (message.includes('租约') || message.includes('lease') || message.includes('401') || message.includes('403') || message.includes('409')) {
        setStatus('租约申请失败');
      } else {
        setStatus('连接失败');
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try { await gateway.send('disconnect', {}); } catch { /* best effort */ }
    const currentLease = leaseId;
    if (currentLease) await deviceClient.releaseLease(currentLease).catch(() => undefined);
    setLeaseId(null);
    setGatewayToken(null);
    setExpiresAt(null);
    leaseRef.current = null;
    setConnectStep('idle');
    setStatus('已断开');
  };

  const takePhoto = async () => {
    setMediaPending(true);
    try { await send('photo', {}); }
    finally { setMediaPending(false); }
  };

  const toggleRecording = async () => {
    const next = !recording;
    setMediaPending(true);
    try {
      await send(next ? 'startRecording' : 'stopRecording', {});
      setRecording(next);
    } finally {
      setMediaPending(false);
    }
  };

  const changeTracking = async (enabled: boolean) => {
    setTrackingPending(true);
    try {
      await send('tracking', { enabled });
      setTracking(enabled);
    } finally {
      setTrackingPending(false);
    }
  };

  if (!selectedId || !selectedDevice) return <Navigate to="/fleet" replace />;

  const disabled = !state.connected || !state.ownsControl;
  const configLocked = state.connected && state.ownsControl;
  const leaseExpiringSoon = expiresAt
    ? new Date(expiresAt).getTime() - Date.now() < 25_000
    : false;

  return (
    <div className="page console-page">
      <header className="page-header">
        <div>
          <h1>控制台</h1>
          <p>{selectedDevice.name} · {host}:{tcpPort}</p>
        </div>
        <div className="button-row">
          {state.connected ? (
            <button type="button" className="danger" onClick={() => void disconnect()}>断开</button>
          ) : (
            <button type="button" className="primary" disabled={connecting} onClick={() => void connect()}>
              {connecting ? '连接中…' : '连接设备'}
            </button>
          )}
        </div>
      </header>

      <section className="panel console-env-bar" aria-label="环境检查">
        <span className={gatewayReachable ? 'tag tag-success' : 'tag tag-danger'}>
          网关 {gatewayReachable ? '已就绪' : '未连接'}
        </span>
        <span className={state.connected ? 'tag tag-success' : 'tag'}>
          小车 TCP {state.connected ? '已连接' : '未连接'}
        </span>
        <span className={leaseId ? (leaseExpiringSoon ? 'tag tag-warning' : 'tag tag-success') : 'tag'}>
          租约 {leaseId ? (leaseExpiringSoon ? '即将过期' : '有效') : '无'}
        </span>
        <span className="tag">步骤 {connectStep}</span>
      </section>

      <section className="panel connection-settings" aria-label="网络连接">
        <h2>网络连接（对齐 APP NetworkSettings）</h2>
        <div className="console-network-grid">
          <label>小车 IP
            <input
              aria-label="小车 IP"
              value={host}
              disabled={configLocked || connecting}
              onChange={(event) => setHost(event.target.value)}
            />
          </label>
          <label>TCP 端口
            <input
              aria-label="TCP 端口"
              type="number"
              min={1}
              max={65535}
              value={tcpPort}
              disabled={configLocked || connecting}
              onChange={(event) => setTcpPort(Number(event.target.value))}
            />
          </label>
          <label>视频端口
            <input
              aria-label="视频端口"
              type="number"
              min={1}
              max={65535}
              value={videoPort}
              disabled={configLocked || connecting}
              onChange={(event) => setVideoPort(Number(event.target.value))}
            />
          </label>
        </div>
        <p className="muted">默认取自设备档案；连接前可临时覆盖 IP/端口（与鸿蒙 APP 首屏一致）。需本机已启动 gateway。</p>
      </section>

      {status && <p className="notice">{status}</p>}
      {error && <p className="error">{error}</p>}
      {!gatewayReachable && (
        <p className="error">
          本地网关未就绪。请在操作电脑执行：
          <code>PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway</code>
        </p>
      )}

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
            <p className="muted">视频 http://{host}:{videoPort}/index2</p>
            <div className="login-tabs" role="tablist">
              <button type="button" className={tab === 'buttons' ? 'login-tab-active' : undefined} onClick={() => setTab('buttons')}>方向按钮</button>
              <button type="button" className={tab === 'rocker' ? 'login-tab-active' : undefined} onClick={() => setTab('rocker')}>摇杆</button>
              <button type="button" className={tab === 'wheels' ? 'login-tab-active' : undefined} onClick={() => setTab('wheels')}>麦轮</button>
            </div>
          </section>
          <VideoPanel host={host} port={videoPort} />
          <MediaControls
            disabled={disabled}
            pending={mediaPending}
            recording={recording}
            onPhoto={takePhoto}
            onToggleRecording={toggleRecording}
          />
          <TrackingToggle
            disabled={disabled}
            pending={trackingPending}
            enabled={tracking}
            onChange={changeTracking}
          />
          {tab === 'buttons' ? (
            <ButtonControl disabled={disabled} send={sendBackground} />
          ) : tab === 'rocker' ? (
            <RockerControl disabled={disabled} send={sendBackground} />
          ) : (
            <WheelSpeedControl disabled={disabled} speeds={speeds} onChange={setSpeeds} send={sendBackground} />
          )}
          <section className="panel">
            <div className="button-row">
              <button type="button" disabled={disabled} onClick={() => sendBackground('photo', {})}>拍照</button>
              <button type="button" disabled={disabled} onClick={() => sendBackground('button', { direction: 'Stop' })}>停止</button>
              <button type="button" className="danger" disabled={disabled} onClick={() => sendBackground('button', { direction: 'Brake' })}>急停</button>
            </div>
            <p className="muted">松开方向键 / 窗口失焦自动停止（对齐 APP）</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
