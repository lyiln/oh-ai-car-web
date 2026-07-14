import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleStop, RotateCcw, RotateCw } from 'lucide-react';

type Send = (command: string, payload: unknown) => void;
type Direction = 'Front' | 'After' | 'Left' | 'Right' | 'LeftRotate' | 'RightRotate' | 'Brake';

const keyboardDirections: Record<string, Direction> = {
  ArrowUp: 'Front', ArrowDown: 'After', ArrowLeft: 'Left', ArrowRight: 'Right',
};

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

export function ButtonControl({ disabled, send }: { disabled: boolean; send: Send }) {
  const pressedKey = useRef<string | null>(null);
  const stop = () => {
    if (pressedKey.current !== null) pressedKey.current = null;
    if (!disabled) send('button', { direction: 'Stop' });
  };
  const press = (direction: Direction) => send('button', { direction });

  useEffect(() => {
    if (disabled) { pressedKey.current = null; return; }
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyboardDirections[event.key];
      if (!direction || event.repeat || isTextInput(event.target) || pressedKey.current) return;
      event.preventDefault();
      pressedKey.current = event.key;
      press(direction);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (pressedKey.current !== event.key) return;
      event.preventDefault();
      stop();
    };
    const onVisibilityChange = () => { if (document.hidden && pressedKey.current) stop(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (pressedKey.current) stop();
    };
  }, [disabled, send]);

  const hold = (direction: Direction, event: React.PointerEvent<HTMLButtonElement>) => {
    press(direction);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  return <section className="panel"><h2>方向控制</h2><div className="direction-grid" aria-label="方向控制">
    <button type="button" title="前进" disabled={disabled} className="direction-front" onPointerDown={(event) => hold('Front', event)} onPointerUp={stop} onPointerCancel={stop}><ArrowUp size={20} /><span>前进</span></button>
    <button type="button" title="左移" disabled={disabled} className="direction-left" onPointerDown={(event) => hold('Left', event)} onPointerUp={stop} onPointerCancel={stop}><ArrowLeft size={20} /><span>左移</span></button>
    <button type="button" title="停止" disabled={disabled} className="direction-stop danger" onPointerDown={() => send('button', { direction: 'Stop' })}><CircleStop size={20} /><span>停止</span></button>
    <button type="button" title="右移" disabled={disabled} className="direction-right" onPointerDown={(event) => hold('Right', event)} onPointerUp={stop} onPointerCancel={stop}><ArrowRight size={20} /><span>右移</span></button>
    <button type="button" title="后退" disabled={disabled} className="direction-after" onPointerDown={(event) => hold('After', event)} onPointerUp={stop} onPointerCancel={stop}><ArrowDown size={20} /><span>后退</span></button>
  </div><div className="direction-actions">
    <button type="button" title="左旋" disabled={disabled} onPointerDown={(event) => hold('LeftRotate', event)} onPointerUp={stop} onPointerCancel={stop}><RotateCcw size={18} />左旋</button>
    <button type="button" title="右旋" disabled={disabled} onPointerDown={(event) => hold('RightRotate', event)} onPointerUp={stop} onPointerCancel={stop}><RotateCw size={18} />右旋</button>
    <button type="button" title="刹车" disabled={disabled} className="danger" onPointerDown={() => send('button', { direction: 'Brake' })}><CircleStop size={18} />刹车</button>
  </div><p className="muted">方向键可控制移动；松开、失焦或页面隐藏会停止。</p></section>;
}
