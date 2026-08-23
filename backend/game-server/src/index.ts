import http from 'node:http';
import { getConfig } from '@flicker/config';
import type { ServerId } from '@flicker/shared';
import { createApp } from './app.ts';
import { createWebSocketServer } from './ws/ws.ts';
import { redisClient } from './config/redis.ts';

const serverId: ServerId = process.env.GAME_SERVER_ID ?? crypto.randomUUID();

const app = createApp(redisClient, serverId);

const server = http.createServer(app);

createWebSocketServer(server);

const { gameServerPort } = getConfig();

server.listen(gameServerPort, () => {
  console.log(`[game-server] serverId: ${serverId}`);
  console.log(`[game-server] listening on http://localhost:${gameServerPort}`);
});

function encerrar(signal: string): void {
  console.log(`[game-server] ${signal} recebido, encerrando...`);
  server.close(() => {
    void redisClient.quit().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
