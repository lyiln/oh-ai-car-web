import { afterEach, describe, expect, it, vi } from 'vitest';
import * as gotoClient from '../src/services/gotoClient.js';
import { canCreateGoto, type NavStatus } from '../src/services/navClient.js';

describe('FloorMap goto guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('allows map goals only when navigation is explicitly ready', () => {
    expect(canCreateGoto(null)).toBe(false);
    expect(canCreateGoto(undefined)).toBe(false);
    expect(canCreateGoto({ ready: false } as NavStatus)).toBe(false);
    expect(canCreateGoto({ ready: true } as NavStatus)).toBe(true);
  });

  it('loads the latest goal so terminal failures remain visible', async () => {
    const failedGoal = {
      id: 'goal-1', vehicleId: 'vehicle-1', x: 1, y: 2, yaw: 0,
      status: 'failed', failureReason: 'NavigateToPose unavailable',
    };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ goal: failedGoal }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(gotoClient.latestGoto('vehicle-1')).resolves.toMatchObject(failedGoal);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/vehicles/vehicle-1/goto/latest');
    expect(gotoClient.isGotoActive(failedGoal)).toBe(false);
    expect(gotoClient.isGotoActive({ ...failedGoal, status: 'queued' })).toBe(true);
  });
});
