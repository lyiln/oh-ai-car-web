import { useRef, useState } from 'react';
import { mapRockerPoint } from './rockerMath.js';

export function RockerControl({ disabled, send }: { disabled: boolean; send: (command: string, payload: unknown) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [point, setPoint] = useState({ left: 50, top: 50 });
  const move = (event: React.PointerEvent<HTMLDivElement>, force = false) => {
    if (disabled) return;
    const rect = board.current?.getBoundingClientRect(); if (!rect) return;
    const value = mapRockerPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    setPoint({ left: (value.left / rect.width) * 100, top: (value.top / rect.height) * 100 });
    if (force || performance.now() - last.current >= 100) { last.current = performance.now(); send('rocker', { x: value.x, y: value.y }); }
  };
  const release = () => { if (!disabled) send('rocker', { x: 0, y: 0 }); setPoint({ left: 50, top: 50 }); };
  return <section className="panel rocker-panel"><h2>摇杆控制</h2><div ref={board} className={`rocker-board${disabled ? ' disabled' : ''}`} aria-label="摇杆控制" onPointerDown={(event) => { if (!disabled) event.currentTarget.setPointerCapture?.(event.pointerId); move(event, true); }} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
    <span className="rocker-knob" style={{ left: `${point.left}%`, top: `${point.top}%` }} />
  </div><p>最大 10 Hz，松开即停止</p></section>;
}
