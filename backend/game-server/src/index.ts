import http from 'node:http';
import { getConfig } from '@flicker/config';
import type { ServerId } from '@flicker/shared';
import { createApp } from './app.ts';
import { criarWebSocketServer } from './ws/ws.ts';
import { redisClient } from './config/redis.ts';
import type { ContextoDoGameServer } from './contexto.ts';

const serverId: ServerId = process.env.GAME_SERVER_ID ?? crypto.randomUUID();

const { partidaPreparadaTtlSegundos, jwtSecret } = getConfig();
const contexto: ContextoDoGameServer = { redis: redisClient, serverId, jwtSecret, partidaPreparadaTtlSegundos };
const app = createApp(contexto);

const server = http.createServer(app);

criarWebSocketServer(server, contexto);

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
