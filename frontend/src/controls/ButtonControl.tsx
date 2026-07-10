import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleStop, RotateCcw, RotateCw } from 'lucide-react';

type Send = (command: string, payload: unknown) => void;
const controls = [
  ['Front', '前进', ArrowUp], ['Left', '左移', ArrowLeft], ['Stop', '停止', CircleStop], ['Right', '右移', ArrowRight], ['After', '后退', ArrowDown], ['LeftRotate', '左旋', RotateCcw], ['RightRotate', '右旋', RotateCw], ['Brake', '刹车', CircleStop],
] as const;

export function ButtonControl({ disabled, send }: { disabled: boolean; send: Send }) {
  const stop = () => send('button', { direction: 'Stop' });
  return <section className="panel"><h2>方向控制</h2><div className="direction-grid">
    {controls.map(([direction, label, Icon]) => <button key={direction} title={label} disabled={disabled} className={direction === 'Stop' || direction === 'Brake' ? 'danger' : ''}
      onPointerDown={(event) => { send('button', { direction }); event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerUp={stop} onPointerCancel={stop}><Icon size={20} /><span>{label}</span></button>)}
  </div></section>;
}
