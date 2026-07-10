import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TrackMap } from '../src/components/TrackMap.js';

describe('TrackMap', () => {
  afterEach(() => { delete window.AMap; vi.unstubAllEnvs(); });

  it('adds the converted track and latest-position marker to the map', async () => {
    const add = vi.fn(); const setFitView = vi.fn();
    class Map { constructor(_node: HTMLElement, _options: object) {} destroy() {} setFitView = setFitView; add = add; }
    class Polyline { constructor(_options: unknown) {} }
    class Marker { constructor(_options: unknown) {} }
    window.AMap = { Map, Polyline, Marker, convertFrom: (_points, _type, done) => done('complete', { locations: [{ lng: 116.4, lat: 39.9 }] }) };
    vi.stubEnv('VITE_AMAP_KEY', 'test-key');
    render(<TrackMap points={[{ occurredAt: '2026-07-11T00:00:00.000Z', longitude: 116.3, latitude: 39.8, altitudeM: null, accuracyM: null, speedKph: null, headingDeg: null, batteryPct: null, mode: null }]} />);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][0]).toHaveLength(2);
    expect(setFitView).toHaveBeenCalledTimes(1);
  });
});
