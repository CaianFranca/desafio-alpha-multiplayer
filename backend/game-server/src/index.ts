import http from 'node:http';
import express from 'express';
import { getConfig } from '@flicker/config';
import { createWebSocketServer } from './ws/ws.ts';

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = http.createServer(app);

const wss = createWebSocketServer(server);

const { gameServerPort } = getConfig();

server.listen(gameServerPort, () => {
  console.log(`[game-server] listening on http://localhost:${gameServerPort}`);
});