import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertGpsTrack, locateToUser, resolveFallbackCenter } from '../src/lib/amap.js';

describe('convertGpsTrack', () => {
  it('falls back to raw GPS when convertFrom is unavailable', async () => {
    const result = await convertGpsTrack({} as NonNullable<typeof window.AMap>, [[116.4, 39.9]]);
    expect(result).toEqual({ path: [[116.4, 39.9]], converted: false });
  });

  it('uses convertFrom when the API succeeds', async () => {
    const AMap = {
      convertFrom: (_points: unknown, _type: string, done: (status: string, result: { locations: Array<{ lng: number; lat: number }> }) => void) => {
        done('complete', { locations: [{ lng: 116.41, lat: 39.91 }] });
      },
    } as NonNullable<typeof window.AMap>;
    const result = await convertGpsTrack(AMap, [[116.4, 39.9]]);
    expect(result).toEqual({ path: [[116.41, 39.91]], converted: true });
  });

  it('falls back when convertFrom returns a non-complete status', async () => {
    const AMap = {
      convertFrom: (_points: unknown, _type: string, done: (status: string, result: unknown) => void) => {
        done('error', {});
      },
    } as NonNullable<typeof window.AMap>;
    const result = await convertGpsTrack(AMap, [[116.4, 39.9]]);
    expect(result).toEqual({ path: [[116.4, 39.9]], converted: false });
  });
});

describe('resolveFallbackCenter', () => {
  it('parses lng,lat pairs', () => {
    expect(resolveFallbackCenter('116.339,39.949')).toEqual([116.339, 39.949]);
  });

  it('falls back for invalid input', () => {
    expect(resolveFallbackCenter('not-a-coord')).toEqual([116.397428, 39.90923]);
    expect(resolveFallbackCenter(undefined)).toEqual([116.397428, 39.90923]);
  });
});

describe('locateToUser', () => {
  afterEach(() => {
    delete window.AMap;
  });

  function createMap() {
    return {
      destroy: vi.fn(),
      setFitView: vi.fn(),
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      add: vi.fn(),
      clearMap: vi.fn(),
    };
  }

  it('centers on the geolocation result when complete', async () => {
    const map = createMap();
    window.AMap = {
      Map: class {
        constructor() {
          return map;
        }
      } as never,
      Marker: class {} as never,
      Polyline: class {} as never,
      Geolocation: class {
        getCurrentPosition(callback: (status: string, result: AMapGeolocationResult) => void) {
          callback('complete', { position: { lng: 116.34, lat: 39.95 } });
        }
      },
      plugin: (_names, callback) => callback(),
      convertFrom: vi.fn(),
    };

    const result = await locateToUser(map, window.AMap);
    expect(result.ok).toBe(true);
    expect(result.center).toEqual([116.34, 39.95]);
    expect(map.setCenter).toHaveBeenCalledWith([116.34, 39.95]);
    expect(map.setZoom).toHaveBeenCalled();
    expect(result.message).toBe('已定位到当前位置');
  });

  it('falls back to default center when geolocation fails', async () => {
    const map = createMap();
    window.AMap = {
      Map: class {
        constructor() {
          return map;
        }
      } as never,
      Marker: class {} as never,
      Polyline: class {} as never,
      Geolocation: class {
        getCurrentPosition(callback: (status: string, result: AMapGeolocationResult) => void) {
          callback('error', { position: { lng: 0, lat: 0 }, message: 'Geolocation permission denied' });
        }
      },
      plugin: (_names, callback) => callback(),
      convertFrom: vi.fn(),
    };

    const result = await locateToUser(map, window.AMap);
    expect(result.ok).toBe(false);
    expect(map.setCenter).toHaveBeenCalled();
    expect(map.setZoom).toHaveBeenCalled();
    expect(result.message).toContain('定位失败');
    expect(result.message).toContain('已使用默认视野');
  });

  it('falls back when Geolocation plugin is missing', async () => {
    const map = createMap();
    window.AMap = {
      Map: class {
        constructor() {
          return map;
        }
      } as never,
      Marker: class {} as never,
      Polyline: class {} as never,
      plugin: (_names, callback) => callback(),
      convertFrom: vi.fn(),
    };

    const result = await locateToUser(map, window.AMap);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('定位插件不可用，已使用默认视野');
    expect(map.setCenter).toHaveBeenCalled();
  });
});
