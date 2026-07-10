import { ControlServer } from './websocket/control-server.js';

const server = new ControlServer({ port: Number(process.env.PORT ?? 8787) });
server.listen().then((port) => console.log(`OH AI car gateway listening on http://127.0.0.1:${port}`));

const shutdown = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
