import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const templatePath = resolve(rootDir, '.env.development');
const outputPath = resolve(rootDir, '.env');

if (!existsSync(templatePath)) {
  console.error('Missing .env.development template.');
  process.exit(1);
}

const password = process.env.NEON_PASSWORD ?? process.argv[2];
if (!password) {
  console.error('Usage: npm run setup:env -- <neon-password>');
  console.error('Or set NEON_PASSWORD environment variable.');
  console.error('');
  console.error('Team members: get the shared Neon password from the project lead or Neon console.');
  process.exit(1);
}

const lines = readFileSync(templatePath, 'utf8').split('\n');
const envLines = [...lines.filter((line) => !line.startsWith('#') && line.trim()), `NEON_PASSWORD=${password}`];
writeFileSync(outputPath, `${envLines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
