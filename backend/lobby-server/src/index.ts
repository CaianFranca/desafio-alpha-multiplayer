import http from 'node:http';
import { getConfig } from '@flicker/config';
import { createWebSocketServer } from './ws/ws.ts';
import { createApp } from './app.ts';
import { pool } from './config/pg.ts';
import { redisClient } from './config/redis.ts';
import { verificarAccess } from './jwt.ts';
import { obterSessao } from './sessoes.ts';
import { criarContextoDasSalas } from './salas/index.ts';
import { iniciarServicoDeExpiracaoDeBots } from './bots/expiracaoDeBots.ts';

const contextoSalas = criarContextoDasSalas();

const app = createApp({ contextoSalas });
const server = http.createServer(app);

createWebSocketServer(server, { verificarAccess, obterSessao, contextoSalas });

const { lobbyServerPort } = getConfig();

// O servidor só aceita WebSocket depois de PG, Redis e o estado de Salas
// estarem prontos. Assim uma mutação nunca é calculada sobre estado vazio
// durante a reconstrução do write-model (ADR-0002).
async function inicializarDependencias(): Promise<void> {
  await pool.query('SELECT 1');
  console.log('[lobby-server] postgres conectado');

  if (redisClient.status === 'wait') {
    await redisClient.connect();
  }
  await redisClient.ping();
  console.log('[lobby-server] redis conectado');

  await contextoSalas.estado.carregar(contextoSalas.repo, contextoSalas.projecao);
  await contextoSalas.handlers.rearmarAposRestart();
  console.log('[lobby-server] salas carregadas do PG');

  // Só com bots habilitados (mesma regra de app.ts): sem rota, sem job.
  if (
    process.env['BOTS_HABILITADOS'] === 'true' ||
    (process.env['NODE_ENV'] !== 'production' && process.env['BOTS_HABILITADOS'] !== 'false')
  ) {
    iniciarServicoDeExpiracaoDeBots();
    console.log('[lobby-server] servico de expiracao de bots ativo');
  }
}

async function iniciar(): Promise<void> {
  await inicializarDependencias();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(lobbyServerPort, () => resolve());
  });
  console.log(`[lobby-server] listening on http://localhost:${lobbyServerPort}`);
}

void iniciar().catch(async (error: unknown) => {
  console.error('[lobby-server] falha na inicialização:', (error as Error).message);
  await pool.end().catch(() => undefined);
  await redisClient.quit().catch(() => undefined);
  process.exitCode = 1;
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
