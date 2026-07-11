import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatrolPanel } from '../src/components/PatrolPanel.js';
import type { PlatformClient } from '../src/services/platformClient.js';

describe('PatrolPanel', () => {
  it('creates a patrol from a saved route and whitelist', async () => {
    const client = {
      patrolRoutes: vi.fn().mockResolvedValue({ routes: [{ id: 'route-1', name: '日常路线', mapVersion: 'map-v1', sourceYaml: '', createdAt: '2026-07-11T00:00:00Z', waypoints: [{ id: 'waypoint-1', ordinal: 0, name: '南门', x: 1, y: 2, yaw: 0, dwellSeconds: 8, noParkingRoi: null }] }] }),
      whitelists: vi.fn().mockResolvedValue({ whitelists: [{ id: 'whitelist-1', name: '业主名单', createdAt: '2026-07-11T00:00:00Z', entryCount: 1 }] }),
      patrolTasks: vi.fn().mockResolvedValue({ tasks: [] }),
      createPatrolTask: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
    } as unknown as PlatformClient;
    render(<PatrolPanel client={client} vehicle={{ id: 'vehicle-1', code: 'CAR-1', name: '巡检车', description: '', host: '127.0.0.1', tcpPort: 6000, videoPort: 6500, archived: false }} isAdmin onStatus={vi.fn()} />);
    await screen.findByText('日常路线（1 点）');
    fireEvent.click(screen.getByRole('button', { name: '创建巡检任务' }));
    await waitFor(() => expect(client.createPatrolTask).toHaveBeenCalledWith('vehicle-1', { routeId: 'route-1', whitelistId: 'whitelist-1', shift: '日间巡检' }));
    expect(screen.getByText('导入路线 YAML')).toBeInTheDocument();
    expect(screen.getByText('导入车辆白名单 CSV')).toBeInTheDocument();
  });

  it('shows a pending cancellation instead of offering a second stop action', async () => {
    const client = {
      patrolRoutes: vi.fn().mockResolvedValue({ routes: [] }), whitelists: vi.fn().mockResolvedValue({ whitelists: [] }),
      patrolTasks: vi.fn().mockResolvedValue({ tasks: [{ id: 'task-1', vehicleId: 'vehicle-1', routeId: 'route-1', whitelistId: 'whitelist-1', routeName: '日常路线', shift: '日间巡检', status: 'cancellation_requested', startedAt: '2026-07-11T00:00:00Z', stopRequestedAt: '2026-07-11T00:10:00Z', stopConfirmedAt: null, zeroVelocityConfirmedAt: null, finishedAt: null, failureReason: null, createdAt: '2026-07-11T00:00:00Z' }] }),
    } as unknown as PlatformClient;
    render(<PatrolPanel client={client} vehicle={{ id: 'vehicle-1', code: 'CAR-1', name: '巡检车', description: '', host: '127.0.0.1', tcpPort: 6000, videoPort: 6500, archived: false }} isAdmin={false} onStatus={vi.fn()} />);
    expect(await screen.findByText('等待调度器确认零速度')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '请求安全停止' })).not.toBeInTheDocument();
  });
});
