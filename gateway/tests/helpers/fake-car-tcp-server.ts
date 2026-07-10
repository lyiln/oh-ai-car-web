import net from 'node:net';

export async function createFakeCarTcpServer(): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
  const messages: string[] = [];
  const server = net.createServer((socket) => socket.on('data', (data) => messages.push(data.toString())));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind fake TCP server');
  return { port: address.port, messages, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
