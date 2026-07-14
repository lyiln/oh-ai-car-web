export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  host: string;
  port: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  publicOrigin: string | undefined;
  allowedOrigins: string[];
  bootstrapAdminUsername: string | undefined;
  bootstrapAdminPassword: string | undefined;
  bootstrapAdminEmail: string | undefined;
  otpExpiryMinutes: number;
  otpResendCooldownSeconds: number;
  smtpHost: string | undefined;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | undefined;
  smtpPassword: string | undefined;
  smtpFrom: string | undefined;
  aiBaseUrl: string | undefined;
  aiApiKey: string | undefined;
  aiModel: string;
  aiModelFast: string;
  wxPusherAppToken: string | undefined;
  wxPusherEndpoint: string;
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
    trustProxy: process.env.PLATFORM_TRUST_PROXY === 'true',
    publicOrigin,
    allowedOrigins,
    bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES ?? 5),
    otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpFrom: process.env.SMTP_FROM,
    aiBaseUrl: process.env.AI_BASE_URL,
    aiApiKey: process.env.AI_API_KEY,
    aiModel: process.env.AI_MODEL ?? 'deepseek-v4-pro',
    aiModelFast: process.env.AI_MODEL_FAST ?? 'deepseek-v4-flash',
    wxPusherAppToken: process.env.WXPUSHER_APP_TOKEN,
    wxPusherEndpoint: process.env.WXPUSHER_ENDPOINT ?? 'https://wxpusher.zjiecode.com',
    ...overrides,
  };
  if (process.env.NODE_ENV === 'production') {
    if (!config.publicOrigin) throw new Error('PLATFORM_PUBLIC_ORIGIN is required in production');
    if (config.sessionSecret === 'development-only-change-me' || config.sessionSecret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters and must not use the development default in production');
    }
    if (!config.cookieSecure) throw new Error('COOKIE_SECURE=true is required in production');
    if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.smtpFrom) {
      throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM are required in production');
    }
  }
  return config;
}
