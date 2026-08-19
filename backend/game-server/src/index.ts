import http from 'node:http';
import express from 'express';
import { gameServerPort } from './config.ts';
import { createWebSocketServer } from './ws.ts';

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = http.createServer(app);

createWebSocketServer(server);

server.listen(gameServerPort, () => {
  console.log(`[game-server] listening on http://localhost:${gameServerPort}`);
});