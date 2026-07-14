import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const amapCode = env.AMAP_SECURITY_JS_CODE ?? process.env.AMAP_SECURITY_JS_CODE ?? '';

  return {
    envDir: '..',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': 'http://127.0.0.1:8788',
        '/ws': { target: 'ws://127.0.0.1:8788', ws: true },
        '/patrol': { target: 'ws://127.0.0.1:8788', ws: true },
        '/gateway-api': {
          target: 'http://127.0.0.1:8787',
          rewrite: (path) => path.replace(/^\/gateway-api/, ''),
        },
        '/plate-api': {
          target: 'http://127.0.0.1:8010',
          rewrite: (path) => path.replace(/^\/plate-api/, ''),
        },
        '/_AMapService': {
          target: 'https://restapi.amap.com',
          changeOrigin: true,
          timeout: 15000,
          proxyTimeout: 15000,
          rewrite: (path) => path.replace(/^\/_AMapService/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (!amapCode) return;
              const separator = proxyReq.path.includes('?') ? '&' : '?';
              proxyReq.path = `${proxyReq.path}${separator}jscode=${encodeURIComponent(amapCode)}`;
            });
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './tests/setup.ts',
      // Classic console tests must not be gated by platform login UI.
      env: { VITE_PLATFORM_ENABLED: 'false' },
    },
  };
});
