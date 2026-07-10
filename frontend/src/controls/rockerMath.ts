export function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

export function mapRockerPoint(x: number, y: number, width: number, height: number): { x: number; y: number; left: number; top: number } {
  const radius = Math.max(1, Math.min(width, height) / 2);
  const dx = x - width / 2;
  const dy = y - height / 2;
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / length : 1;
  const limitedX = dx * scale;
  const limitedY = dy * scale;
  const mappedX = Math.round(clamp((limitedX / radius) * 100, -100, 100));
  const mappedY = Math.round(clamp((-limitedY / radius) * 100, -100, 100));
  return {
    x: Object.is(mappedX, -0) ? 0 : mappedX,
    y: Object.is(mappedY, -0) ? 0 : mappedY,
    left: width / 2 + limitedX,
    top: height / 2 + limitedY,
  };
}
