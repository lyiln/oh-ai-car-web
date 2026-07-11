import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../',
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8788', '/ws': { target: 'ws://127.0.0.1:8788', ws: true } } },
  test: { environment: 'jsdom', setupFiles: './tests/setup.ts' },
});
