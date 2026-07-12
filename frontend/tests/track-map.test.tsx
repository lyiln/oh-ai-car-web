import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TrackMap } from '../src/components/TrackMap.js';

describe('TrackMap', () => {
  afterEach(() => {
    delete window.AMap;
    vi.unstubAllEnvs();
  });

  function mockAmap(options?: {
    onLocate?: (callback: (status: string, result: AMapGeolocationResult) => void) => void;
  }) {
    const add = vi.fn();
    const setFitView = vi.fn();
    const setCenter = vi.fn();
    const setZoom = vi.fn();
    const clearMap = vi.fn();
    class Map {
      constructor(_node: HTMLElement, _options: object) {}
      destroy() {}
      setFitView = setFitView;
      setCenter = setCenter;
      setZoom = setZoom;
      clearMap = clearMap;
      add = add;
    }
    class Polyline {
      constructor(_options: unknown) {}
    }
    class Marker {
      constructor(_options: unknown) {}
    }
    window.AMap = {
      Map,
      Polyline,
      Marker,
      Polygon: class {
        constructor(_options: unknown) {}
        getPath() {
          return [];
        }
      },
      Text: class {
        constructor(_options: unknown) {}
      },
      MouseTool: class {
        constructor(_map: unknown) {}
        polygon() {}
        close() {}
        on() {}
      },
      PolygonEditor: class {
        constructor(_map: unknown) {}
        open() {}
        close() {}
        setTarget() {}
        getTarget() {
          return undefined;
        }
      },
      Geolocation: class {
        getCurrentPosition(callback: (status: string, result: AMapGeolocationResult) => void) {
          if (options?.onLocate) {
            options.onLocate(callback);
            return;
          }
          callback('complete', { position: { lng: 116.34, lat: 39.95 } });
        }
      },
      plugin: (_names, callback) => callback(),
      convertFrom: (_points, _type, done) => done('complete', { locations: [{ lng: 116.4, lat: 39.9 }] }),
    };
    return { add, setFitView, setCenter, setZoom, clearMap };
  }

  it('adds the converted track and latest-position marker to the map', async () => {
    const { add, setFitView } = mockAmap();
    vi.stubEnv('VITE_AMAP_KEY', 'test-key');
    render(
      <TrackMap
        points={[
          {
            occurredAt: '2026-07-11T00:00:00.000Z',
            longitude: 116.3,
            latitude: 39.8,
            altitudeM: null,
            accuracyM: null,
            speedKph: null,
            headingDeg: null,
            batteryPct: null,
            mode: null,
          },
        ]}
      />,
    );
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][0]).toHaveLength(2);
    expect(setFitView).toHaveBeenCalledTimes(1);
  });

  it('locates the user when there are no track points', async () => {
    const locate = vi.fn((callback: (status: string, result: AMapGeolocationResult) => void) => {
      callback('complete', { position: { lng: 116.34, lat: 39.95 } });
    });
    const { setCenter, setZoom } = mockAmap({ onLocate: locate });
    vi.stubEnv('VITE_AMAP_KEY', 'test-key');
    render(<TrackMap points={[]} />);
    await waitFor(() => expect(locate).toHaveBeenCalled());
    expect(setCenter).toHaveBeenCalledWith([116.34, 39.95]);
    expect(setZoom).toHaveBeenCalled();
  });
});
