import express, { type Express } from 'express';
import { getConfig } from '@flicker/config';
import { authRouter } from './routes/auth.ts';
import { gameServersRouter } from './routes/gameServers.ts';
import { criarRetornoRouter } from './routes/retorno.ts';
import { criarDesistenciaRouter } from './routes/desistencia.ts';
import { criarBotsRouter } from './routes/bots.ts';
import { cookieMiddleware } from './middleware/cookie.ts';
import { pool } from './config/pg.ts';
import { redisClient } from './config/redis.ts';
import type { SalasContexto } from './salas/index.ts';

// Habilita a rota de bots apenas em ambientes não-produção ou quando
// a variável BOTS_HABILITADOS=true é definida explicitamente.
const BOTS_HABILITADOS =
  process.env['BOTS_HABILITADOS'] === 'true' ||
  (process.env['NODE_ENV'] !== 'production' && process.env['BOTS_HABILITADOS'] !== 'false');


export interface CreateAppOpcoes {
  readonly contextoSalas?: SalasContexto;
}

export function createApp(opcoes: CreateAppOpcoes = {}): Express {
  const app = express();

  // O nº de hops até o app depende do encadeamento real: default 1
  // (dev/Docker Compose: cliente→nginx→lobby); produção nativa define
  // TRUST_PROXY_HOPS=3 (admin→edge→app). Sem isso o Express não enxerga o
  // IP real do cliente atrás do proxy.
  app.set('trust proxy', getConfig().trustProxyHops);

  app.use(express.json({ limit: '10kb' }));
  app.use(cookieMiddleware);

  app.get('/health', async (_req, res) => {
    try {
      await verificarPostgres();
    } catch (error) {
      console.error('[health] postgres indisponível:', (error as Error).message);
      res.status(503).json({ status: 'unhealthy', dependencia: 'postgres' });
      return;
    }

    try {
      await verificarRedis();
    } catch (error) {
      console.error('[health] redis indisponível:', (error as Error).message);
      res.status(503).json({ status: 'unhealthy', dependencia: 'redis' });
      return;
    }

    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/game-servers', gameServersRouter);

  if (opcoes.contextoSalas) {
    app.use('/api/retorno', criarRetornoRouter(opcoes.contextoSalas));
    app.use('/api/desistencia', criarDesistenciaRouter(opcoes.contextoSalas));
    if (BOTS_HABILITADOS) {
      app.use('/api/bots', criarBotsRouter(opcoes.contextoSalas));
      console.log('[lobby-server] rota de bots habilitada em /api/bots');
    }
  }

  // Handler global para erros de body-parser — evita respostas HTML para a API (A6/A8).
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const bodyParserError = err as { status?: number; type?: string };

    if (
      bodyParserError.type === 'entity.parse.failed'
      || (err instanceof SyntaxError && bodyParserError.status === 400)
    ) {
      res.status(400).json({ erros: [{ mensagem: 'Requisição inválida.' }] });
      return;
    }

    if (bodyParserError.type === 'entity.too.large') {
      res.status(413).json({ erros: [{ mensagem: 'Requisição muito grande.' }] });
      return;
    }

    next(err as Error);
  });

  return app;
}

async function verificarPostgres(): Promise<void> {
  await pool.query('SELECT 1');
}

async function verificarRedis(): Promise<void> {
  if (redisClient.status === 'wait') {
    await redisClient.connect();
  }
  await redisClient.ping();
}
