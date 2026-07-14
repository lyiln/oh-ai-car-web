import { useRef, type ReactElement, type ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

const DEFAULT_MAX_CACHED_ROUTES = 12;

type CacheEntry = {
  element: ReactElement;
  lastActiveAt: number;
};

/**
 * Keep visited authenticated pages mounted (hidden) so leaving and returning
 * does not remount them. Preserves console WebSocket/lease and list scroll/state.
 * Cleared when AppShell unmounts (logout or full browser reload).
 */
export function KeepAliveOutlet({ max = DEFAULT_MAX_CACHED_ROUTES }: { max?: number }) {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const cache = cacheRef.current;

  if (outlet) {
    const existing = cache.get(pathname);
    if (!existing) {
      cache.set(pathname, { element: outlet, lastActiveAt: Date.now() });
    } else {
      // Keep the originally mounted element so React state survives route switches.
      existing.lastActiveAt = Date.now();
    }
  }

  while (cache.size > max) {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache) {
      if (key === pathname) continue;
      if (entry.lastActiveAt < oldest) {
        oldest = entry.lastActiveAt;
        victim = key;
      }
    }
    if (!victim) break;
    cache.delete(victim);
  }

  const panes: ReactNode[] = [];
  for (const [key, entry] of cache) {
    const active = key === pathname;
    panes.push(
      <div
        key={key}
        className="route-keep-alive-pane"
        data-active={active ? 'true' : 'false'}
        aria-hidden={!active}
        inert={!active}
      >
        {entry.element}
      </div>,
    );
  }

  return <div className="route-keep-alive-host">{panes}</div>;
}
