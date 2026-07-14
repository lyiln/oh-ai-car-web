import { apiRequest } from './api.js';

export interface NavStatus {
  prepareRequested: boolean;
  prepareRequestedAt?: string | null;
  supervisorOnline: boolean;
  poseOk: boolean;
  gotoOk: boolean;
  nav2Ok: boolean;
  bringupOk: boolean;
  ready: boolean;
  detail: string;
  updatedAt?: string;
  pendingInitialPose?: boolean;
  hasInitialPoseOnce?: boolean;
  initialPose?: { x: number; y: number; yaw: number; seq: number } | null;
}

export async function navStatus(vehicleId: string): Promise<NavStatus> {
  const result = await apiRequest<{ status: NavStatus }>(`/api/vehicles/${vehicleId}/nav/status`);
  return result.status;
}

export async function prepareNav(vehicleId: string): Promise<NavStatus> {
  const result = await apiRequest<{ status: NavStatus }>(`/api/vehicles/${vehicleId}/nav/prepare`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return result.status;
}

export async function setInitialPose(
  vehicleId: string,
  input: { x: number; y: number; yaw?: number },
): Promise<NavStatus> {
  const result = await apiRequest<{ status: NavStatus }>(`/api/vehicles/${vehicleId}/nav/initial-pose`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.status;
}
