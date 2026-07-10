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
import { PlatformConsole } from './PlatformConsole.js';

export default function App() {
  const platformEnabled = import.meta.env.VITE_PLATFORM_ENABLED === 'true';
  const [classicMode, setClassicMode] = useState(!platformEnabled);
  if (!classicMode) return <PlatformConsole onClassic={() => setClassicMode(true)} />;
  const client = useMemo(() => new ControlClient(), []);
  const [config, setConfig] = useState<ConnectionConfig>(loadSettings);
  const [state, setState] = useState<StateEnvelope>({ type: 'state', connected: false, target: null, ownsControl: false, controlAvailable: true, lastError: null });
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const [trackingPending, setTrackingPending] = useState(false);
  const [speeds, setSpeeds] = useState({ l1: 0, l2: 0, r1: 0, r2: 0 });

  useEffect(() => client.onState((next) => {
    setState(next);
    if (!next.connected || !next.ownsControl) {
      setRecording(false);
      setTracking(false);
      setMediaPending(false);
      setTrackingPending(false);
    }
    if (next.lastError) setError(next.lastError);
  }), [client]);
  const send = useCallback(async (command: string, payload: unknown) => {
    try { return await client.send(command, payload); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '命令发送失败'); throw reason; }
  }, [client]);
  const sendBackground = useCallback((command: string, payload: unknown) => { void send(command, payload).catch(() => undefined); }, [send]);
  useEffect(() => {
    const stop = () => { if (state.connected) sendBackground('button', { direction: 'Stop' }); };
    window.addEventListener('blur', stop); return () => window.removeEventListener('blur', stop);
  }, [sendBackground, state.connected]);
  useEffect(() => () => client.close(), [client]);

  const connect = async () => { try { saveSettings(config); await client.open(); await client.send('connect', config); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : '连接失败'); } };
  const disconnect = () => { void send('disconnect', {}).catch(() => undefined).finally(() => { setRecording(false); setTracking(false); }); };
  const changeConfig = (next: ConnectionConfig) => { setConfig(next); saveSettings(next); };
  const takePhoto = async () => {
    setMediaPending(true);
    try { await send('photo', {}); }
    finally { setMediaPending(false); }
  };
  const toggleRecording = async () => {
    const next = !recording;
    setMediaPending(true);
    try { await send(next ? 'startRecording' : 'stopRecording', {}); setRecording(next); }
    finally { setMediaPending(false); }
  };
  const changeTracking = async (enabled: boolean) => {
    setTrackingPending(true);
    try { await send('tracking', { enabled }); setTracking(enabled); }
    finally { setTrackingPending(false); }
  };
  const disabled = !state.connected || !state.ownsControl;

  return <main><header><div><p className="eyebrow">OH AI CAR</p><h1>小车控制台</h1></div><ConnectionStatus connected={state.connected} ownsControl={state.ownsControl} controlAvailable={state.controlAvailable} error={error} target={state.target ? `${state.target.host}:${state.target.tcpPort}` : null} /></header>
    <div className="dashboard"><aside><ConnectionSettings config={config} configDisabled={state.connected && state.ownsControl} connectDisabled={state.connected || !state.controlAvailable} disconnectDisabled={!state.connected || !state.ownsControl} onChange={changeConfig} onConnect={connect} onDisconnect={disconnect} />
      <MediaControls disabled={disabled} pending={mediaPending} recording={recording} onPhoto={takePhoto} onToggleRecording={toggleRecording} /><TrackingToggle disabled={disabled} pending={trackingPending} enabled={tracking} onChange={changeTracking} /></aside>
      <section className="control-area"><VideoPanel host={config.host} port={config.videoPort} /><div className="control-grid"><ButtonControl disabled={disabled} send={sendBackground} /><RockerControl disabled={disabled} send={sendBackground} /><WheelSpeedControl disabled={disabled} speeds={speeds} onChange={setSpeeds} send={sendBackground} /></div></section>
    </div></main>;
}
