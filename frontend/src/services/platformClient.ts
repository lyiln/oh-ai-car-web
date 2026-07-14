export interface PlatformUser { id: string; username: string; displayName: string; role: 'admin' | 'operator'; active?: boolean; email?: string | null; }
export interface Vehicle { id: string; code: string; name: string; description: string; host: string; tcpPort: number; videoPort: number; archived: boolean; }
export interface Lease { leaseId: string; expiresAt: string; gatewayToken: string; }
export interface TrackPoint { occurredAt: string; longitude: number; latitude: number; altitudeM: number | null; accuracyM: number | null; speedKph: number | null; headingDeg: number | null; batteryPct: number | null; mode: string | null; }
export interface AuditLog { id: string; actorUserId: string | null; vehicleId: string | null; action: string; outcome: string; metadata: unknown; createdAt: string; }
export interface OtpRequestResult { ok: true; message: string; time: string; }
export interface ProfileUpdate {
  displayName?: string;
  email?: string | null;
  password?: string;
  currentPassword?: string;
}

export class PlatformClient {
  readonly baseUrl = import.meta.env.VITE_PLATFORM_API_URL ?? window.location.origin;
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const hasBody = init.body !== undefined && init.body !== null;
    if (hasBody && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      credentials: 'include',
      ...init,
      headers,
    });
    const value = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
    return value;
  }
  me() { return this.request<{ user: PlatformUser }>('/api/auth/me'); }
  login(username: string, password: string) { return this.request<{ user: PlatformUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); }
  requestOtp(username: string) { return this.request<OtpRequestResult>('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ username }) }); }
  verifyOtp(username: string, passcode: string) { return this.request<{ user: PlatformUser }>('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ username, passcode }) }); }
  updateProfile(payload: ProfileUpdate) { return this.request<{ user: PlatformUser }>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) }); }
  logout() { return this.request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }); }
  vehicles() { return this.request<{ vehicles: Vehicle[] }>('/api/vehicles'); }
  users() { return this.request<{ users: PlatformUser[] }>('/api/users'); }
  createUser(input: { username: string; displayName: string; password: string; role: 'admin' | 'operator'; email?: string }) { return this.request<{ user: PlatformUser }>('/api/users', { method: 'POST', body: JSON.stringify(input) }); }
  updateUser(id: string, input: { active?: boolean; email?: string | null }) { return this.request<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  audit() { return this.request<{ logs: AuditLog[] }>('/api/audit-logs'); }
  track(vehicleId: string, from?: string, to?: string) { const search = new URLSearchParams(); if (from) search.set('from', from); if (to) search.set('to', to); return this.request<{ points: TrackPoint[] }>(`/api/vehicles/${vehicleId}/track?${search}`); }
  acquireLease(vehicleId: string) { return this.request<Lease>(`/api/vehicles/${vehicleId}/control-lease`, { method: 'POST', body: '{}' }); }
  renewLease(leaseId: string) { return this.request<Omit<Lease, 'leaseId'>>(`/api/control-leases/${leaseId}/renew`, { method: 'POST', body: '{}' }); }
  releaseLease(leaseId: string) { return this.request<{ ok: true }>(`/api/control-leases/${leaseId}`, { method: 'DELETE' }); }
}
