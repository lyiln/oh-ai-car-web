import type { LeaseVerification, LeaseVerifier } from './websocket/control-server.js';

export class HttpLeaseVerifier implements LeaseVerifier {
  constructor(private readonly apiUrl: string) {}
  async verify(token: string, vehicleId: string): Promise<LeaseVerification | null> {
    const response = await fetch(new URL('/internal/control-lease/verify', this.apiUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    if (!response.ok) return null;
    const value = await response.json() as { valid?: boolean; vehicle?: LeaseVerification['vehicle']; expiresAt?: string };
    return value.valid && value.vehicle && value.expiresAt ? { vehicle: value.vehicle, expiresAt: value.expiresAt } : null;
  }
}
