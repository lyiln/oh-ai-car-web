import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAmap, locateToUser, MAP_CLOSEUP_ZOOM, MAP_FALLBACK_CENTER } from '../../lib/amap.js';
import type { TrackPoint } from '../../services/api.js';

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
  const mapRef = useRef<AMapMapInstance | null>(null);
  const AMapRef = useRef<NonNullable<typeof window.AMap> | null>(null);
  const [message, setMessage] = useState('');
  const [followMode, setFollowMode] = useState(follow);
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
        map.clearMap();
        map.add([polyline, marker]);
        if (followMode && path.at(-1)) {
          map.setCenter(path.at(-1)!);
          map.setZoom(MAP_CLOSEUP_ZOOM);
        } else {
          map.setFitView();
        }
        setMessage(`已显示 ${points.length} 个轨迹点`);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [ready, points, followMode, runLocate]);

  return (
    <section className={`live-map ${className ?? ''}`.trim()}>
      <div className="live-map-toolbar">
        <span>{message || (ready ? '地图已就绪' : '地图加载中…')}</span>
        <button type="button" className="secondary" disabled={locating || !ready} onClick={() => void runLocate()}>
          定位到我
        </button>
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
