import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../src/services/settingsStorage.js';

describe('connection settings storage', () => {
  beforeEach(() => window.localStorage.clear());
  it('uses the documented defaults and persists a valid replacement', () => {
    expect(loadSettings()).toMatchObject({ host: '192.168.1.11', tcpPort: 6000, videoPort: 6500 });
    saveSettings({ host: '10.0.0.2', tcpPort: 7000, videoPort: 7001 });
    expect(loadSettings()).toMatchObject({ host: '10.0.0.2', tcpPort: 7000, videoPort: 7001 });
  });
});
