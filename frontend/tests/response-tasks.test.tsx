import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseTasksPage } from '../src/pages/responses/ResponseTasksPage.js';
import type { ResponseTask } from '../src/services/api.js';
import * as responseClient from '../src/services/responseClient.js';

vi.mock('../src/contexts/SelectedDeviceContext.js', () => ({
  useSelectedDevice: () => ({ selectedId: null }),
}));

vi.mock('../src/services/responseClient.js', () => ({
  tasks: vi.fn(),
  confirm: vi.fn(),
  retryPush: vi.fn(),
  assign: vi.fn(),
  cancel: vi.fn(),
  liveUrl: vi.fn(() => 'ws://127.0.0.1/patrol/live'),
}));

function task(overrides: Partial<ResponseTask>): ResponseTask {
  return {
    id: 'task',
    observationId: 'observation',
    violationId: 'violation',
    sourceVehicleId: 'vehicle',
    sourceVehicleName: '巡检车',
    plate: '京A12345',
    ownerName: '张同学',
    building: '3号楼',
    ownerWxUid: 'UID_test',
    status: 'pending_review',
    eligibilityReason: 'test',
    waypoint: '东门',
    confidence: 0.96,
    createdAt: '2026-07-16T00:00:00.000Z',
    notificationOnly: true,
    smsStatus: 'none',
    ...overrides,
  };
}

describe('ResponseTasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(responseClient.tasks).mockResolvedValue([
      task({ id: 'pending', plate: '京A10001' }),
      task({ id: 'retry', plate: '京A10002', status: 'confirmed', smsStatus: 'failed', smsError: 'timeout' }),
      task({
        id: 'legacy',
        plate: '京A10003',
        notificationOnly: false,
        status: 'confirmed',
        destinationName: '8号楼门口',
        assignedVehicleName: null,
      }),
      task({ id: 'completed', plate: '京A10004', status: 'completed', smsStatus: 'sent' }),
    ]);
    vi.mocked(responseClient.confirm).mockResolvedValue({
      ok: true,
      notificationCompleted: true,
      advice: { suggestion: '通知', notification: '请移车', source: 'template' },
      push: { status: 'sent', message: '微信通知已发送', requestId: 'request-1' },
    });
    vi.mocked(responseClient.retryPush).mockResolvedValue({
      ok: true,
      notificationCompleted: true,
      push: { status: 'sent', message: '重新发送成功', requestId: 'request-2' },
    });
    vi.mocked(responseClient.assign).mockResolvedValue({
      ok: true,
      assignedVehicleId: 'vehicle-legacy',
      deduplicated: false,
    });
  });

  it('only exposes actions backed by the notification or historical dispatch APIs', async () => {
    const user = userEvent.setup();
    render(<ResponseTasksPage />);

    await screen.findByText('京A10001');
    expect(screen.getByText('历史上门任务')).toBeInTheDocument();
    expect(screen.getByText(/目的地：8号楼门口/)).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新发送' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '确认并发送微信' }));
    await waitFor(() => expect(responseClient.confirm).toHaveBeenCalledWith('pending'));

    await user.click(screen.getByRole('button', { name: '重新发送' }));
    await waitFor(() => expect(responseClient.retryPush).toHaveBeenCalledWith('retry'));

    await user.click(screen.getByRole('button', { name: '重试分配' }));
    await waitFor(() => expect(responseClient.assign).toHaveBeenCalledWith('legacy'));
  });
});
