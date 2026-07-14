import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { fetchCarVideoSnapshot } from '../src/http/video-snapshot.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
);

describe('fetchCarVideoSnapshot', () => {
  it('extracts the first JPEG frame from a non-terminating MJPEG stream exposed via index2 html', async () => {
    const boundary = 'frame';
    const server = createServer((req, res) => {
      if (req.url === '/index2') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><img src="/?action=stream"></body></html>');
        return;
      }
      if (req.url === '/?action=stream') {
        res.writeHead(200, {
          'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
          'Cache-Control': 'no-store',
        });
        res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
        res.write(jpeg);
        res.write('\r\n');
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const videoPort = (server.address() as { port: number }).port;

    const snapshot = await fetchCarVideoSnapshot({ host: '127.0.0.1', videoPort });

    expect(snapshot[0]).toBe(0xff);
    expect(snapshot[1]).toBe(0xd8);
    expect(snapshot.at(-2)).toBe(0xff);
    expect(snapshot.at(-1)).toBe(0xd9);
  });
});
