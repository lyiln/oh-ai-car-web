import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionSettings } from '../src/components/ConnectionSettings.js';

describe('connection safety state', () => {
  afterEach(cleanup);

  it('locks address changes while connected', () => {
    render(<ConnectionSettings config={{ host: '192.168.1.11', tcpPort: 6000, videoPort: 6500 }} configDisabled={true} connectDisabled={true} disconnectDisabled={false} onChange={vi.fn()} onConnect={vi.fn()} onDisconnect={vi.fn()} />);
    expect(screen.getByLabelText('小车 IP')).toBeDisabled();
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled();
  });

  it('does not let an observer connect or disconnect another page\'s car session', () => {
    render(<ConnectionSettings config={{ host: '192.168.1.11', tcpPort: 6000, videoPort: 6500 }} configDisabled={false} connectDisabled={true} disconnectDisabled={true} onChange={vi.fn()} onConnect={vi.fn()} onDisconnect={vi.fn()} />);
    expect(screen.getByLabelText('小车 IP')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '断开' })).toBeDisabled();
  });
});
