import { Router } from 'express';
import { redisClient } from '../config/redis.ts';
import { listarGameServersDisponiveis } from '../redis/gameServers.ts';

export const gameServersRouter = Router();

// Guard simples: endpoint é interno/operacional; exige Authorization quando em produção
// Mantém compatibilidade com health checks sem token em dev.
function requireAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }
  next();
}

gameServersRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const disponiveis = await listarGameServersDisponiveis(redisClient);
    res.status(200).json(disponiveis);
  } catch (error) {
    console.error('[game-servers] falha ao listar:', (error as Error).message);
    res.status(500).json({ error: 'erro ao listar game-servers' });
  }
});
