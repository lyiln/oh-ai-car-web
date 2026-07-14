import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const productionKeys = ['NODE_ENV', 'SESSION_SECRET', 'COOKIE_SECURE', 'PLATFORM_PUBLIC_ORIGIN', 'PLATFORM_ALLOWED_ORIGINS', 'PLATFORM_TRUST_PROXY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;
const original = Object.fromEntries(productionKeys.map((key) => [key, process.env[key]]));

function production(overrides: Record<string, string | undefined> = {}) {
  const values = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a'.repeat(32),
    COOKIE_SECURE: 'true',
    PLATFORM_PUBLIC_ORIGIN: 'https://platform.example.test',
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'mailer-password',
    SMTP_FROM: 'PatrolPlate <no-reply@example.test>',
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
    ['missing SMTP configuration', { SMTP_HOST: undefined }],
  ])('rejects %s', (_name, overrides) => {
    production(overrides);
    expect(() => loadConfig()).toThrow();
  });
});

describe('trusted proxy configuration', () => {
  it('is disabled by default and enabled only explicitly', () => {
    delete process.env.PLATFORM_TRUST_PROXY;
    expect(loadConfig().trustProxy).toBe(false);
    process.env.PLATFORM_TRUST_PROXY = 'true';
    expect(loadConfig().trustProxy).toBe(true);
  });
});
