import { describe, expect, it } from 'vitest';
import { parseRing, pointInPolygon } from '../src/geometry/point-in-polygon.js';

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('detects interior points', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('detects exterior points', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('rejects short rings', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false);
  });

  it('parses ring arrays', () => {
    expect(parseRing([[0, 0], [1, 0], [1, 1]])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(parseRing([[0, 0]])).toBeNull();
  });
});
