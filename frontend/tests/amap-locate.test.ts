import { afterEach, describe, expect, it, vi } from 'vitest';
import { locateToUser, resolveFallbackCenter } from '../src/lib/amap.js';

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
