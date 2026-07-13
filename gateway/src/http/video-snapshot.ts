/**
 * Fetch a JPEG snapshot from the car video web server (port 6500).
 * Tries common endpoints, then index2 HTML img/src, then MJPEG first frame.
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const FETCH_TIMEOUT_MS = 4000;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

export type SnapshotTarget = { host: string; videoPort: number };

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  // IPv4 private ranges
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function lookLikeJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

function fetchBuffer(url: string, maxBytes = 8 * 1024 * 1024): Promise<{ status: number; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { timeout: FETCH_TIMEOUT_MS, headers: { Accept: 'image/jpeg,image/*,*/*' } },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Fetch timed out: ${url}`));
    });
    req.on('error', reject);
  });
}

function extractJpegFromMjpeg(body: Buffer): Buffer | null {
  const start = body.indexOf(JPEG_SOI);
  if (start < 0) return null;
  const end = body.indexOf(JPEG_EOI, start + 2);
  if (end < 0) {
    // Incomplete frame — return what we have if it starts like JPEG
    return lookLikeJpeg(body.subarray(start)) ? body.subarray(start) : null;
  }
  return body.subarray(start, end + 2);
}

function resolveRelativeUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function parseStreamUrlsFromHtml(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/gi,
    /url\s*[:=]\s*["']([^"']+)["']/gi,
    /src\s*[:=]\s*["']([^"']+\.(?:mjpg|mjpeg|jpg|jpeg)[^"']*)["']/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const resolved = resolveRelativeUrl(pageUrl, match[1]);
      if (resolved && !urls.includes(resolved)) urls.push(resolved);
    }
  }
  return urls;
}

async function tryFetchJpeg(url: string): Promise<Buffer | null> {
  try {
    const result = await fetchBuffer(url);
    if (result.status < 200 || result.status >= 300) return null;
    if (lookLikeJpeg(result.body)) return result.body;
    if (result.contentType.includes('multipart') || result.contentType.includes('mjpeg')) {
      return extractJpegFromMjpeg(result.body);
    }
    // Some servers return MJPEG without proper content-type
    return extractJpegFromMjpeg(result.body);
  } catch {
    return null;
  }
}

/**
 * Pull one JPEG frame from the car video HTTP service.
 */
export async function fetchCarVideoSnapshot(target: SnapshotTarget): Promise<Buffer> {
  if (!isPrivateOrLocalHost(target.host)) {
    throw new SnapshotError('Video host must be a private or local address', 403);
  }
  if (!Number.isInteger(target.videoPort) || target.videoPort < 1 || target.videoPort > 65535) {
    throw new SnapshotError('videoPort is invalid', 400);
  }

  const base = `http://${target.host}:${target.videoPort}`;
  const candidates = [
    `${base}/snapshot`,
    `${base}/?action=snapshot`,
    `${base}/stream?action=snapshot`,
    `${base}/jpg`,
    `${base}/jpeg`,
  ];

  for (const url of candidates) {
    const jpeg = await tryFetchJpeg(url);
    if (jpeg) return jpeg;
  }

  // Parse index2 for embedded stream/img URLs
  const index2 = `${base}/index2`;
  try {
    const page = await fetchBuffer(index2, 512 * 1024);
    if (page.status >= 200 && page.status < 300) {
      const html = page.body.toString('utf8');
      for (const streamUrl of parseStreamUrlsFromHtml(html, index2)) {
        const jpeg = await tryFetchJpeg(streamUrl);
        if (jpeg) return jpeg;
      }
    }
  } catch {
    // continue
  }

  // Last resort: treat index2 / stream as MJPEG and extract first frame
  for (const url of [`${base}/stream`, `${base}/?action=stream`, index2]) {
    const jpeg = await tryFetchJpeg(url);
    if (jpeg) return jpeg;
  }

  throw new SnapshotError(
    `Could not fetch a JPEG snapshot from ${target.host}:${target.videoPort}. ` +
      'Tried /snapshot, ?action=snapshot, and index2 stream URLs.',
    502,
  );
}
