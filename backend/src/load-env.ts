import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const rootDir = resolve(process.cwd(), '..');
const sharedEnv = resolve(rootDir, '.env.development');
const localEnv = resolve(rootDir, '.env');

if (existsSync(sharedEnv)) config({ path: sharedEnv });
if (existsSync(localEnv)) config({ path: localEnv, override: true });

if (!process.env.DATABASE_URL && process.env.DATABASE_HOST && process.env.DATABASE_USER && process.env.DATABASE_NAME) {
  const password = (process.env.NEON_PASSWORD ?? process.env.DATABASE_PASSWORD)?.trim();
  if (password) {
    const host = process.env.DATABASE_HOST.trim();
    const port = (process.env.DATABASE_PORT ?? '5432').trim();
    const user = encodeURIComponent(process.env.DATABASE_USER.trim());
    const db = process.env.DATABASE_NAME.trim();
    process.env.DATABASE_URL = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${db}?sslmode=require`;
  }
}
