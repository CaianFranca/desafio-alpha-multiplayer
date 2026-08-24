import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '@flicker/config';
import { redisClient } from '../config/redis.ts';
import { listarGameServersDisponiveis } from '../redis/gameServers.ts';

export const gameServersRouter = Router();

// Guard: exige JWT válido em produção; em dev/next mantém compat sem token.
// Valida qualquer token assinado com JWT_SECRET — não expõe lista sem auth em prod.
function requireAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }
  const token = header.slice(7);
  try {
    const { jwtSecret } = getConfig();
    jwt.verify(token, jwtSecret);
  } catch {
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
