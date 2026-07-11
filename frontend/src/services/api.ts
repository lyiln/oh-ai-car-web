export type { TrackPoint } from './platformClient.js';

export interface Device {
  id: string;
  name: string;
  code: string;
  host: string;
  tcpPort: number;
  videoPort: number;
  bridgeUrl?: string;
  description?: string;
  status?: 'online' | 'offline' | 'patrolling' | 'fault';
  lastPatrolAt?: string | null;
  archived?: boolean;
}

export interface PatrolTask {
  id: string;
  deviceId: string;
  deviceName?: string;
  routeId: string;
  routeName?: string;
  shift?: 'morning' | 'noon' | 'evening' | string;
  status: 'idle' | 'running' | 'navigating' | 'detecting' | 'completed' | 'failed' | string;
  startedAt?: string | null;
  endedAt?: string | null;
  waypointDone?: number;
  waypointTotal?: number;
  eventCount?: number;
  violationCount?: number;
  recognizedCount?: number;
  currentWaypoint?: string | null;
}

export interface PatrolEvent {
  id: string;
  taskId: string;
  plate?: string | null;
  verdict?: string;
  waypoint?: string | null;
  occurredAt: string;
  confidence?: number | null;
  thumbnailUrl?: string | null;
  message?: string;
}

export interface MapZone {
  id: string;
  name: string;
  type?: 'no_parking' | string;
  coordinates: Array<[number, number]>;
  color?: string;
  createdAt?: string;
}

export interface Violation {
  id: string;
  plate: string;
  type: string;
  location?: string | null;
  waypoint?: string | null;
  zoneName?: string | null;
  occurredAt: string;
  taskId?: string | null;
  deviceId?: string | null;
  evidenceUrl?: string | null;
  priority?: 'high' | 'normal' | 'low' | string;
  status?: 'pending' | 'confirmed' | 'false_positive' | 'resolved' | string;
}

export interface Review {
  id: string;
  eventId: string;
  plate?: string | null;
  reason: string;
  occurredAt: string;
  waypoint?: string | null;
  deviceName?: string | null;
  evidenceUrl?: string | null;
  suggestion?: string | null;
}

export interface WhitelistEntry {
  id: string;
  plate: string;
  owner?: string | null;
  building?: string | null;
  parkingSpot?: string | null;
  vehicleType?: 'private' | 'visitor';
  validUntil?: string | null;
}

export interface DashboardSummary {
  onlineDevices: number;
  todayPatrols: number;
  pendingReviews: number;
  violations: number;
  recentTasks?: PatrolTask[];
  alerts?: Array<{ id: string; message: string; priority?: string; occurredAt?: string }>;
}

export interface PatrolReport {
  id: string;
  taskId: string;
  deviceName?: string;
  date?: string;
  violationCount?: number;
  visitorCount?: number;
  htmlUrl?: string | null;
  csvUrl?: string | null;
  zipUrl?: string | null;
  summary?: string;
}

export interface DeviceStatus {
  online: boolean;
  batteryPct?: number | null;
  mode?: string | null;
  message?: string;
}

export interface DevicePose {
  longitude: number;
  latitude: number;
  headingDeg?: number | null;
  occurredAt?: string;
}

export interface PatrolRoute {
  id: string;
  name: string;
  waypointCount?: number;
}

export interface MapMeta {
  name?: string;
  width?: number;
  height?: number;
  origin?: { x: number; y: number };
  resolution?: number;
  imageUrl?: string | null;
}

export interface Waypoint {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  order?: number;
}

export interface ResidentDestination {
  id: string;
  vehicleId: string;
  building: string;
  residentKey: string;
  displayName: string;
  mapVersion: string;
  x: number;
  y: number;
  yaw: number;
  active: boolean;
}

export interface ResponseTask {
  id: string;
  observationId: string;
  violationId?: string | null;
  sourceVehicleId: string;
  sourceVehicleName: string;
  assignedVehicleId?: string | null;
  assignedVehicleName?: string | null;
  destinationId: string;
  destinationName: string;
  mapVersion: string;
  plate: string;
  ownerName: string;
  building: string;
  status: 'pending_review' | 'confirmed' | 'assigned' | 'navigating' | 'arrived' | 'cancellation_requested' | 'completed' | 'cancelled' | 'failed';
  eligibilityReason: string;
  aiSuggestion?: string;
  notificationText?: string;
  evidenceUrl?: string | null;
  arrivalEvidenceUrl?: string | null;
  failureReason?: string | null;
  waypoint: string;
  confidence: number;
  x: number;
  y: number;
  yaw: number;
  createdAt: string;
}

const baseUrl = () => import.meta.env.VITE_PLATFORM_API_URL ?? window.location.origin;

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, baseUrl()), {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `请求失败 (${response.status})`);
  return value;
}

export function apiBaseUrl(): string {
  return baseUrl();
}
