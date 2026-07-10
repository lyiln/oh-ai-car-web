import { describe, expect, it } from 'vitest';
import { sign, verify } from '../src/security.js';

describe('signed platform tokens', () => {
  const secret = 'test-secret';
  it('round-trips a valid unexpired token', () => {
    const token = sign({ sub: 'user-1', role: 'operator', exp: Date.now() + 1_000, leaseId: 'lease-1', vehicleId: 'vehicle-1' }, secret);
    expect(verify(token, secret)).toMatchObject({ sub: 'user-1', leaseId: 'lease-1' });
  });
  it('rejects altered and expired tokens', () => {
    const valid = sign({ sub: 'user-1', role: 'operator', exp: Date.now() + 1_000 }, secret);
    const expired = sign({ sub: 'user-1', role: 'operator', exp: Date.now() - 1 }, secret);
    expect(verify(`${valid}x`, secret)).toBeNull();
    expect(verify(expired, secret)).toBeNull();
  });
});
