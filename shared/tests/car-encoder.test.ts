import { describe, expect, it } from 'vitest';
import { encodeButton, encodePhoto, encodeRocker, encodeStartRecording, encodeStopRecording, encodeTracking, encodeWheelSpeeds } from '../src/index.js';

describe('car protocol encoder', () => {
  it('reproduces the source-compatible command 15 packet baseline', () => {
    expect(encodeButton('Front')).toBe('$011504011B#');
    expect(encodeButton('Stop')).toBe('$011504001A#');
  });

  it('rounds and encodes negative rocker values for cmd 10', () => {
    expect(encodeRocker(-1.4, 99.6)).toBe('$011006FF647A#');
  });

  it('encodes all four wheel speeds for cmd 21', () => {
    expect(encodeWheelSpeeds(-100, -1, 0, 100)).toBe('$01210A9CFF00642B#');
  });

  it('encodes media and tracking commands without payloads', () => {
    expect(encodePhoto()).toBe('$01600263#');
    expect(encodeStartRecording()).toBe('$01610264#');
    expect(encodeStopRecording()).toBe('$01620265#');
    expect(encodeTracking(true)).toBe('$01630266#');
    expect(encodeTracking(false)).toBe('$01640267#');
  });

  it('rejects unsafe speeds', () => expect(() => encodeRocker(101, 0)).toThrow(RangeError));
});
