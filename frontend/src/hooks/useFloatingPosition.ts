import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type FloatingPoint = { x: number; y: number };

const DEFAULT_STORAGE_KEY = 'patrol:advisorPosition';
const DRAG_THRESHOLD_PX = 6;

export function defaultAdvisorPoint(size = { width: 64, height: 64 }): FloatingPoint {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  return {
    x: Math.max(16, window.innerWidth - size.width - 24),
    y: Math.max(16, window.innerHeight - size.height - 72),
  };
}

export function clampPoint(
  point: FloatingPoint,
  size: { width: number; height: number },
  viewport = typeof window !== 'undefined'
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 1280, height: 720 },
): FloatingPoint {
  const maxX = Math.max(8, viewport.width - size.width - 8);
  const maxY = Math.max(8, viewport.height - size.height - 8);
  return {
    x: Math.min(Math.max(8, point.x), maxX),
    y: Math.min(Math.max(8, point.y), maxY),
  };
}

function readStored(key: string): FloatingPoint | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export function useFloatingPosition(options?: {
  storageKey?: string;
  size?: { width: number; height: number };
}) {
  const storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
  const sizeRef = useRef(options?.size ?? { width: 64, height: 64 });
  sizeRef.current = options?.size ?? { width: 64, height: 64 };

  const [point, setPoint] = useState<FloatingPoint>(() => {
    const size = sizeRef.current;
    const stored = typeof window !== 'undefined' ? readStored(storageKey) : null;
    return clampPoint(stored ?? defaultAdvisorPoint(size), size);
  });
  const draggedRef = useRef(false);
  const dragState = useRef<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const frameRef = useRef<number | null>(null);

  const persist = useCallback((next: FloatingPoint) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }, [storageKey]);

  useEffect(() => {
    setPoint((current) => {
      const next = clampPoint(current, sizeRef.current);
      persist(next);
      return next;
    });
  }, [options?.size?.width, options?.size?.height, persist]);

  useEffect(() => {
    const onResize = () => {
      setPoint((current) => {
        const next = clampPoint(current, sizeRef.current);
        persist(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [persist]);

  useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    dragState.current = {
      originX: point.x,
      originY: point.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, [point.x, point.y]);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    state.moved = true;
    draggedRef.current = true;
    const next = clampPoint({ x: state.originX + dx, y: state.originY + dy }, sizeRef.current);
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      setPoint(next);
    });
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent) => {
    const state = dragState.current;
    dragState.current = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (!state?.moved) return;
    setPoint((current) => {
      const next = clampPoint(current, sizeRef.current);
      persist(next);
      return next;
    });
  }, [persist]);

  const didDrag = useCallback(() => draggedRef.current, []);

  return {
    point,
    setPoint,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    didDrag,
    style: {
      position: 'fixed' as const,
      left: 0,
      top: 0,
      transform: `translate3d(${point.x}px, ${point.y}px, 0)`,
      zIndex: 1200,
    },
  };
}
