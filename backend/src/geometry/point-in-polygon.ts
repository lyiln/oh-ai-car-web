/** Ray-casting point-in-polygon for map-frame meters (x east, y north). */
export type RingPoint = { x: number; y: number };

export function pointInPolygon(point: RingPoint, ring: RingPoint[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function parseRing(raw: unknown): RingPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: RingPoint[] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number' && typeof item[1] === 'number') {
      if (!Number.isFinite(item[0]) || !Number.isFinite(item[1])) return null;
      ring.push({ x: item[0], y: item[1] });
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const row = item as { x?: unknown; y?: unknown };
      if (typeof row.x === 'number' && typeof row.y === 'number' && Number.isFinite(row.x) && Number.isFinite(row.y)) {
        ring.push({ x: row.x, y: row.y });
        continue;
      }
    }
    return null;
  }
  return ring;
}
