// Start the server: HTTP routes + the /session WebSocket for live coaching.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createGuard, clientIp, originAllowed } from './guard.js';
import { handleSession } from './session.js';

const config = loadConfig();
const guard = createGuard(config);
const server = createServer(createApp(config, { guard }));
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url || '/', 'http://local');
  if (pathname !== '/session' || !originAllowed(req.headers.origin, config.allowedOrigins)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => handleSession(ws, { ip: clientIp(req, config.trustProxy), config, guard }));
});

server.listen(config.port, () => {
  console.log(`Vocco server on http://localhost:${config.port}`);
  if (!config.deepgramKey) console.warn('  DEEPGRAM_API_KEY is not set: live sessions will say listening isn’t set up.');
  if (!config.anthropicKey) console.warn('  ANTHROPIC_API_KEY is not set: reports will say they aren’t set up.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of wss.clients) c.close(1001, 'Server restarting');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
