import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoPanel } from '../src/components/VideoPanel.js';

describe('video panel', () => {
  it('uses the documented direct video endpoint and exposes a failure state', async () => {
    render(<VideoPanel host="192.168.1.11" port={6500} />);
    const frame = screen.getByTitle('小车视频预览');
    expect(frame).toHaveAttribute('src', 'http://192.168.1.11:6500/index2');
    fireEvent.error(frame);
    expect(await screen.findByText(/浏览器无法加载视频服务/)).toBeInTheDocument();
  });

  it('does not treat an iframe load event as confirmed video-stream health', () => {
    render(<VideoPanel host="192.168.1.11" port={6500} />);
    const frame = screen.getByTitle('小车视频预览');
    fireEvent.load(frame);
    expect(screen.getByText('视频页面已加载，视频流状态仍需人工确认')).toBeInTheDocument();
  });

  it('provides a recognition entry when the caller supplies one', () => {
    const openRecognition = vi.fn();
    render(<VideoPanel host="192.168.1.11" port={6500} onOpenRecognition={openRecognition} />);

    fireEvent.click(screen.getByRole('button', { name: '车牌识别' }));

    expect(openRecognition).toHaveBeenCalledOnce();
  });
});
