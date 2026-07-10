import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionSettings } from '../src/components/ConnectionSettings.js';

describe('connection safety state', () => {
  it('locks address changes while connected', () => {
    render(<ConnectionSettings config={{ host: '192.168.1.11', tcpPort: 6000, videoPort: 6500 }} disabled={true} onChange={vi.fn()} onConnect={vi.fn()} onDisconnect={vi.fn()} />);
    expect(screen.getByLabelText('小车 IP')).toBeDisabled();
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled();
  });
});
