import { Router } from 'express';
import { redisClient } from '../config/redis.ts';
import { listarGameServersDisponiveis } from '../redis/gameServers.ts';
import { requireServiceToken } from '../middleware/serviceToken.ts';

export const gameServersRouter = Router();

gameServersRouter.get('/', requireServiceToken, async (_req, res) => {
  try {
    const disponiveis = await listarGameServersDisponiveis(redisClient);
    res.status(200).json(disponiveis);
  } catch (error) {
    console.error('[game-servers] falha ao listar:', (error as Error).message);
    res.status(500).json({ error: 'erro ao listar game-servers' });
  }
});
