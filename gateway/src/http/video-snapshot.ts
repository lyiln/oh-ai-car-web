/**
 * Fetch a JPEG snapshot from the car video web server (port 6500).
 * Tries common endpoints, then index2 HTML img/src, then MJPEG first frame.
 */
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
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

// #region debug-point A:snapshot-debug-reporter
function reportSnapshotDebug(
  hypothesisId: 'A' | 'B' | 'C' | 'D' | 'E',
  location: string,
  msg: string,
  data: Record<string, unknown>,
): void {
  try {
    const env = readFileSync('.dbg/video-snapshot-timeout.env', 'utf8');
    const debugUrl = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() ?? 'http://127.0.0.1:7777/event';
    const sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() ?? 'video-snapshot-timeout';
    void fetch(debugUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        runId: 'pre-fix',
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data,
        ts: Date.now(),
      }),
    }).catch(() => undefined);
  } catch {
    // Ignore debug reporting failures.
  }
}
// #endregion

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

function extractCompleteJpeg(body: Buffer): Buffer | null {
  const start = body.indexOf(JPEG_SOI);
  if (start < 0) return null;
  const end = body.indexOf(JPEG_EOI, start + 2);
  if (end < 0) return null;
  return body.subarray(start, end + 2);
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
    // #region debug-point B:fetch-buffer-start
    reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:start', 'Starting fetchBuffer request', { url, maxBytes });
    // #endregion
    const req = lib.get(
      url,
      { timeout: FETCH_TIMEOUT_MS, headers: { Accept: 'image/jpeg,image/*,*/*' } },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        // #region debug-point B:fetch-buffer-headers
        reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:headers', 'fetchBuffer received headers', {
          url,
          statusCode: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
        });
        // #endregion
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total === chunk.length) {
            // #region debug-point B:fetch-buffer-first-chunk
            reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:first-chunk', 'fetchBuffer received first chunk', {
              url,
              chunkBytes: chunk.length,
              totalBytes: total,
            });
            // #endregion
          }
          if (total > maxBytes) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          // #region debug-point B:fetch-buffer-end
          reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:end', 'fetchBuffer completed', {
            url,
            totalBytes: total,
          });
          // #endregion
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', (error) => {
          // #region debug-point B:fetch-buffer-response-error
          reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:response-error', 'fetchBuffer response error', {
            url,
            error: error instanceof Error ? error.message : String(error),
          });
          // #endregion
          reject(error);
        });
      },
    );
    req.on('timeout', () => {
      // #region debug-point B:fetch-buffer-timeout
      reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:timeout', 'fetchBuffer timed out', { url });
      // #endregion
      req.destroy();
      reject(new Error(`Fetch timed out: ${url}`));
    });
    req.on('error', (error) => {
      // #region debug-point B:fetch-buffer-request-error
      reportSnapshotDebug('B', 'video-snapshot.ts:fetchBuffer:request-error', 'fetchBuffer request error', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      // #endregion
      reject(error);
    });
  });
}

function extractJpegFromMjpeg(body: Buffer): Buffer | null {
  const complete = extractCompleteJpeg(body);
  if (complete) return complete;
  const start = body.indexOf(JPEG_SOI);
  if (start < 0) return null;
  if (body.indexOf(JPEG_EOI, start + 2) < 0) {
    // Incomplete frame — return what we have if it starts like JPEG
    return lookLikeJpeg(body.subarray(start)) ? body.subarray(start) : null;
  }
  return null;
}

function resolveRelativeUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function matchesVideoTarget(url: string, target: SnapshotTarget): boolean {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    return parsed.protocol === 'http:' && parsed.hostname === target.host && port === target.videoPort;
  } catch {
    return false;
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

function snapshotRequestHeaders(url: string): Record<string, string> {
  let referer = '';
  try {
    const parsed = new URL(url);
    referer = `${parsed.protocol}//${parsed.host}/index2`;
  } catch {
    referer = '';
  }
  return {
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    Referer: referer,
  };
}

function htmlRequestHeaders(url: string): Record<string, string> {
  let referer = '';
  try {
    const parsed = new URL(url);
    referer = `${parsed.protocol}//${parsed.host}/`;
  } catch {
    referer = '';
  }
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    Referer: referer,
  };
}

function fetchFirstJpeg(url: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer | null> {
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
    let settled = false;
    const finish = (value: Buffer | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    // #region debug-point A:fetch-first-jpeg-start
    reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:start', 'Starting fetchFirstJpeg request', {
      url,
      maxBytes,
      headers: snapshotRequestHeaders(url),
    });
    // #endregion

    const req = lib.get(
      url,
      { timeout: FETCH_TIMEOUT_MS, headers: htmlRequestHeaders(url) },
      (res) => {
        const status = res.statusCode ?? 0;
        // #region debug-point A:fetch-first-jpeg-headers
        reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:headers', 'fetchFirstJpeg received headers', {
          url,
          status,
          contentType: String(res.headers['content-type'] ?? ''),
        });
        // #endregion
        if (status < 200 || status >= 300) {
          res.resume();
          finish(null);
          return;
        }

        const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
        const chunks: Buffer[] = [];
        let total = 0;

        const maybeFinishFromBufferedData = (allowPartial = false): boolean => {
          const body = Buffer.concat(chunks, total);
          const jpeg = extractCompleteJpeg(body) ?? (allowPartial ? extractJpegFromMjpeg(body) : null);
          if (!jpeg) return false;
          res.destroy();
          req.destroy();
          finish(jpeg);
          return true;
        };

        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          total += chunk.length;
          if (total === chunk.length) {
            // #region debug-point A:fetch-first-jpeg-first-chunk
            reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:first-chunk', 'fetchFirstJpeg received first chunk', {
              url,
              chunkBytes: chunk.length,
              totalBytes: total,
            });
            // #endregion
          }
          if (total > maxBytes) {
            res.destroy();
            req.destroy();
            finish(null);
            return;
          }
          chunks.push(chunk);
          // MJPEG streams never end, so return as soon as the first frame is complete.
          if (contentType.includes('multipart') || contentType.includes('mjpeg') || contentType.startsWith('image/jpeg')) {
            maybeFinishFromBufferedData();
          }
        });
        res.on('end', () => {
          // #region debug-point A:fetch-first-jpeg-end
          reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:end', 'fetchFirstJpeg response ended', {
            url,
            totalBytes: total,
          });
          // #endregion
          if (settled) return;
          if (maybeFinishFromBufferedData(true)) return;
          finish(null);
        });
        res.on('error', (error) => {
          if (settled) return;
          // #region debug-point A:fetch-first-jpeg-response-error
          reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:response-error', 'fetchFirstJpeg response error', {
            url,
            error: error instanceof Error ? error.message : String(error),
          });
          // #endregion
          finish(null, error);
        });
      },
    );

    req.on('timeout', () => {
      if (settled) return;
      // #region debug-point A:fetch-first-jpeg-timeout
      reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:timeout', 'fetchFirstJpeg timed out', { url });
      // #endregion
      req.destroy();
      finish(null, new Error(`Fetch timed out: ${url}`));
    });
    req.on('error', (error) => {
      if (settled) return;
      // #region debug-point A:fetch-first-jpeg-request-error
      reportSnapshotDebug('A', 'video-snapshot.ts:fetchFirstJpeg:request-error', 'fetchFirstJpeg request error', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      // #endregion
      finish(null, error);
    });
  });
}

async function tryFetchJpeg(url: string): Promise<Buffer | null> {
  try {
    return await fetchFirstJpeg(url);
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
  // #region debug-point C:snapshot-start
  reportSnapshotDebug('C', 'video-snapshot.ts:fetchCarVideoSnapshot:start', 'Starting snapshot candidate sweep', {
    host: target.host,
    videoPort: target.videoPort,
    base,
  });
  // #endregion
  const candidates = [
    `${base}/video_feed`,
    `${base}/snapshot`,
    `${base}/?action=snapshot`,
    `${base}/stream?action=snapshot`,
    `${base}/jpg`,
    `${base}/jpeg`,
  ];

  for (const url of candidates) {
    // #region debug-point C:snapshot-candidate
    reportSnapshotDebug('C', 'video-snapshot.ts:fetchCarVideoSnapshot:candidate', 'Trying snapshot candidate URL', { url });
    // #endregion
    const jpeg = await tryFetchJpeg(url);
    if (jpeg) return jpeg;
  }

  // Parse index2 for embedded stream/img URLs
  const index2 = `${base}/index2`;
  try {
    const page = await fetchBuffer(index2, 512 * 1024);
    if (page.status >= 200 && page.status < 300) {
      const html = page.body.toString('utf8');
      // #region debug-point D:index2-parse
      reportSnapshotDebug('D', 'video-snapshot.ts:fetchCarVideoSnapshot:index2-parse', 'Parsed index2 HTML response', {
        url: index2,
        htmlBytes: page.body.length,
        extractedUrls: parseStreamUrlsFromHtml(html, index2),
      });
      // #endregion
      for (const streamUrl of parseStreamUrlsFromHtml(html, index2)) {
        if (!matchesVideoTarget(streamUrl, target)) continue;
        const jpeg = await tryFetchJpeg(streamUrl);
        if (jpeg) return jpeg;
      }
    }
  } catch {
    // continue
  }

  // Last resort: treat index2 / stream as MJPEG and extract first frame
  for (const url of [`${base}/stream`, `${base}/?action=stream`, index2]) {
    // #region debug-point C:snapshot-fallback
    reportSnapshotDebug('C', 'video-snapshot.ts:fetchCarVideoSnapshot:fallback', 'Trying fallback stream URL', { url });
    // #endregion
    const jpeg = await tryFetchJpeg(url);
    if (jpeg) return jpeg;
  }

  throw new SnapshotError(
    `Could not fetch a JPEG snapshot from ${target.host}:${target.videoPort}. ` +
      'Tried /snapshot, ?action=snapshot, and index2 stream URLs.',
    502,
  );
}
