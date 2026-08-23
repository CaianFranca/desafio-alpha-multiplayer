import express, { type Express } from 'express';
import type { Redis } from 'ioredis';
import { getConfig } from '@flicker/config';
import type { ServerId } from '@flicker/shared';
import { criarRoteadorDeEncaminhamento } from './routes/encaminhamento.ts';

export function createApp(redis: Redis, serverId: ServerId): Express {
  const app = express();

  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const { partidaPreparadaTtlSegundos } = getConfig();
  app.use('/api/encaminhamento', criarRoteadorDeEncaminhamento(redis, serverId, partidaPreparadaTtlSegundos));

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const bodyParserError = err as { status?: number; type?: string };

    if (
      bodyParserError.type === 'entity.parse.failed'
      || (err instanceof SyntaxError && bodyParserError.status === 400)
    ) {
      res.status(400).json({ codigo: 'DADOS_INVALIDOS', motivo: 'requisição inválida' });
      return;
    }

    if (bodyParserError.type === 'entity.too.large') {
      res.status(413).json({ codigo: 'DADOS_INVALIDOS', motivo: 'requisição muito grande' });
      return;
    }

    next(err as Error);
  });

  return app;
}
