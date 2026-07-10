import { Camera, Circle, Square } from 'lucide-react';

export function MediaControls({ disabled, pending, recording, onPhoto, onToggleRecording }: { disabled: boolean; pending: boolean; recording: boolean; onPhoto: () => Promise<void>; onToggleRecording: () => Promise<void> }) {
  const unavailable = disabled || pending;
  return <section className="panel"><h2>媒体控制</h2><div className="tool-row"><button title="拍照" disabled={unavailable} onClick={() => { void onPhoto().catch(() => undefined); }}><Camera size={18} />拍照</button>
    <button title={recording ? '停止录像' : '开始录像'} disabled={unavailable} className={recording ? 'danger' : ''} onClick={() => { void onToggleRecording().catch(() => undefined); }}>{recording ? <Square size={18} /> : <Circle size={18} />}{recording ? '停止录像' : '开始录像'}</button></div>
  </section>;
}
