import http from 'node:http';
import express from 'express';
import { getConfig } from '@flicker/config';
import { createWebSocketServer } from './ws/ws.ts';
import { authRouter } from './routes/auth.ts';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRouter);

const server = http.createServer(app);

createWebSocketServer(server);

const { lobbyServerPort } = getConfig();

server.listen(lobbyServerPort, () => {
  console.log(`[lobby-server] listening on http://localhost:${lobbyServerPort}`);
});
