import { useEffect, useRef, useState } from 'react';
import type { TrackPoint } from '../services/platformClient.js';

let amapLoading: Promise<typeof window.AMap> | undefined;
function loadAmap(key: string): Promise<NonNullable<typeof window.AMap>> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!amapLoading) amapLoading = new Promise((resolve, reject) => { window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/_AMapService` }; const script = document.createElement('script'); script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`; script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('高德地图加载失败')); script.onerror = () => reject(new Error('无法加载高德地图')); document.head.append(script); });
  return amapLoading as Promise<NonNullable<typeof window.AMap>>;
}

export function TrackMap({ points }: { points: TrackPoint[] }) {
  const node = useRef<HTMLDivElement>(null); const [message, setMessage] = useState('');
  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY; if (!key) { setMessage('未配置 VITE_AMAP_KEY；轨迹点已加载，但地图底图未启用。'); return; }
    let map: { destroy: () => void; setFitView: (overlays?: unknown[]) => void; add: (overlays: unknown[]) => void } | undefined; let cancelled = false;
    void loadAmap(key).then((AMap) => {
      if (!node.current || cancelled) return;
      map = new AMap.Map(node.current, { zoom: 15, viewMode: '2D' });
      if (!points.length) { setMessage('此时间范围没有轨迹点。'); return; }
      AMap.convertFrom(points.map((point) => [point.longitude, point.latitude]), 'gps', (status, result) => {
        if (cancelled || status !== 'complete') { setMessage('GPS 坐标转换失败，未显示可能偏移的轨迹。'); return; }
        const path = result.locations.map((location) => [location.lng, location.lat]);
        const polyline = new AMap.Polyline({ path, strokeColor: '#2577e3', strokeWeight: 6, showDir: true });
        const marker = new AMap.Marker({ position: path.at(-1), title: `最新点：${points.at(-1)?.occurredAt}` });
        map?.add([polyline, marker]); map?.setFitView(); setMessage(`已显示 ${points.length} 个 WGS-84 GPS 轨迹点。`);
      });
    }).catch((error: Error) => setMessage(error.message));
    return () => { cancelled = true; map?.destroy(); };
  }, [points]);
  return <section className="panel map-panel"><div className="panel-heading"><h2>实时位置与轨迹</h2><span>{message}</span></div><div ref={node} className="map-canvas" aria-label="车辆轨迹地图" /></section>;
}
