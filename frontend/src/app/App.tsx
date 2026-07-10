import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConnectionConfig, StateEnvelope } from '@oh-ai-car-web/shared';
import { ConnectionSettings } from '../components/ConnectionSettings.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';
import { VideoPanel } from '../components/VideoPanel.js';
import { ButtonControl } from '../controls/ButtonControl.js';
import { MediaControls } from '../controls/MediaControls.js';
import { RockerControl } from '../controls/RockerControl.js';
import { TrackingToggle } from '../controls/TrackingToggle.js';
import { WheelSpeedControl } from '../controls/WheelSpeedControl.js';
import { ControlClient } from '../services/controlClient.js';
import { loadSettings, saveSettings } from '../services/settingsStorage.js';

export default function App() {
  const client = useMemo(() => new ControlClient(), []);
  const [config, setConfig] = useState<ConnectionConfig>(loadSettings);
  const [state, setState] = useState<StateEnvelope>({ type: 'state', connected: false, target: null, lastError: null });
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [speeds, setSpeeds] = useState({ l1: 0, l2: 0, r1: 0, r2: 0 });

  useEffect(() => client.onState((next) => { setState(next); if (next.lastError) setError(next.lastError); }), [client]);
  const send = useCallback((command: string, payload: unknown) => { client.send(command, payload).catch((reason: Error) => setError(reason.message)); }, [client]);
  useEffect(() => {
    const stop = () => { if (state.connected) send('button', { direction: 'Stop' }); };
    window.addEventListener('blur', stop); return () => window.removeEventListener('blur', stop);
  }, [send, state.connected]);
  useEffect(() => () => client.close(), [client]);

  const connect = async () => { try { saveSettings(config); await client.open(); await client.send('connect', config); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : '连接失败'); } };
  const disconnect = () => { send('disconnect', {}); setRecording(false); setTracking(false); };
  const changeConfig = (next: ConnectionConfig) => { setConfig(next); saveSettings(next); };
  const disabled = !state.connected;

  return <main><header><div><p className="eyebrow">OH AI CAR</p><h1>小车控制台</h1></div><ConnectionStatus connected={state.connected} error={error} target={state.target ? `${state.target.host}:${state.target.tcpPort}` : null} /></header>
    <div className="dashboard"><aside><ConnectionSettings config={config} disabled={state.connected} onChange={changeConfig} onConnect={connect} onDisconnect={disconnect} />
      <MediaControls disabled={disabled} recording={recording} setRecording={setRecording} send={send} /><TrackingToggle disabled={disabled} enabled={tracking} onChange={(enabled) => { setTracking(enabled); send('tracking', { enabled }); }} /></aside>
      <section className="control-area"><VideoPanel host={config.host} port={config.videoPort} /><div className="control-grid"><ButtonControl disabled={disabled} send={send} /><RockerControl disabled={disabled} send={send} /><WheelSpeedControl disabled={disabled} speeds={speeds} onChange={setSpeeds} send={send} /></div></section>
    </div></main>;
}
