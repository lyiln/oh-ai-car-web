import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ButtonControl } from '../src/controls/ButtonControl.js';

describe('button controls', () => {
  it('sends direction on press and Stop on release', () => {
    const send = vi.fn(); render(<ButtonControl disabled={false} send={send} />);
    const button = screen.getByTitle('前进');
    fireEvent.pointerDown(button, { pointerId: 1 }); fireEvent.pointerUp(button, { pointerId: 1 });
    expect(send).toHaveBeenNthCalledWith(1, 'button', { direction: 'Front' });
    expect(send).toHaveBeenNthCalledWith(2, 'button', { direction: 'Stop' });
  });

  it('maps Arrow keys to movement and stops on key release', () => {
    const send = vi.fn(); render(<ButtonControl disabled={false} send={send} />);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowUp', repeat: true });
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    expect(send).toHaveBeenNthCalledWith(1, 'button', { direction: 'Front' });
    expect(send).toHaveBeenNthCalledWith(2, 'button', { direction: 'Stop' });
  });

  it('keeps keyboard movement out of text fields', () => {
    const send = vi.fn(); render(<><input aria-label="test input" /><ButtonControl disabled={false} send={send} /></>);
    const input = screen.getByLabelText('test input'); input.focus();
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(send).not.toHaveBeenCalled();
  });
});
