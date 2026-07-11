export interface PlatformUser { id: string; username: string; displayName: string; role: 'admin' | 'operator'; active?: boolean; }
export interface Vehicle { id: string; code: string; name: string; description: string; host: string; tcpPort: number; videoPort: number; archived: boolean; }
export interface Lease { leaseId: string; expiresAt: string; gatewayToken: string; }
export interface TrackPoint { occurredAt: string; longitude: number; latitude: number; altitudeM: number | null; accuracyM: number | null; speedKph: number | null; headingDeg: number | null; batteryPct: number | null; mode: string | null; }
export interface AuditLog { id: string; actorUserId: string | null; vehicleId: string | null; action: string; outcome: string; metadata: unknown; createdAt: string; }
export interface PatrolWaypoint { id: string; ordinal: number; name: string; x: number; y: number; yaw: number; dwellSeconds: number; noParkingRoi: number[] | null; }
export interface PatrolRoute { id: string; name: string; mapVersion: string; sourceYaml: string; createdAt: string; waypoints: PatrolWaypoint[]; }
export interface Whitelist { id: string; name: string; createdAt: string; entryCount: number; }
export interface PatrolTask { id: string; vehicleId: string; routeId: string; whitelistId: string; routeName?: string; shift: string; status: 'draft' | 'queued' | 'running' | 'cancellation_requested' | 'stopped' | 'completed' | 'failed'; startedAt: string | null; stopRequestedAt: string | null; stopConfirmedAt: string | null; zeroVelocityConfirmedAt: string | null; finishedAt: string | null; failureReason: string | null; createdAt: string; }
export interface PlateObservation { id: string; waypointId: string; occurredAt: string; plate: string | null; confidence: number; classification: 'pending_review' | 'registered_private' | 'visitor' | 'suspected_external'; noParking: boolean; evidenceImageUrl: string | null; annotatedImageUrl: string | null; longitude: number | null; latitude: number | null; observationCount: number; lastSeenAt: string; }
export interface PatrolDetail { task: PatrolTask; events: Array<{ id: string; eventType: string; waypointId: string | null; details: unknown; createdAt: string }>; observations: PlateObservation[]; }

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
  patrolRoutes(vehicleId: string) { return this.request<{ routes: PatrolRoute[] }>(`/api/vehicles/${vehicleId}/patrol-routes`); }
  createPatrolRoute(vehicleId: string, payload: { name: string; mapVersion: string; yaml: string }) { return this.request<{ routeId: string }>(`/api/vehicles/${vehicleId}/patrol-routes`, { method: 'POST', body: JSON.stringify(payload) }); }
  whitelists(vehicleId: string) { return this.request<{ whitelists: Whitelist[] }>(`/api/vehicles/${vehicleId}/whitelists`); }
  createWhitelist(vehicleId: string, payload: { name: string; csv: string }) { return this.request<{ whitelistId: string; entries: number }>(`/api/vehicles/${vehicleId}/whitelists`, { method: 'POST', body: JSON.stringify(payload) }); }
  patrolTasks(vehicleId: string) { return this.request<{ tasks: PatrolTask[] }>(`/api/vehicles/${vehicleId}/patrol-tasks`); }
  createPatrolTask(vehicleId: string, payload: { routeId: string; whitelistId: string; shift: string }) { return this.request<{ taskId: string }>(`/api/vehicles/${vehicleId}/patrol-tasks`, { method: 'POST', body: JSON.stringify(payload) }); }
  startPatrolTask(vehicleId: string, taskId: string) { return this.request<{ ok: true }>(`/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/start`, { method: 'POST' }); }
  stopPatrolTask(vehicleId: string, taskId: string) { return this.request<{ stopRequestedAt: string }>(`/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/stop`, { method: 'POST' }); }
  activePatrolTask(vehicleId: string) { return this.request<{ task: PatrolTask | null }>(`/api/vehicles/${vehicleId}/patrol-tasks/active`); }
  patrolDetail(vehicleId: string, taskId: string) { return this.request<PatrolDetail>(`/api/vehicles/${vehicleId}/patrol-tasks/${taskId}`); }
  patrolReport(vehicleId: string, taskId: string) { return this.request<PatrolDetail & { summary: { registeredPrivate: number; visitor: number; suspectedExternal: number; pendingReview: number; noParking: number }; html: string }>(`/api/vehicles/${vehicleId}/patrol-tasks/${taskId}/report`); }
}
