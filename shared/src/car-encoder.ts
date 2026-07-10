import type { Direction } from './protocol-types.js';

const DIRECTION_VALUES: Record<Direction, number> = {
  Stop: 0, Front: 1, After: 2, Left: 3, Right: 4, LeftRotate: 5, RightRotate: 6, Brake: 7,
};

function byte(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Expected a byte value');
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function speed(value: number): string {
  if (!Number.isFinite(value) || value < -100 || value > 100) throw new RangeError('Speed must be between -100 and 100');
  const rounded = Math.round(value);
  return byte(rounded < 0 ? rounded + 256 : rounded);
}

export function checksum(body: string): string {
  let sum = 0;
  for (let index = 0; index < body.length; index += 2) sum = (sum + Number.parseInt(body.slice(index, index + 2), 16)) % 256;
  return byte(sum);
}

export function baseEncode(commandCode: string, payload = ''): string {
  if (!/^[0-9A-F]{2}$/.test(commandCode) || !/^(?:[0-9A-F]{2})*$/.test(payload)) throw new TypeError('Invalid hexadecimal command');
  const body = `01${commandCode}${byte(payload.length + 2)}${payload}`;
  return `$${body}${checksum(body)}#`;
}

export const encodeButton = (direction: Direction): string => baseEncode('15', byte(DIRECTION_VALUES[direction]));
export const encodeRocker = (x: number, y: number): string => baseEncode('10', `${speed(x)}${speed(y)}`);
export const encodeWheelSpeeds = (l1: number, l2: number, r1: number, r2: number): string => baseEncode('21', `${speed(l1)}${speed(l2)}${speed(r1)}${speed(r2)}`);
export const encodePhoto = (): string => baseEncode('60');
export const encodeStartRecording = (): string => baseEncode('61');
export const encodeStopRecording = (): string => baseEncode('62');
export const encodeTracking = (enabled: boolean): string => baseEncode(enabled ? '63' : '64');
