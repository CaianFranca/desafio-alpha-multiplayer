import { Router, type Request, type Response } from 'express';
import { requireServiceToken } from '../middleware/serviceToken.ts';
import type { SalasContexto } from '../salas/index.ts';
import { mapearSala } from '../salas/eventos.ts';
import { serializarSala } from '../salas/projecao.ts';

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
        const salaBruta = await contexto.repo.obterSalaBruta(salaId);

        if (!salaBruta) {
          return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
        }

        const status = salaBruta.status;

        // Caminho idempotente: PG já está aberta. Requer marker PG/Redis de reabertura prévia — evita que sala nunca encaminhada seja aceita.
        // Com o fix atômico (UPDATE + INSERT marker em transação), crash entre UPDATE e marker não deixa mais sala aberta sem marker.
        // Ainda assim recuperamos broadcast/projeção perdidos caso o crash tenha ocorrido após o COMMIT mas antes de Redis/broadcast.
        if (status !== 'encaminhada') {
          if (status === 'aberta') {
            const reabertaRedis = await contexto.projecao.foiReaberta(salaId);
            const reabertaPg = reabertaRedis ? true : await contexto.repo.foiReabertaPersistido(salaId);
            if (reabertaRedis || reabertaPg) {
              const membros = await contexto.repo.listarMembrosDaSala(salaId);
              const ativos = membros.filter((m) => !m.bloqueado).map((m) => m.jogadorId).sort();
              const payloadOrdenado = [...jogadoresLista].sort();
              const coincide =
                ativos.length === payloadOrdenado.length &&
                ativos.every((v, i) => v === payloadOrdenado[i]);
              if (coincide) {
                const salaDominio = contexto.estado.estado.salas.find((s) => s.id === salaId);
                if (salaDominio) {
                  const salaWire = mapearSala(
                    salaDominio,
                    contexto.estado.apelidoPorJogadorId,
                    contexto.handlers.handlersLinkBase,
                  );
                  // Recupera projeção/markers/broadcast perdidos no crash após COMMIT
                  await contexto.projecao.definirEstadoSala(salaId, serializarSala(salaDominio));
                  await contexto.projecao.marcarReaberta(salaId);
                  await contexto.repo.marcarReabertaPersistido(salaId);
                  contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaWire });
                  return { tipo: 'sucesso' as const, sala: salaWire, idempotente: true };
                }
                const proj = await contexto.projecao.obterEstadoSala(salaId);
                if (proj) {
                  const linkBase = contexto.handlers.handlersLinkBase;
                  const salaWire = {
                    id: proj.id,
                    codigoDeSala: proj.codigo,
                    estado: proj.estado as 'aberta' | 'encaminhada' | 'encerrada' | 'expirada',
                    anfitriaoId: proj.anfitriaoId,
                    membros: proj.membros.map((m) => ({
                      id: m.id,
                      jogadorId: m.jogadorId,
                      apelido: contexto.estado.apelidoPorJogadorId.get(m.jogadorId) ?? '',
                      ordemDeEntrada: m.ordemDeEntrada,
                      presenca: m.presenca,
                      prontidao: m.pronto,
                    })),
                    convite: { codigoDeSala: proj.codigo, link: `${linkBase}/${proj.codigo}` },
                  } as const;
                  const { encaminhamento: _enc, ...salaSemEnc } = salaWire as typeof salaWire & { encaminhamento?: unknown };
                  await contexto.projecao.marcarReaberta(salaId);
                  await contexto.repo.marcarReabertaPersistido(salaId);
                  // Projeção já existe, mas garante que encaminhamento não seja reenviado via broadcast futuro
                  const salaSemEncTyped = salaSemEnc as unknown as ReturnType<typeof mapearSala>;
                  contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaSemEncTyped });
                  return { tipo: 'sucesso' as const, sala: salaSemEncTyped, idempotente: true };
                }
                const linkBase = contexto.handlers.handlersLinkBase;
                const salaWireMinima = {
                  id: salaBruta.id,
                  codigoDeSala: salaBruta.codigo,
                  estado: 'aberta' as const,
                  anfitriaoId: salaBruta.anfitriaoId,
                  membros: membros.map((m) => ({
                    id: `${salaId}-m${m.ordem}`,
                    jogadorId: m.jogadorId,
                    apelido: contexto.estado.apelidoPorJogadorId.get(m.jogadorId) ?? '',
                    ordemDeEntrada: m.ordem,
                    presenca: 'conectado' as const,
                    prontidao: false,
                  })),
                  convite: { codigoDeSala: salaBruta.codigo, link: `${linkBase}/${salaBruta.codigo}` },
                } as const;
                await contexto.projecao.marcarReaberta(salaId);
                await contexto.repo.marcarReabertaPersistido(salaId);
                const salaMinimaTyped = salaWireMinima as unknown as ReturnType<typeof mapearSala>;
                contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaMinimaTyped });
                return { tipo: 'sucesso' as const, sala: salaMinimaTyped, idempotente: true };
              }
            }
          }
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        // Revalidação serverId/partidaId se presentes
        if (partidaId !== undefined && salaBruta.partidaId !== null && partidaId !== salaBruta.partidaId) {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }
        if (serverId !== undefined && salaBruta.serverId !== null && serverId !== salaBruta.serverId) {
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

        // Aplicar comando no engine (valida estado consistente e encaminhada)
        const aplicado = contexto.estado.aplicar({ tipo: 'reabrir_sala', salaId });
        if (!aplicado.sucesso) {
          const codigo = aplicado.erro.codigo;
          if (codigo === 'SALA_NAO_ENCONTRADA') {
            return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
          }
          if (codigo === 'SALA_NAO_ENCAMINHADA') {
            return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
          }
          if (codigo === 'SALA_INCONSISTENTE') {
            return { tipo: 'erro' as const, status: 409, codigo: 'SALA_INCONSISTENTE' };
          }
          return { tipo: 'erro' as const, status: 400, codigo: 'DADOS_INVALIDOS' };
        }

        // Persistência PG atômica (UPDATE + INSERT marker na mesma transação) — elimina janela de crash
        const reabriu = await contexto.repo.reabrirSalaComMarkerAtomico(salaId);
        if (!reabriu) {
          // rowCount 0: PG não flipou (concorrência ou status já não era encaminhada). Não commita memória.
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }

        contexto.estado.substituirEstado(aplicado.estado);

        const salaDominio = aplicado.estado.salas.find((s) => s.id === salaId);
        if (!salaDominio) {
          return { tipo: 'erro' as const, status: 404, codigo: 'SALA_NAO_ENCONTRADA' };
        }

        // Projeção sem encaminhamento + marker Redis (PG já gravado na transação)
        await contexto.projecao.definirEstadoSala(salaId, serializarSala(salaDominio));
        await contexto.projecao.marcarReaberta(salaId);

        // Broadcast SALA_ATUALIZADA
        const salaWire = mapearSala(salaDominio, contexto.estado.apelidoPorJogadorId, contexto.handlers.handlersLinkBase);
        contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaWire });

        return { tipo: 'sucesso' as const, sala: salaWire, idempotente: false };
      });

      if (resultadoOperacao.tipo === 'erro') {
        const mensagens: Record<string, string> = {
          DADOS_INVALIDOS: 'Payload inválido.',
          SALA_NAO_ENCONTRADA: 'Sala não encontrada.',
          SALA_NAO_ENCAMINHADA: 'Sala não está encaminhada.',
          SALA_INCONSISTENTE: 'Sala temporariamente inconsistente, tente novamente.',
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
