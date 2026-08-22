import http from 'node:http';
import express from 'express';
import { getConfig } from '@flicker/config';
import { createWebSocketServer } from './ws/ws.ts';
import { authRouter } from './routes/auth.ts';
import { pool } from './config/pg.ts';
import { redisClient } from './config/redis.ts';

const app = express();

app.use(express.json({ limit: '10kb' }));

async function verificarPostgres(): Promise<void> {
  await pool.query('SELECT 1');
}

async function verificarRedis(): Promise<void> {
  if (redisClient.status === 'wait') {
    await redisClient.connect();
  }
  await redisClient.ping();
}

app.get('/health', async (_req, res) => {
  try {
    await verificarPostgres();
    await verificarRedis();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[health] check falhou:', (error as Error).message);
    res.status(503).json({ status: 'unhealthy' });
  }
});

app.use('/api/auth', authRouter);

// Handler global para erros de body-parser — evita respostas HTML para a API (A6/A8).
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const bodyParserError = err as { status?: number; type?: string };

  if (
    bodyParserError.type === 'entity.parse.failed'
    || (err instanceof SyntaxError && bodyParserError.status === 400)
  ) {
    res.status(400).json({ error: 'requisição inválida' });
    return;
  }

  if (bodyParserError.type === 'entity.too.large') {
    res.status(413).json({ error: 'requisição muito grande' });
    return;
  }

  next(err as Error);
});

const server = http.createServer(app);

createWebSocketServer(server);

const { lobbyServerPort } = getConfig();

// Validação assíncrona de PG/Redis no boot — loga mas não impede listen (compose depends_on já garante ordem)
async function validarDependencias(): Promise<void> {
  try {
    await verificarPostgres();
    console.log('[lobby-server] postgres conectado');
  } catch (error) {
    console.warn('[lobby-server] postgres ainda não disponível:', (error as Error).message);
  }
  try {
    await verificarRedis();
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
