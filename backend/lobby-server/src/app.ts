import express, { type Express } from 'express';
import { authRouter } from './routes/auth.ts';
import { cookieMiddleware } from './middleware/cookie.ts';
import { pool } from './config/pg.ts';
import { redisClient } from './config/redis.ts';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '10kb' }));
  app.use(cookieMiddleware);

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
