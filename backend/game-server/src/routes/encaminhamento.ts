import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { OfertaDeEncaminhamento, PartidaId, ServerId } from '@flicker/shared';
import { cancelarPartida, criarPartidaPreparada } from '../partidas/partidas.ts';
import { validarOfertaDeEncaminhamento } from '../partidas/validacao.ts';

export function criarRoteadorDeEncaminhamento(
  redis: Redis,
  serverId: ServerId,
  ttlSegundos: number,
): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const recusa = validarOfertaDeEncaminhamento(req.body);
    if (recusa !== null) {
      res.status(400).json(recusa);
      return;
    }

    try {
      const partida = await criarPartidaPreparada(redis, req.body as OfertaDeEncaminhamento, serverId, ttlSegundos);
      res.status(200).json({ partidaId: partida.partidaId, serverId: partida.serverId });
    } catch (error) {
      console.error('[encaminhamento] falha ao criar partida:', (error as Error).message);
      res.status(500).json({ codigo: 'ENCAMINHAMENTO_FALHOU', motivo: 'falha ao criar a partida' });
    }
  });

  router.delete('/:partidaId', async (req, res) => {
    const partidaId = req.params.partidaId as PartidaId;

    try {
      const cancelada = await cancelarPartida(redis, partidaId);
      if (!cancelada) {
        res.status(404).json({ codigo: 'PARTIDA_NAO_ENCONTRADA', motivo: `partida ${partidaId} não encontrada` });
        return;
      }
      res.status(204).send();
    } catch (error) {
      console.error('[encaminhamento] falha ao cancelar partida:', (error as Error).message);
      res.status(500).json({ codigo: 'ENCAMINHAMENTO_FALHOU', motivo: 'falha ao cancelar a partida' });
    }
  });

  return router;
}
