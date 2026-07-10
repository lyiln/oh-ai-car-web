import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SignedPayload { sub: string; role: 'admin' | 'operator'; exp: number; [key: string]: unknown; }
const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function sign(payload: SignedPayload, secret: string): string {
  const body = encode(JSON.stringify(payload));
  const signature = encode(createHmac('sha256', secret).update(body).digest());
  return `${body}.${signature}`;
}

export function verify<T extends SignedPayload>(token: string, secret: string): T | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = encode(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; return typeof parsed.exp === 'number' && parsed.exp > Date.now() ? parsed : null; }
  catch { return null; }
}

export const randomSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (secret: string) => createHmac('sha256', 'device-credential-v1').update(secret).digest('hex');
