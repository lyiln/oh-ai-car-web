import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAmap, locateToUser, convertGpsTrack, MAP_CLOSEUP_ZOOM, MAP_FALLBACK_CENTER } from '../lib/amap.js';
import type { TrackPoint } from '../services/platformClient.js';

export function TrackMap({ points }: { points: TrackPoint[] }) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMapInstance | null>(null);
  const AMapRef = useRef<NonNullable<typeof window.AMap> | null>(null);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);

  const runLocate = useCallback(async () => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!map || !AMap) return;
    setLocating(true);
    setMessage('正在获取当前位置…');
    try {
      const result = await locateToUser(map, AMap);
      setMessage(result.message);
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY;
    if (!key) {
      setMessage('未配置 VITE_AMAP_KEY；轨迹点已加载，但地图底图未启用。');
      return;
    }
    let cancelled = false;

    void loadAmap(key)
      .then((AMap) => {
        if (!node.current || cancelled) return;
        const map = new AMap.Map(node.current, {
          zoom: MAP_CLOSEUP_ZOOM,
          viewMode: '2D',
          center: MAP_FALLBACK_CENTER,
        });
        mapRef.current = map;
        AMapRef.current = AMap;
        setReady(true);
      })
      .catch((error: Error) => setMessage(error.message));

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      AMapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!ready || !map || !AMap) return;
    let cancelled = false;

    if (!points.length) {
      map.clearMap();
      void runLocate();
      return;
    }

    void convertGpsTrack(
      AMap,
      points.map((point) => [point.longitude, point.latitude]),
    ).then(({ path, converted }) => {
      if (cancelled || path.length === 0) {
        setMessage('GPS 坐标转换失败，未显示可能偏移的轨迹。');
        return;
      }
      const polyline = new AMap.Polyline({ path, strokeColor: '#2577e3', strokeWeight: 6, showDir: true });
      const marker = new AMap.Marker({ position: path.at(-1), title: `最新点：${points.at(-1)?.occurredAt}` });
      map.clearMap();
      map.add([polyline, marker]);
      map.setFitView();
      setMessage(
        converted
          ? `已显示 ${points.length} 个 WGS-84 GPS 轨迹点。`
          : '高德坐标转换不可用，轨迹已按原始 GPS 显示（可能有偏移）。',
      );
    });

    return () => {
      cancelled = true;
    };
  }, [ready, points, runLocate]);

  return (
    <section className="panel map-panel">
      <div className="panel-heading">
        <h2>实时位置与轨迹</h2>
        <span>{message || (ready ? '地图已就绪' : '地图加载中…')}</span>
        <button type="button" className="secondary" disabled={locating || !ready} onClick={() => void runLocate()}>
          定位到我
        </button>
      </div>
      <div ref={node} className="map-canvas" aria-label="车辆轨迹地图" />
    </section>
  );
}
