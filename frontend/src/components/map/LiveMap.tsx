import { useEffect, useRef, useState } from 'react';
import type { TrackPoint } from '../../services/api.js';

let amapLoading: Promise<typeof window.AMap> | undefined;

function loadAmap(key: string): Promise<NonNullable<typeof window.AMap>> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!amapLoading) {
    amapLoading = new Promise((resolve, reject) => {
      window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/_AMapService` };
      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      script.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德地图加载失败')));
      script.onerror = () => reject(new Error('无法加载高德地图'));
      document.head.append(script);
    });
  }
  return amapLoading as Promise<NonNullable<typeof window.AMap>>;
}

export function LiveMap({
  points,
  follow = true,
  className,
}: {
  points: TrackPoint[];
  follow?: boolean;
  className?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [followMode, setFollowMode] = useState(follow);

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY;
    if (!key) {
      setMessage('未配置 VITE_AMAP_KEY；轨迹点已加载，但地图底图未启用。');
      return;
    }
    let map: {
      destroy: () => void;
      setFitView: (overlays?: unknown[]) => void;
      setCenter: (center: number[]) => void;
      setZoom: (zoom: number) => void;
      add: (overlays: unknown[]) => void;
      clearMap: () => void;
    } | undefined;
    let cancelled = false;

    void loadAmap(key)
      .then((AMap) => {
        if (!node.current || cancelled) return;
        map = new AMap.Map(node.current, { zoom: 16, viewMode: '2D' });
        if (!points.length) {
          setMessage('暂无轨迹点');
          return;
        }
        AMap.convertFrom(
          points.map((point) => [point.longitude, point.latitude]),
          'gps',
          (status, result) => {
            if (cancelled || status !== 'complete') {
              setMessage('GPS 坐标转换失败');
              return;
            }
            const path = result.locations.map((location) => [location.lng, location.lat]);
            const polyline = new AMap.Polyline({
              path,
              strokeColor: '#3d4fb8',
              strokeWeight: 5,
              strokeStyle: 'dashed',
              showDir: true,
            });
            const marker = new AMap.Marker({ position: path.at(-1), title: '当前位置' });
            map?.clearMap();
            map?.add([polyline, marker]);
            if (followMode && path.at(-1)) {
              map?.setCenter(path.at(-1)!);
              map?.setZoom(17);
            } else {
              map?.setFitView();
            }
            setMessage(`已显示 ${points.length} 个轨迹点`);
          },
        );
      })
      .catch((error: Error) => setMessage(error.message));

    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [points, followMode]);

  return (
    <section className={`live-map ${className ?? ''}`.trim()}>
      <div className="live-map-toolbar">
        <span>{message || '地图加载中…'}</span>
        <label className="toggle">
          <input type="checkbox" checked={followMode} onChange={(event) => setFollowMode(event.target.checked)} />
          <span />
          跟随小车
        </label>
      </div>
      <div ref={node} className="live-map-canvas" aria-label="实时地图" />
    </section>
  );
}
