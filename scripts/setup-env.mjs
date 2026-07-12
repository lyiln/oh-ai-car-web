import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const templatePath = resolve(rootDir, '.env.example');
const outputPath = resolve(rootDir, '.env');

if (!existsSync(templatePath)) {
  console.error('Missing .env.example template.');
  process.exit(1);
}

const databasePassword = process.env.NEON_PASSWORD ?? process.argv[2];
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? process.argv[3];
if (!databasePassword || !adminPassword) {
  console.error('Usage: npm run setup:env -- <database-password> <admin-password>');
  console.error('Or set NEON_PASSWORD and BOOTSTRAP_ADMIN_PASSWORD.');
  process.exit(1);
}

const lines = readFileSync(templatePath, 'utf8').split('\n');
const envLines = lines
  .filter((line) => !line.startsWith('#') && line.trim())
  .filter((line) => !line.startsWith('NEON_PASSWORD=') && !line.startsWith('BOOTSTRAP_ADMIN_PASSWORD=') && !line.startsWith('SESSION_SECRET='));
envLines.push(`NEON_PASSWORD=${databasePassword}`);
envLines.push(`BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`);
envLines.push(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
writeFileSync(outputPath, `${envLines.join('\n')}\n`, { encoding: 'utf8' });
console.log(`Wrote ${outputPath}`);
