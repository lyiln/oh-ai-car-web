const DEFAULT_FALLBACK_CENTER: [number, number] = [116.397428, 39.90923];

let amapLoading: Promise<NonNullable<typeof window.AMap>> | undefined;

function parseZoom(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseCenter(raw: string | undefined): [number, number] {
  if (!raw) return DEFAULT_FALLBACK_CENTER;
  const [lngRaw, latRaw] = raw.split(/[,，\s]+/);
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return DEFAULT_FALLBACK_CENTER;
  return [lng, lat];
}

export const MAP_CLOSEUP_ZOOM = parseZoom(import.meta.env.VITE_MAP_DEFAULT_ZOOM, 18);
export const MAP_FALLBACK_CENTER = parseCenter(import.meta.env.VITE_MAP_DEFAULT_CENTER);

export type LocateResult = {
  ok: boolean;
  center: [number, number];
  message: string;
};

export type GpsCoordinate = [number, number];

export type ConvertGpsResult = {
  path: GpsCoordinate[];
  converted: boolean;
};

const GPS_CONVERT_TIMEOUT_MS = 8000;

/** Convert WGS-84 GPS track to GCJ-02 for AMap; falls back to raw coords when API/proxy is unreachable. */
export function convertGpsTrack(
  AMap: NonNullable<typeof window.AMap>,
  points: GpsCoordinate[],
): Promise<ConvertGpsResult> {
  if (points.length === 0) return Promise.resolve({ path: [], converted: false });

  const fallback = (): ConvertGpsResult => ({
    path: points.map(([lng, lat]) => [lng, lat]),
    converted: false,
  });

  if (!AMap.convertFrom) return Promise.resolve(fallback());

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback()), GPS_CONVERT_TIMEOUT_MS);
    try {
      AMap.convertFrom(points, 'gps', (status, result) => {
        window.clearTimeout(timer);
        if (status === 'complete' && result?.locations?.length) {
          resolve({
            path: result.locations.map((location) => [location.lng, location.lat]),
            converted: true,
          });
          return;
        }
        resolve(fallback());
      });
    } catch {
      window.clearTimeout(timer);
      resolve(fallback());
    }
  });
}

export function loadAmap(key: string): Promise<NonNullable<typeof window.AMap>> {
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
  return amapLoading;
}

export function loadPlugins(AMap: NonNullable<typeof window.AMap>, names: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (!AMap.plugin) {
      resolve();
      return;
    }
    AMap.plugin(names, () => resolve());
  });
}

function applyView(map: AMapMapInstance, center: [number, number]): void {
  map.setCenter(center);
  map.setZoom(MAP_CLOSEUP_ZOOM);
}

/** Exported for unit tests — resets nothing about the live map, only parses env-style center. */
export function resolveFallbackCenter(raw?: string): [number, number] {
  return parseCenter(raw);
}

export async function locateToUser(
  map: AMapMapInstance,
  AMap: NonNullable<typeof window.AMap>,
): Promise<LocateResult> {
  await loadPlugins(AMap, ['AMap.Geolocation']);
  if (!AMap.Geolocation) {
    applyView(map, MAP_FALLBACK_CENTER);
    return {
      ok: false,
      center: MAP_FALLBACK_CENTER,
      message: '定位插件不可用，已使用默认视野',
    };
  }

  const geolocation = new AMap.Geolocation({
    enableHighAccuracy: true,
    timeout: 10000,
    convert: true,
  });

  return new Promise((resolve) => {
    geolocation.getCurrentPosition((status, result) => {
      if (status === 'complete' && result?.position) {
        const center: [number, number] = [result.position.lng, result.position.lat];
        applyView(map, center);
        resolve({ ok: true, center, message: '已定位到当前位置' });
        return;
      }
      applyView(map, MAP_FALLBACK_CENTER);
      const detail = result?.message?.trim();
      resolve({
        ok: false,
        center: MAP_FALLBACK_CENTER,
        message: detail
          ? `定位失败（${detail}），已使用默认视野`
          : '定位失败，已使用默认视野',
      });
    });
  });
}
