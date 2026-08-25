import http from 'node:http';
import { getConfig } from '@flicker/config';
import { createWebSocketServer } from './ws/ws.ts';
import { createApp } from './app.ts';
import { pool } from './config/pg.ts';
import { redisClient } from './config/redis.ts';
import { verificarAccess } from './jwt.ts';
import { obterSessao } from './sessoes.ts';

const app = createApp();
const server = http.createServer(app);

createWebSocketServer(server, { verificarAccess, obterSessao });

const { lobbyServerPort } = getConfig();

// Validação assíncrona de PG/Redis no boot — loga mas não impede listen (compose depends_on já garante ordem)
async function validarDependencias(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('[lobby-server] postgres conectado');
  } catch (error) {
    console.warn('[lobby-server] postgres ainda não disponível:', (error as Error).message);
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    await redisClient.ping();
    console.log('[lobby-server] redis conectado');
  } catch (error) {
    console.warn('[lobby-server] redis ainda não disponível:', (error as Error).message);
  }
}

server.listen(lobbyServerPort, () => {
  console.log(`[lobby-server] listening on http://localhost:${lobbyServerPort}`);
  void validarDependencias();
});

// Graceful shutdown
function encerrar(signal: string): void {
  console.log(`[lobby-server] ${signal} recebido, encerrando...`);
  server.close(() => {
    void pool.end().finally(() => {
      void redisClient.quit().finally(() => process.exit(0));
    });
  });
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
