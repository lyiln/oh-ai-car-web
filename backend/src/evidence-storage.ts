import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}\.jpe?g$/i;

export function evidenceStorageRoot(): string {
  const configured = process.env.EVIDENCE_STORAGE_DIR?.trim();
  if (configured) return resolve(configured);
  return resolve(process.cwd(), 'data', 'evidence');
}

export function ensureEvidenceStorage(): string {
  const root = evidenceStorageRoot();
  mkdirSync(root, { recursive: true });
  return root;
}

export function saveEvidenceJpeg(bytes: Buffer, kind = 'evidence'): { fileName: string; publicPath: string } {
  if (bytes.length < 32 || bytes.length > 4 * 1024 * 1024) {
    throw Object.assign(new Error('Evidence image size is invalid'), { statusCode: 400 });
  }
  // JPEG SOI marker
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw Object.assign(new Error('Evidence payload must be JPEG'), { statusCode: 400 });
  }
  const root = ensureEvidenceStorage();
  const prefix = kind.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'evidence';
  const fileName = `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 16)}.jpg`;
  writeFileSync(join(root, fileName), bytes);
  return { fileName, publicPath: `/api/evidence/${fileName}` };
}

export function readEvidenceJpeg(fileName: string): Buffer | null {
  if (!SAFE_NAME.test(fileName)) return null;
  const root = ensureEvidenceStorage();
  const full = join(root, fileName);
  if (!existsSync(full)) return null;
  const resolved = resolve(full);
  if (!resolved.startsWith(resolve(root))) return null;
  return readFileSync(resolved);
}
