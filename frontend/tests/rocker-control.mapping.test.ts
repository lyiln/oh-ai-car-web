import { describe, expect, it } from 'vitest';
import { mapRockerPoint } from '../src/controls/rockerMath.js';

describe('rocker coordinate mapping', () => {
  it('maps the board center to a stop and clamps the perimeter', () => {
    expect(mapRockerPoint(100, 100, 200, 200)).toMatchObject({ x: 0, y: 0 });
    expect(mapRockerPoint(300, -100, 200, 200)).toMatchObject({ x: 71, y: 71 });
  });
});
