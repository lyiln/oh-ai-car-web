export interface PlatformUser { id: string; username: string; displayName: string; role: 'admin' | 'operator'; active?: boolean; }
export interface Vehicle { id: string; code: string; name: string; description: string; host: string; tcpPort: number; videoPort: number; archived: boolean; }
export interface Lease { leaseId: string; expiresAt: string; gatewayToken: string; }
export interface TrackPoint { occurredAt: string; longitude: number; latitude: number; altitudeM: number | null; accuracyM: number | null; speedKph: number | null; headingDeg: number | null; batteryPct: number | null; mode: string | null; }
export interface AuditLog { id: string; actorUserId: string | null; vehicleId: string | null; action: string; outcome: string; metadata: unknown; createdAt: string; }

export class PlatformClient {
  readonly baseUrl = import.meta.env.VITE_PLATFORM_API_URL ?? window.location.origin;
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), { credentials: 'include', headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, ...init });
    const value = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
    return value;
  }
  me() { return this.request<{ user: PlatformUser }>('/api/auth/me'); }
  login(username: string, password: string) { return this.request<{ user: PlatformUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); }
  logout() { return this.request<{ ok: true }>('/api/auth/logout', { method: 'POST' }); }
  vehicles() { return this.request<{ vehicles: Vehicle[] }>('/api/vehicles'); }
  users() { return this.request<{ users: PlatformUser[] }>('/api/users'); }
  audit() { return this.request<{ logs: AuditLog[] }>('/api/audit-logs'); }
  track(vehicleId: string, from?: string, to?: string) { const search = new URLSearchParams(); if (from) search.set('from', from); if (to) search.set('to', to); return this.request<{ points: TrackPoint[] }>(`/api/vehicles/${vehicleId}/track?${search}`); }
  acquireLease(vehicleId: string) { return this.request<Lease>(`/api/vehicles/${vehicleId}/control-lease`, { method: 'POST' }); }
  renewLease(leaseId: string) { return this.request<Omit<Lease, 'leaseId'>>(`/api/control-leases/${leaseId}/renew`, { method: 'POST' }); }
  releaseLease(leaseId: string) { return this.request<{ ok: true }>(`/api/control-leases/${leaseId}`, { method: 'DELETE' }); }
}
