import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadAmap, loadPlugins, locateToUser, convertGpsTrack, MAP_CLOSEUP_ZOOM, MAP_FALLBACK_CENTER } from '../../lib/amap.js';
import type { MapZone, TrackPoint, Violation, Waypoint } from '../../services/api.js';

function pathToCoordinates(path: Array<{ lng: number; lat: number } | number[]>): Array<[number, number]> {
  return path.map((point) => {
    if (Array.isArray(point)) return [Number(point[0]), Number(point[1])] as [number, number];
    return [point.lng, point.lat] as [number, number];
  });
}

export type MapLayers = {
  waypoints: boolean;
  zones: boolean;
  violations: boolean;
  track: boolean;
};

export type GlobalMapMode = 'view' | 'draw' | 'edit';

export type GlobalMapHandle = {
  focusPosition: (longitude: number, latitude: number, zoom?: number) => void;
};

type Props = {
  zones: MapZone[];
  waypoints: Waypoint[];
  violations?: Violation[];
  trackPoints?: TrackPoint[];
  layers: MapLayers;
  mode: GlobalMapMode;
  selectedZoneId?: string | null;
  onModeChange?: (mode: GlobalMapMode) => void;
  onZoneDrawn?: (coordinates: Array<[number, number]>) => void;
  onZoneEdited?: (zoneId: string, coordinates: Array<[number, number]>) => void;
  onZoneSelect?: (zoneId: string | null) => void;
  onViolationClick?: (violation: Violation) => void;
};

export const GlobalMap = forwardRef<GlobalMapHandle, Props>(function GlobalMap({
  zones,
  waypoints,
  violations = [],
  trackPoints = [],
  layers,
  mode,
  selectedZoneId,
  onModeChange,
  onZoneDrawn,
  onZoneEdited,
  onZoneSelect,
  onViolationClick,
}, ref) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMapInstance | null>(null);
  const AMapRef = useRef<NonNullable<typeof window.AMap> | null>(null);
  const mouseToolRef = useRef<AMapMouseTool | null>(null);
  const editorRef = useRef<AMapPolygonEditor | null>(null);
  const zoneOverlaysRef = useRef<Map<string, AMapPolygon>>(new Map());
  const locatedOnceRef = useRef(false);
  const [message, setMessage] = useState('地图加载中…');
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);

  const callbacksRef = useRef({ onZoneDrawn, onZoneEdited, onZoneSelect, onViolationClick, onModeChange });
  callbacksRef.current = { onZoneDrawn, onZoneEdited, onZoneSelect, onViolationClick, onModeChange };

  useImperativeHandle(ref, () => ({
    focusPosition(longitude: number, latitude: number, zoom = MAP_CLOSEUP_ZOOM) {
      const map = mapRef.current;
      if (!map || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      map.setCenter?.([longitude, latitude]);
      map.setZoom?.(zoom);
      setMessage(`已定位到违停点 ${longitude.toFixed(6)}, ${latitude.toFixed(6)}`);
    },
  }), []);

  const runLocate = useCallback(async (force = false) => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!map || !AMap) return;
    if (!force && locatedOnceRef.current) return;
    setLocating(true);
    setMessage('正在获取当前位置…');
    try {
      const result = await locateToUser(map, AMap);
      locatedOnceRef.current = true;
      setMessage(result.message);
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY;
    if (!key) {
      setMessage('未配置 VITE_AMAP_KEY；禁停区列表可用，但地图底图未启用。');
      return;
    }
    let cancelled = false;

    void loadAmap(key)
      .then(async (AMap) => {
        if (!node.current || cancelled) return;
        await loadPlugins(AMap, ['AMap.MouseTool', 'AMap.Polygon', 'AMap.PolygonEditor', 'AMap.Marker', 'AMap.Text']);
        if (cancelled || !node.current) return;
        if (!AMap.MouseTool || !AMap.PolygonEditor || !AMap.Polygon || !AMap.Text) {
          throw new Error('高德地图插件加载不完整');
        }
        const map = new AMap.Map(node.current, {
          zoom: MAP_CLOSEUP_ZOOM,
          viewMode: '2D',
          center: MAP_FALLBACK_CENTER,
        });
        mapRef.current = map;
        AMapRef.current = AMap;
        mouseToolRef.current = new AMap.MouseTool(map);
        mouseToolRef.current.on('draw', (event) => {
          const coordinates = pathToCoordinates(event.obj.getPath());
          event.obj.setMap?.(null);
          mouseToolRef.current?.close(true);
          callbacksRef.current.onZoneDrawn?.(coordinates);
          callbacksRef.current.onModeChange?.('view');
        });
        editorRef.current = new AMap.PolygonEditor(map);
        setReady(true);
        setMessage('地图已就绪');
      })
      .catch((error: Error) => setMessage(error.message));

    return () => {
      cancelled = true;
      mouseToolRef.current?.close(true);
      editorRef.current?.close();
      mapRef.current?.destroy();
      mapRef.current = null;
      AMapRef.current = null;
      zoneOverlaysRef.current.clear();
      locatedOnceRef.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!ready || !map || !AMap?.Polygon || !AMap.Text) return;

    map.clearMap();
    zoneOverlaysRef.current.clear();
    const fitTargets: unknown[] = [];
    const Polygon = AMap.Polygon;
    const Text = AMap.Text;

    if (layers.zones) {
      for (const zone of zones) {
        const path = (zone.coordinates ?? [])
          .map((pair) => [Number(pair[0]), Number(pair[1])] as [number, number])
          .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
        if (path.length < 3) continue;
        const selected = zone.id === selectedZoneId;
        const polygon = new Polygon({
          path,
          strokeColor: selected ? '#1d4ed8' : '#dc2626',
          strokeWeight: selected ? 3 : 2,
          fillColor: selected ? '#3b82f6' : '#ef4444',
          fillOpacity: 0.28,
          extData: { zoneId: zone.id },
        });
        polygon.on?.('click', () => callbacksRef.current.onZoneSelect?.(zone.id));
        map.add(polygon);
        zoneOverlaysRef.current.set(zone.id, polygon);
        fitTargets.push(polygon);

        const sum = path.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat] as [number, number], [0, 0] as [number, number]);
        const center = [sum[0] / path.length, sum[1] / path.length];
        const label = new Text({
          text: zone.name,
          position: center,
          style: {
            'background-color': 'rgba(255,255,255,0.9)',
            border: '1px solid #dc2626',
            'border-radius': '4px',
            padding: '2px 6px',
            'font-size': '12px',
            color: '#7f1d1d',
          },
        });
        map.add(label);
      }
    }

    if (layers.waypoints) {
      for (const point of waypoints) {
        if (!Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)) continue;
        const marker = new AMap.Marker({
          position: [point.longitude, point.latitude],
          title: point.name,
          content: `<div class="amap-waypoint-dot" title="${point.name}"></div>`,
          offset: [-6, -6],
        });
        map.add(marker);
        fitTargets.push(marker);
      }
    }

    if (layers.violations) {
      for (const violation of violations) {
        if (violation.longitude == null || violation.latitude == null) continue;
        if (!Number.isFinite(violation.longitude) || !Number.isFinite(violation.latitude)) continue;
        const tipParts = [
          violation.plate || '未识别车牌',
          violation.building,
          `${violation.longitude.toFixed(5)},${violation.latitude.toFixed(5)}`,
        ].filter(Boolean);
        const marker = new AMap.Marker({
          position: [violation.longitude, violation.latitude],
          title: tipParts.join(' · '),
          content: `<div class="amap-violation-dot">${violation.plate || '违'}</div>`,
          offset: [-18, -12],
        });
        marker.on?.('click', () => callbacksRef.current.onViolationClick?.(violation));
        map.add(marker);
        fitTargets.push(marker);
      }
    }

    let trackCancelled = false;
    if (layers.track && trackPoints.length > 0) {
      void convertGpsTrack(
        AMap,
        trackPoints.map((point) => [point.longitude, point.latitude]),
      ).then(({ path, converted }) => {
        if (trackCancelled || !mapRef.current || path.length === 0) return;
        const polyline = new AMap.Polyline({
          path,
          strokeColor: '#3d4fb8',
          strokeWeight: 5,
          strokeStyle: 'dashed',
          showDir: true,
        });
        mapRef.current.add(polyline);
        if (path.at(-1)) {
          mapRef.current.add(new AMap.Marker({ position: path.at(-1), title: '最新位置' }));
        }
        if (!converted) {
          setMessage('高德坐标转换不可用，轨迹已按原始 GPS 显示（可能有偏移）');
        }
      });
    }

    if (fitTargets.length > 0) {
      map.setFitView(fitTargets);
    } else {
      void runLocate(false);
    }

    return () => {
      trackCancelled = true;
    };
  }, [ready, zones, waypoints, violations, trackPoints, layers, selectedZoneId, runLocate]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    const mouseTool = mouseToolRef.current;
    const editor = editorRef.current;
    if (!ready || !map || !AMap || !mouseTool || !editor) return;

    mouseTool.close(true);
    editor.close();

    if (mode === 'draw') {
      setMessage('点击地图绘制禁停区多边形，双击结束');
      mouseTool.polygon({
        strokeColor: '#dc2626',
        strokeWeight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.28,
      });
      return;
    }

    if (mode === 'edit' && selectedZoneId) {
      const polygon = zoneOverlaysRef.current.get(selectedZoneId);
      if (!polygon) {
        setMessage('请先选中一个禁停区再编辑');
        callbacksRef.current.onModeChange?.('view');
        return;
      }
      setMessage('拖动顶点调整区域，完成后点击「完成编辑」');
      editor.setTarget(polygon);
      editor.open();
      return;
    }

    if (mode === 'view' && !locating) {
      setMessage((current) => (current.startsWith('已定位') || current.startsWith('定位失败') ? current : '地图已就绪'));
    }
  }, [mode, selectedZoneId, ready, locating]);

  const finishEdit = () => {
    const editor = editorRef.current;
    if (!editor) {
      onModeChange?.('view');
      return;
    }
    const polygon = editor.getTarget();
    if (!polygon || !selectedZoneId) {
      onModeChange?.('view');
      return;
    }
    const coordinates = pathToCoordinates(polygon.getPath());
    editor.close();
    onZoneEdited?.(selectedZoneId, coordinates);
    onModeChange?.('view');
  };

  return (
    <section className="global-map">
      <div className="global-map-toolbar">
        <span>{message}</span>
        <button type="button" className="secondary" disabled={locating || !ready} onClick={() => void runLocate(true)}>
          定位到我
        </button>
        {mode === 'edit' && (
          <button type="button" className="primary" onClick={finishEdit}>完成编辑</button>
        )}
        {mode === 'draw' && (
          <button type="button" className="secondary" onClick={() => { mouseToolRef.current?.close(true); onModeChange?.('view'); }}>取消绘制</button>
        )}
      </div>
      <div ref={node} className="global-map-canvas" aria-label="全局运营地图" />
    </section>
  );
});
