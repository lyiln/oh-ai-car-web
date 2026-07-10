import { describe, expect, it } from 'vitest';
import { baseEncode, encodeButton, encodePhoto, encodeRocker, encodeStartRecording, encodeStopRecording, encodeTracking, encodeWheelSpeeds } from '../src/index.js';

describe('car protocol encoder', () => {
  it('encodes command 15 using the documented packet format', () => {
    expect(encodeButton('Front')).toBe('$011504011B#');
    expect(encodeButton('Stop')).toBe('$011504001A#');
  });

  it('rounds and encodes negative rocker values for cmd 10', () => {
    expect(encodeRocker(-1.4, 99.6)).toBe('$011006FF64' + baseEncode('10', 'FF64').slice(-3));
  });

  it('encodes all four wheel speeds for cmd 21', () => {
    expect(encodeWheelSpeeds(-100, -1, 0, 100)).toMatch(/^\$01210A9CFF0064[0-9A-F]{2}#$/);
  });

  it('encodes media and tracking commands without payloads', () => {
    expect(encodePhoto()).toMatch(/^\$016002[0-9A-F]{2}#$/);
    expect(encodeStartRecording()).toMatch(/^\$016102[0-9A-F]{2}#$/);
    expect(encodeStopRecording()).toMatch(/^\$016202[0-9A-F]{2}#$/);
    expect(encodeTracking(true)).toMatch(/^\$016302[0-9A-F]{2}#$/);
    expect(encodeTracking(false)).toMatch(/^\$016402[0-9A-F]{2}#$/);
  });

  it('rejects unsafe speeds', () => expect(() => encodeRocker(101, 0)).toThrow(RangeError));
});
