import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEvidenceJpeg, saveEvidenceJpeg } from '../src/evidence-storage.js';

describe('evidence storage', () => {
  let dir: string;
  const previous = process.env.EVIDENCE_STORAGE_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oh-ai-evidence-'));
    process.env.EVIDENCE_STORAGE_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
    else process.env.EVIDENCE_STORAGE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores JPEG and returns a host-relative public path', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0), 0xff, 0xd9]);
    const saved = saveEvidenceJpeg(jpeg, 'evidence');
    expect(saved.publicPath).toMatch(/^\/api\/evidence\/evidence-[a-f0-9]+\.jpg$/);
    const loaded = readEvidenceJpeg(saved.fileName);
    expect(loaded?.equals(jpeg)).toBe(true);
  });

  it('rejects non-JPEG payloads', () => {
    const pngLike = Buffer.alloc(64, 1);
    expect(() => saveEvidenceJpeg(pngLike, 'evidence')).toThrow(/JPEG/i);
  });

  it('rejects path traversal on read', () => {
    expect(readEvidenceJpeg('../secrets.jpg')).toBeNull();
    expect(readEvidenceJpeg('evil/../x.jpg')).toBeNull();
  });
});
