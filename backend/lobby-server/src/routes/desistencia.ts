import { Router, type Request, type Response } from 'express';
import { requireServiceToken } from '../middleware/serviceToken.ts';
import type { SalasContexto } from '../salas/index.ts';

/**
 * Callback de desistência do game-server (issue #290).
 *
 * A cada `desistir_da_partida` aplicado, o game-server avisa o lobby para
 * desvincular SÓ o desistente da sala `encaminhada` — ele pode criar/entrar
 * em outra sala na hora, enquanto a partida e a sala seguem com os restantes.
 * O desistente NÃO volta à sala quando a partida terminar (sem re-adição no
 * retorno) e NÃO entra em `jogadoresBloqueados`.
 *
 * Idempotente: jogador já sem vínculo com a sala responde 200 sem mutação
 * (cobre retries e a ordem detach → retorno no término 2→1).
 */
export function criarDesistenciaRouter(contexto: SalasContexto): Router {
  const router = Router();

  router.post('/', requireServiceToken, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      salaId?: unknown;
      partidaId?: unknown;
      serverId?: unknown;
      jogadorId?: unknown;
    };

    const salaId = typeof body.salaId === 'string' ? body.salaId.trim() : '';
    const jogadorId = typeof body.jogadorId === 'string' ? body.jogadorId.trim() : '';
    const partidaId = typeof body.partidaId === 'string' ? body.partidaId.trim() : undefined;
    const serverId = typeof body.serverId === 'string' ? body.serverId.trim() : undefined;

    if (
      salaId.length === 0 ||
      jogadorId.length === 0 ||
      (body.partidaId !== undefined && body.partidaId !== null && typeof body.partidaId !== 'string') ||
      (body.serverId !== undefined && body.serverId !== null && typeof body.serverId !== 'string') ||
      (partidaId !== undefined && partidaId.length === 0) ||
      (serverId !== undefined && serverId.length === 0)
    ) {
      res.status(400).json({ codigo: 'DADOS_INVALIDOS', mensagem: 'Payload inválido.' });
      return;
    }

    try {
      const resultadoOperacao = await contexto.handlers.executarNaFila(async () => {
        const salaBruta = await contexto.repo.obterSalaBruta(salaId);

        if (!salaBruta) {
          return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
        }

        // Revalidação partidaId/serverId quando presentes (mesmo padrão do retorno).
        if (partidaId !== undefined && salaBruta.partidaId !== null && partidaId !== salaBruta.partidaId) {
          return { tipo: 'erro' as const, status: 409, codigo: 'DESISTENCIA_INVALIDA' };
        }
        if (serverId !== undefined && salaBruta.serverId !== null && serverId !== salaBruta.serverId) {
          return { tipo: 'erro' as const, status: 409, codigo: 'DESISTENCIA_INVALIDA' };
        }

        // Idempotência: sem vínculo ativo com esta sala, nada a fazer.
        // (PG primeiro — fonte da associação; engine confirma dentro da fila.)
        const associadaPg = await contexto.repo.obterSalaAtivaDoJogador(jogadorId);
        const salaMemoria = contexto.estado.abertas.get(salaId);
        const membroAtivo = salaMemoria?.sala.membros.some(
          (m) => m.estado === 'ativo' && m.jogadorId === jogadorId,
        ) ?? false;
        if (associadaPg !== salaId && !membroAtivo) {
          return { tipo: 'sucesso' as const, desvinculado: false };
        }

        if (salaBruta.status !== 'encaminhada') {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        const desvinculado = await contexto.handlers.removerDesistente(salaId, jogadorId);
        if (!desvinculado) {
          // Engine sem membro ativo (ex.: saída concorrente removeu entre o
          // check e a mutação): converge PG/Redis e responde idempotente.
          await contexto.repo.obterSalaAtivaDoJogador(jogadorId).then(async (atual) => {
            if (atual === salaId) {
              await contexto.projecao.limparAssociacaoJogador(jogadorId);
            }
          });
          return { tipo: 'sucesso' as const, desvinculado: false };
        }

        return { tipo: 'sucesso' as const, desvinculado: true };
      });

      if (resultadoOperacao.tipo === 'erro') {
        const mensagens: Record<string, string> = {
          DADOS_INVALIDOS: 'Payload inválido.',
          SALA_NAO_ENCONTRADA: 'Sala não encontrada.',
          SALA_NAO_ENCAMINHADA: 'Sala não está encaminhada.',
          DESISTENCIA_INVALIDA: 'Desistência não corresponde a esta sala.',
          ERRO_INTERNO: 'Erro interno.',
        };
        res.status(resultadoOperacao.status).json({
          codigo: resultadoOperacao.codigo,
          mensagem: mensagens[resultadoOperacao.codigo] ?? 'Erro.',
        });
        return;
      }

      res.status(200).json({ desvinculado: resultadoOperacao.desvinculado });
    } catch (erro) {
      console.error('[desistencia] erro interno:', erro);
      res.status(500).json({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno.' });
    }
  });

  return router;
}
