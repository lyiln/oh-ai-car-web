import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, listeners } = vi.hoisted(() => ({ send: vi.fn(), listeners: new Set<(state: { type: 'state'; connected: boolean; target: { host: string; tcpPort: number; videoPort: number } | null; ownsControl: boolean; controlAvailable: boolean; lastError: string | null }) => void>() }));

vi.mock('../src/services/controlClient.js', () => ({
  ControlClient: class {
    async open(): Promise<void> {}
    onState(listener: (state: { type: 'state'; connected: boolean; target: { host: string; tcpPort: number; videoPort: number } | null; ownsControl: boolean; controlAvailable: boolean; lastError: string | null }) => void): () => void {
      listeners.add(listener);
      listener({ type: 'state', connected: true, target: { host: '127.0.0.1', tcpPort: 6000, videoPort: 6500 }, ownsControl: true, controlAvailable: true, lastError: null });
      return () => listeners.delete(listener);
    }
    send = send;
    close(): void {}
  },
}));

import App from '../src/app/App.js';

describe('command confirmation state', () => {
  beforeEach(() => { send.mockReset(); listeners.clear(); });
  afterEach(() => cleanup());

  it('marks recording active only after the gateway confirms the write', async () => {
    let resolve: (() => void) | undefined;
    send.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    render(<App />);
    const button = await screen.findByTitle('开始录像');
    fireEvent.click(button);
    expect(send).toHaveBeenCalledWith('startRecording', {});
    expect(button).toBeDisabled();
    resolve?.();
    await waitFor(() => expect(screen.getByTitle('停止录像')).toBeInTheDocument());
  });

  it('keeps tracking disabled in the UI when the gateway rejects the command', async () => {
    send.mockRejectedValueOnce(new Error('TCP socket is not connected'));
    render(<App />);
    const toggle = await screen.findByRole('checkbox');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(send).toHaveBeenCalledWith('tracking', { enabled: true });
  });

  it('disables all car controls when another browser owns the connection', async () => {
    render(<App />);
    for (const listener of listeners) listener({ type: 'state', connected: true, target: { host: '127.0.0.1', tcpPort: 6000, videoPort: 6500 }, ownsControl: false, controlAvailable: false, lastError: null });
    expect(await screen.findByText('其他页面正在控制')).toBeInTheDocument();
    expect(screen.getByTitle('前进')).toBeDisabled();
    expect(screen.getByRole('button', { name: '断开' })).toBeDisabled();
  });

  it('clears media and tracking state after a disconnected state event', async () => {
    render(<App />);
    fireEvent.click(await screen.findByTitle('开始录像'));
    await waitFor(() => expect(screen.getByTitle('停止录像')).toBeInTheDocument());
    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());

    for (const listener of listeners) listener({ type: 'state', connected: false, target: null, ownsControl: false, controlAvailable: true, lastError: '网关连接已关闭' });

    await waitFor(() => expect(screen.getByTitle('开始录像')).toBeInTheDocument());
    expect(toggle).not.toBeChecked();
  });
});
