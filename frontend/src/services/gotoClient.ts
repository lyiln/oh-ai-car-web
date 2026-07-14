import { apiRequest } from './api.js';

export interface GotoGoal {
  id: string;
  vehicleId: string;
  x: number;
  y: number;
  yaw: number;
  status: 'queued' | 'navigating' | 'arrived' | 'cancelled' | 'failed' | 'cancellation_requested' | string;
  createdAt?: string;
  claimedAt?: string | null;
  finishedAt?: string | null;
  failureReason?: string | null;
}

export async function activeGoto(vehicleId: string): Promise<GotoGoal | null> {
  const result = await apiRequest<{ goal: GotoGoal | null }>(`/api/vehicles/${vehicleId}/goto/active`);
  return result.goal ?? null;
}

export async function createGoto(vehicleId: string, input: { x: number; y: number; yaw?: number }): Promise<GotoGoal> {
  const result = await apiRequest<{ goal: GotoGoal }>(`/api/vehicles/${vehicleId}/goto`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.goal;
}

export async function cancelGoto(
  vehicleId: string,
  options?: { force?: boolean },
): Promise<{ id: string; status: string }> {
  const result = await apiRequest<{ goal: { id: string; status: string } }>(`/api/vehicles/${vehicleId}/goto/cancel`, {
    method: 'POST',
    body: JSON.stringify({ force: options?.force === true }),
  });
  return result.goal;
}
