import { Router } from 'express';
import type { OfertaDeEncaminhamento, PartidaId } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import { cancelarPartida, criarPartidaPreparada } from '../partidas/partidas.ts';
import { validarCancelamentoDeEncaminhamento, validarOfertaDeEncaminhamento } from '../partidas/validacao.ts';

export function criarRoteadorDeEncaminhamento(contexto: ContextoDoGameServer): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const recusa = validarOfertaDeEncaminhamento(req.body);
    if (recusa !== null) {
      res.status(400).json(recusa);
      return;
    }

    try {
      const partida = await criarPartidaPreparada(contexto, req.body as OfertaDeEncaminhamento);
      res.status(200).json({ partidaId: partida.partidaId, serverId: partida.serverId });
    } catch (error) {
      console.error('[encaminhamento] falha ao criar partida:', (error as Error).message);
      res.status(500).json({ codigo: 'ENCAMINHAMENTO_FALHOU', motivo: 'falha ao criar a partida' });
    }
  });

  router.delete('/:partidaId', async (req, res) => {
    const cancelamento = validarCancelamentoDeEncaminhamento(req.body, req.params.partidaId);
    if ('codigo' in cancelamento) {
      res.status(400).json(cancelamento);
      return;
    }

    const partidaId = cancelamento.partidaId as PartidaId;

    try {
      const cancelada = await cancelarPartida(contexto.redis, partidaId);
      if (!cancelada) {
        res.status(404).json({ codigo: 'PARTIDA_NAO_ENCONTRADA', motivo: `partida ${partidaId} não encontrada` });
        return;
      }
      console.info('[encaminhamento] partida cancelada', {
        partidaId,
        motivo: cancelamento.motivo,
      });
      res.status(204).send();
    } catch (error) {
      console.error('[encaminhamento] falha ao cancelar partida:', (error as Error).message);
      res.status(500).json({ codigo: 'ENCAMINHAMENTO_FALHOU', motivo: 'falha ao cancelar a partida' });
    }
  });

  return router;
}
