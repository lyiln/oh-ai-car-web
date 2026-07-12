import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const productionKeys = ['NODE_ENV', 'SESSION_SECRET', 'COOKIE_SECURE', 'PLATFORM_PUBLIC_ORIGIN', 'PLATFORM_ALLOWED_ORIGINS'] as const;
const original = Object.fromEntries(productionKeys.map((key) => [key, process.env[key]]));

function production(overrides: Record<string, string | undefined> = {}) {
  const values = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a'.repeat(32),
    COOKIE_SECURE: 'true',
    PLATFORM_PUBLIC_ORIGIN: 'https://platform.example.test',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of productionKeys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('production configuration', () => {
  it('accepts a secure production configuration', () => {
    production();
    expect(loadConfig()).toMatchObject({ cookieSecure: true, publicOrigin: 'https://platform.example.test' });
  });

  it.each([
    ['the default secret', { SESSION_SECRET: undefined }],
    ['a short secret', { SESSION_SECRET: 'short-secret' }],
    ['an insecure cookie', { COOKIE_SECURE: 'false' }],
    ['a missing public origin', { PLATFORM_PUBLIC_ORIGIN: undefined }],
  ])('rejects %s', (_name, overrides) => {
    production(overrides);
    expect(() => loadConfig()).toThrow();
  });
});
