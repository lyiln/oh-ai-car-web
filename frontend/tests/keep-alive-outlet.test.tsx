import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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

describe('KeepAliveOutlet', () => {
  it('keeps visited routes mounted when navigating away and back', async () => {
    (MountCounter as unknown as { counts: Record<string, number> }).counts = {};
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <KeepAliveOutlet />,
          children: [
            { path: 'a', element: <MountCounter label="page-a" /> },
            { path: 'b', element: <MountCounter label="page-b" /> },
          ],
        },
      ],
      { initialEntries: ['/a'] },
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { name: 'page-a' })).toBeInTheDocument();
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');

    await act(async () => {
      await router.navigate('/b');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'page-b' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');
    expect(screen.getByTestId('page-b-mounts')).toHaveTextContent('1');

    await act(async () => {
      await router.navigate('/a');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'page-a' })).toBeInTheDocument();
    });
    // Remount would bump this count; keep-alive must keep it at 1.
    expect(screen.getByTestId('page-a-mounts')).toHaveTextContent('1');
    expect(screen.getByTestId('page-b-mounts')).toHaveTextContent('1');
  });
});
