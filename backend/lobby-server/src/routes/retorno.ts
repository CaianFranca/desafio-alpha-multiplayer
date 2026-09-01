import { Router, type Request, type Response } from 'express';
import { requireServiceToken } from '../middleware/serviceToken.ts';
import type { SalasContexto } from '../salas/index.ts';
import { mapearSala } from '../salas/eventos.ts';
import { serializarSala } from '../salas/projecao.ts';
import { obterLinkBase } from '../salas/handlers.ts';
import { pool } from '../config/pg.ts';

const salasReabertas = new Set<string>();

export function criarRetornoRouter(contexto: SalasContexto): Router {
  const router = Router();

  router.post('/', requireServiceToken, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      salaId?: unknown;
      partidaId?: unknown;
      serverId?: unknown;
      resultado?: unknown;
      jogadores?: unknown;
    };

    // Validação payload
    const salaId = typeof body.salaId === 'string' ? body.salaId.trim() : '';
    const partidaId = typeof body.partidaId === 'string' ? body.partidaId.trim() : undefined;
    const serverId = typeof body.serverId === 'string' ? body.serverId.trim() : undefined;
    const resultado = body.resultado as string | undefined;
    const jogadores = body.jogadores as unknown;

    const jogadoresValido =
      Array.isArray(jogadores) &&
      jogadores.length > 0 &&
      jogadores.every((j) => typeof j === 'string' && (j as string).trim().length > 0);

    const resultadoValido = resultado === 'vitoria' || resultado === 'derrota';

    if (
      salaId.length === 0 ||
      !resultadoValido ||
      !jogadoresValido ||
      (body.partidaId !== undefined && body.partidaId !== null && typeof body.partidaId !== 'string') ||
      (body.serverId !== undefined && body.serverId !== null && typeof body.serverId !== 'string') ||
      (partidaId !== undefined && partidaId.length === 0) ||
      (serverId !== undefined && serverId.length === 0)
    ) {
      res.status(400).json({ codigo: 'DADOS_INVALIDOS', mensagem: 'Payload inválido.' });
      return;
    }

    const jogadoresLista = (jogadores as string[]).map((j) => j.trim());

    // Revalidação e mutação dentro da fila mononodo
    try {
      const resultadoOperacao = await contexto.handlers.executarNaFila(async () => {
        // Consulta PG para status e revalidação
        const pgResult = await pool.query<{ status: string; server_id: string | null; partida_id: string | null }>(
          `SELECT status, server_id, partida_id FROM salas_historico WHERE id = $1 LIMIT 1`,
          [salaId],
        );

        if (pgResult.rowCount === 0) {
          return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
        }

        const linha = pgResult.rows[0]!;
        const status = linha.status;

        // Se já está aberta, tratamos como idempotente quando já reaberta antes e jogadores coincide
        if (status !== 'encaminhada') {
          if (status === 'aberta' && salasReabertas.has(salaId)) {
            // Verificar se jogadores coincide com membros ativos atuais (idempotência)
            const membros = await contexto.repo.listarMembrosDaSala(salaId);
            const ativos = membros.filter((m) => !m.bloqueado).map((m) => m.jogadorId).sort();
            const payloadOrdenado = [...jogadoresLista].sort();
            const coincide =
              ativos.length === payloadOrdenado.length &&
              ativos.every((v, i) => v === payloadOrdenado[i]);

            if (coincide) {
              // Idempotente: retornar sala atual sem mutação
              const salaDominio = contexto.estado.estado.salas.find((s) => s.id === salaId);
              if (salaDominio) {
                const salaWire = mapearSala(
                  salaDominio,
                  contexto.estado.apelidoPorJogadorId,
                  contexto.handlers.handlersLinkBase ?? obterLinkBase(),
                );
                // salaWire não deve ter encaminhamento
                return { tipo: 'sucesso' as const, sala: salaWire, idempotente: true };
              }
              // Fallback: buscar projeção
              const proj = await contexto.projecao.obterEstadoSala(salaId);
              if (proj) {
                // Projetar manualmente sem encaminhamento?
                // mas proj pode ter encaminhamento ainda? idempotente já deveria ter limpado
                const salaDominioFallback = contexto.estado.estado.salas.find((s) => s.id === salaId);
                if (salaDominioFallback) {
                  const salaWire = mapearSala(salaDominioFallback, contexto.estado.apelidoPorJogadorId, obterLinkBase());
                  return { tipo: 'sucesso' as const, sala: salaWire, idempotente: true };
                }
              }
              // Se não encontrou no estado, ainda retorna sucesso com sala mínima?
              // Mas status aberta sem estado em memória significa reconstrução pendente - tratar como idempotente ainda
              return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
            }
          }
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        // Revalidação serverId/partidaId se presentes
        if (partidaId !== undefined && linha.partida_id !== null && partidaId !== linha.partida_id) {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }
        if (serverId !== undefined && linha.server_id !== null && serverId !== linha.server_id) {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        // Revalidação membros: jogadores deve coincidir com membros ativos
        const membrosDb = await contexto.repo.listarMembrosDaSala(salaId);
        const ativosDb = membrosDb.filter((m) => !m.bloqueado).map((m) => m.jogadorId).sort();
        const payloadOrdenado = [...jogadoresLista].sort();
        const membrosCoincidem =
          ativosDb.length === payloadOrdenado.length &&
          ativosDb.every((v, i) => v === payloadOrdenado[i]);

        if (!membrosCoincidem) {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        // Aplicar comando no engine
        const aplicado = contexto.estado.aplicar({ tipo: 'reabrir_sala', salaId });
        if (!aplicado.sucesso) {
          const codigo = aplicado.erro.codigo;
          if (codigo === 'SALA_NAO_ENCONTRADA') {
            return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
          }
          if (codigo === 'SALA_NAO_ENCAMINHADA') {
            return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
          }
          return { tipo: 'erro' as const, status: 400, codigo: 'DADOS_INVALIDOS' };
        }

        // Persistência PG
        const persistiu = await contexto.repo.reabrirSalaAtomico(salaId);
        if (!persistiu) {
          // Concorrência: outra retentativa já reabriu; tratar como idempotente
          // Reverter estado? Como engine já avançou, precisamos manter consistente:
          // Se PG não persistiu porque já estava aberta, o engine já está em 'aberta' (sucesso).
          // Não há divergência pois a sala já está aberta no PG.
          // Apenas seguir com projeção.
        }

        contexto.estado.substituirEstado(aplicado.estado);

        const salaDominio = aplicado.estado.salas.find((s) => s.id === salaId);
        if (!salaDominio) {
          return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
        }

        // Projeção sem encaminhamento
        await contexto.projecao.definirEstadoSala(salaId, serializarSala(salaDominio));

        // Registrar para idempotência futura
        salasReabertas.add(salaId);

        // Broadcast SALA_ATUALIZADA
                const salaWire = mapearSala(salaDominio, contexto.estado.apelidoPorJogadorId, contexto.handlers.handlersLinkBase ?? obterLinkBase());
        contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaWire });

        return { tipo: 'sucesso' as const, sala: salaWire, idempotente: false };
      });

      if (resultadoOperacao.tipo === 'erro') {
        const mensagens: Record<string, string> = {
          DADOS_INVALIDOS: 'Payload inválido.',
          SALA_NAO_ENCONTRADA: 'Sala não encontrada.',
          SALA_NAO_ENCAMINHADA: 'Sala não está encaminhada.',
        };
        res.status(resultadoOperacao.status).json({
          codigo: resultadoOperacao.codigo,
          mensagem: mensagens[resultadoOperacao.codigo] ?? 'Erro.',
        });
        return;
      }

      res.status(200).json({ sala: resultadoOperacao.sala });
    } catch (erro) {
      console.error('[retorno] erro interno:', erro);
      res.status(500).json({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno.' });
    }
  });

  return router;
}

// Compatibilidade: router singleton para app sem contexto (fallback vazio não usado em prod)
export const retornoRouter = Router();
retornoRouter.post('/', requireServiceToken, (_req, res) => {
  res.status(500).json({ codigo: 'NAO_CONFIGURADO', mensagem: 'Router de retorno não configurado com contexto.' });
});
