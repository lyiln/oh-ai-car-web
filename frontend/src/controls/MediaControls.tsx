import { Camera, Circle, Square } from 'lucide-react';

export function MediaControls({ disabled, recording, setRecording, send }: { disabled: boolean; recording: boolean; setRecording: (value: boolean) => void; send: (command: string, payload: unknown) => void }) {
  return <section className="panel"><h2>媒体控制</h2><div className="tool-row"><button title="拍照" disabled={disabled} onClick={() => send('photo', {})}><Camera size={18} />拍照</button>
    <button title={recording ? '停止录像' : '开始录像'} disabled={disabled} className={recording ? 'danger' : ''} onClick={() => { send(recording ? 'stopRecording' : 'startRecording', {}); setRecording(!recording); }}>{recording ? <Square size={18} /> : <Circle size={18} />}{recording ? '停止录像' : '开始录像'}</button></div>
  </section>;
}
