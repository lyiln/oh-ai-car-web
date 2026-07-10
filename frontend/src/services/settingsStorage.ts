import { DEFAULT_CONNECTION_CONFIG, type ConnectionConfig } from '@oh-ai-car-web/shared';

const KEY = 'oh-ai-car-web.connection-config';

export function loadSettings(): ConnectionConfig {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<ConnectionConfig> | null;
    if (parsed && typeof parsed.host === 'string' && typeof parsed.tcpPort === 'number' && Number.isInteger(parsed.tcpPort) && typeof parsed.videoPort === 'number' && Number.isInteger(parsed.videoPort)) {
      return { host: parsed.host, tcpPort: parsed.tcpPort, videoPort: parsed.videoPort };
    }
  } catch { /* fall back to documented defaults */ }
  return { ...DEFAULT_CONNECTION_CONFIG };
}

export function saveSettings(config: ConnectionConfig): void { window.localStorage.setItem(KEY, JSON.stringify(config)); }
