import { RotateCcw } from 'lucide-react';
type Speeds = { l1: number; l2: number; r1: number; r2: number };

export function WheelSpeedControl({ disabled, speeds, onChange, send }: { disabled: boolean; speeds: Speeds; onChange: (speeds: Speeds) => void; send: (command: string, payload: unknown) => void }) {
  const update = (key: keyof Speeds, raw: string) => onChange({ ...speeds, [key]: Math.min(100, Math.max(-100, Number(raw))) });
  return <section className="panel"><h2>四轮速度</h2><div className="wheel-grid">{(['l1', 'l2', 'r1', 'r2'] as const).map((key) => <label key={key}>{key.toUpperCase()}<input aria-label={key} disabled={disabled} type="number" min="-100" max="100" value={speeds[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div>
    <div className="button-row"><button disabled={disabled} onClick={() => send('wheelSpeeds', speeds)}>更新</button><button className="secondary" disabled={disabled} title="全部归零" onClick={() => { const zero = { l1: 0, l2: 0, r1: 0, r2: 0 }; onChange(zero); send('wheelSpeeds', zero); }}><RotateCcw size={17} />归零</button></div>
  </section>;
}
