import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { KeepAliveOutlet } from '../src/components/layout/KeepAliveOutlet.js';

function MountCounter({ label }: { label: string }) {
  const mounts = (MountCounter as unknown as { counts: Record<string, number> }).counts;
  mounts[label] = (mounts[label] ?? 0) + 1;
  return (
    <div>
      <h1>{label}</h1>
      <p data-testid={`${label}-mounts`}>{mounts[label]}</p>
    </div>
  );
}
(MountCounter as unknown as { counts: Record<string, number> }).counts = {};

function TestNavigation() {
  const navigate = useNavigate();
  return (
    <nav>
      <button type="button" onClick={() => navigate('/a')}>Go to A</button>
      <button type="button" onClick={() => navigate('/b')}>Go to B</button>
    </nav>
  );
}

describe('KeepAliveOutlet', () => {
  it('keeps visited routes mounted when navigating away and back', async () => {
    (MountCounter as unknown as { counts: Record<string, number> }).counts = {};
    render(
      <MemoryRouter initialEntries={['/a']}>
        <TestNavigation />
        <Routes>
          <Route path="/" element={<KeepAliveOutlet />}>
            <Route path="a" element={<MountCounter label="page-a" />} />
            <Route path="b" element={<MountCounter label="page-b" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'page-a' })).toBeInTheDocument();
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Go to B' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'page-b' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');
    expect(screen.getByTestId('page-b-mounts')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Go to A' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'page-a' })).toBeInTheDocument();
    });
    // Remount would bump this count; keep-alive must keep it at 1.
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');
    expect(screen.getByTestId('page-b-mounts')).toHaveTextContent('1');
  });
});
