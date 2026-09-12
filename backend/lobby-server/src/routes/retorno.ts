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

    const resultadoValido = resultado === 'vitoria' || resultado === 'derrota' || resultado === 'nao-inicio';

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
                    undefined,
                    contexto.estado.botPorJogadorId,
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
                      ...(contexto.estado.botPorJogadorId.get(m.jogadorId) === true ? { ehBot: true as const } : {}),
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
                // Sem memória nem projeção não há dados reais de presença/prontidão para broadcastar.
                // Dados fabricados com IDs sintéticos causariam divergência; retorno 503 para retry do game-server.
                return { tipo: 'erro' as const, status: 503, codigo: 'ERRO_INTERNO' };
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

        // Revalidação membros: jogadores deve ser subset de membros ativos (follow-up #371, N-1)
        // Permite N-1 com desistentes: payload ⊆ ativosDb, 1 ≤ |payload| ≤ |ativosDb|, sem duplicatas.
        // Isso elimina o desistente fantasma: a reabertura remove atomically os que sobraram fora do payload.
        const membrosDb = await contexto.repo.listarMembrosDaSala(salaId);
        const ativosDb = membrosDb.filter((m) => !m.bloqueado).map((m) => m.jogadorId).sort();
        const payloadOrdenado = [...jogadoresLista].sort();
        // Duplicatas no payload são inválidas — o lobby exige conjunto
        if (new Set(payloadOrdenado).size !== payloadOrdenado.length) {
          return { tipo: 'erro' as const, status: 400, codigo: 'DADOS_INVALIDOS' };
        }
        const ativosSet = new Set(ativosDb);
        const ehSubset =
          payloadOrdenado.length >= 1 &&
          payloadOrdenado.length <= ativosDb.length &&
          payloadOrdenado.every((id) => ativosSet.has(id));
        if (!ehSubset) {
          return { tipo: 'erro' as const, status: 409, codigo: 'SALA_NAO_ENCAMINHADA' };
        }
        const saidas = ativosDb.filter((id) => !payloadOrdenado.includes(id));

        // Aplicar comando no engine (valida estado consistente e encaminhada + subset)
        // Guarda o anfitrião antes (membro-id do engine) para comparar membro-id com membro-id.
        const anfitriaoAntesMembroId = contexto.estado.estado.salas.find((s) => s.id === salaId)?.anfitriaoId;
        let aplicado: ReturnType<typeof contexto.estado.aplicar>;
        if (saidas.length === 0) {
          aplicado = contexto.estado.aplicar({ tipo: 'reabrir_sala', salaId });
        } else {
          aplicado = contexto.estado.aplicar({
            tipo: 'reabrir_sala_com_saidas',
            salaId,
            saidas: saidas.map((jogadorId) => ({ jogadorId, motivo: 'saida' as const })),
          });
        }
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

        // Persistência PG atômica — elimina janela de crash entre DELETE+marker
        let reabriu: boolean;
        if (saidas.length === 0) {
          reabriu = await contexto.repo.reabrirSalaComMarkerAtomico(salaId);
        } else {
          const salaReaberta = aplicado.estado.salas.find((s) => s.id === salaId);
          let novoAnfitriaoJogadorId: string | null | undefined = undefined;
          if (salaReaberta) {
            // Engine `anfitriaoId` é membro.id (sucederAnfitriao retorna membro.id);
            // PG `anfitriao_id` guarda jogadorId — converte via vínculo do sucessor.
            // Compara membro-id com membro-id; null = SET NULL explícito (nunca COALESCE).
            const novoMembroId = salaReaberta.anfitriaoId;
            if (novoMembroId === anfitriaoAntesMembroId) {
              novoAnfitriaoJogadorId = undefined;
            } else if (novoMembroId === null) {
              novoAnfitriaoJogadorId = null;
            } else {
              const anfitriaoMembro = salaReaberta.membros.find((m) => m.id === novoMembroId);
              novoAnfitriaoJogadorId = anfitriaoMembro ? anfitriaoMembro.jogadorId : null;
            }
          }
          reabriu = await contexto.repo.reabrirSalaComSaidasAtomico(salaId, saidas, novoAnfitriaoJogadorId);
        }
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
        const salaWire = mapearSala(salaDominio, contexto.estado.apelidoPorJogadorId, contexto.handlers.handlersLinkBase, undefined, contexto.estado.botPorJogadorId);
        contexto.broadcast.enviar(salaId, { type: 'SALA_ATUALIZADA', sala: salaWire });

        return { tipo: 'sucesso' as const, sala: salaWire, idempotente: false };
      });

      if (resultadoOperacao.tipo === 'erro') {
        const mensagens: Record<string, string> = {
          DADOS_INVALIDOS: 'Payload inválido.',
          SALA_NAO_ENCONTRADA: 'Sala não encontrada.',
          SALA_NAO_ENCAMINHADA: 'Sala não está encaminhada.',
          SALA_INCONSISTENTE: 'Sala temporariamente inconsistente, tente novamente.',
          ERRO_INTERNO: 'Erro interno.',
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
