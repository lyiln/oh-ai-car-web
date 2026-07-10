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
});
