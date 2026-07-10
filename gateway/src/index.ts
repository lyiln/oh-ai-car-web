import { ControlServer } from './websocket/control-server.js';

const server = new ControlServer({ port: 8787 });
server.listen()
  .then((port) => console.log(`OH AI car gateway listening on http://127.0.0.1:${port}`))
  .catch((error) => { console.error('Gateway failed to start', error); process.exitCode = 1; });

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await server.close(); }
  catch (error) { console.error('Gateway shutdown failed', error); process.exitCode = 1; }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
