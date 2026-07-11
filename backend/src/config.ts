export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  host: string;
  port: number;
  cookieSecure: boolean;
  publicOrigin: string | undefined;
  allowedOrigins: string[];
  bootstrapAdminUsername: string | undefined;
  bootstrapAdminPassword: string | undefined;
  bootstrapAdminEmail: string | undefined;
  otpExpiryMinutes: number;
  otpResendCooldownSeconds: number;
  aiBaseUrl: string | undefined;
  aiApiKey: string | undefined;
  aiModel: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const publicOrigin = process.env.PLATFORM_PUBLIC_ORIGIN;
  const allowedOrigins = [...new Set([
    ...(process.env.PLATFORM_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    ...(publicOrigin ? [publicOrigin] : []),
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])];
  const config: Config = {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://oh_ai_car:oh_ai_car@127.0.0.1:5432/oh_ai_car',
    sessionSecret: process.env.SESSION_SECRET ?? 'development-only-change-me',
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8788),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    publicOrigin,
    allowedOrigins,
    bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES ?? 5),
    otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
    aiBaseUrl: process.env.AI_BASE_URL,
    aiApiKey: process.env.AI_API_KEY,
    aiModel: process.env.AI_MODEL ?? 'gpt-4.1-mini',
    ...overrides,
  };
  if (process.env.NODE_ENV === 'production' && !config.publicOrigin) throw new Error('PLATFORM_PUBLIC_ORIGIN is required in production');
  return config;
}
