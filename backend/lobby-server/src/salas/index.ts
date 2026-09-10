// Contexto de Salas — composição dos singletons (issue #36).
// O `index.ts` instancia o contexto e passa para `createWebSocketServer`.
// O `SalasHandlers` é o ponto de entrada usado pelo `ws.ts` em
// `'message'` e `'close'`.

import { SalasRepo } from './repositorio.ts';
import { SalasProjecao } from './projecao.ts';
import { SalasBroadcaster } from './broadcast.ts';
import { criarSalasState, type SalasState } from './estado.ts';
import { SalasHandlers, obterLinkBase } from './handlers.ts';
import { SalasReconexao } from './reconexao.ts';
import { DebugStreamDasSalas } from '../ws/debug-stream.ts';
import { obterSessao } from '../sessoes.ts';

export interface SalasContexto {
  readonly estado: SalasState;
  readonly projecao: SalasProjecao;
  readonly broadcast: SalasBroadcaster;
  readonly handlers: SalasHandlers;
  readonly repo: SalasRepo;
  readonly reconexao: SalasReconexao;
  /** Stream de debug (issue #340). Opcional: testes sem debug montam o contexto sem o campo. */
  readonly debug?: DebugStreamDasSalas;
}

export interface CriarContextoOpcoes {
  readonly repo?: SalasRepo;
  readonly projecao?: SalasProjecao;
  readonly broadcast?: SalasBroadcaster;
  readonly estado?: SalasState;
  readonly reconexao?: SalasReconexao;
  readonly linkBase?: string;
  readonly revalidarSessao?: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  readonly gerarCodigo?: () => string;
  readonly janelaReconexaoMs?: number;
  readonly ofertarEncaminhamento?: (oferta: import('@flicker/shared').OfertaDeEncaminhamento) => Promise<import('@flicker/shared').AceiteDoEncaminhamento>;
  readonly cancelarPartida?: (serverId: string, partidaId: string, motivo: string, serverUrl?: string) => Promise<void>;
  readonly redis?: import('ioredis').Redis;
  readonly timeoutMs?: number;
}

/**
 * Constrói e devolve o contexto de Salas. Cada dependência pode ser
 * sobrescrita via parâmetro — útil para testes que injetam instâncias
 * com pool/redis dedicados (test #6 do plano paraleliza 4 chamadas, e
 * `poolMax=10` exige um pool dedicado para não saturar).
 */
export function criarContextoDasSalas(
  opcoes: CriarContextoOpcoes = {},
): SalasContexto {
  const repo = opcoes.repo ?? new SalasRepo();
  const projecao = opcoes.projecao ?? new SalasProjecao();
  const broadcast = opcoes.broadcast ?? new SalasBroadcaster();
  const estado = opcoes.estado ?? criarSalasState();
  const reconexao = opcoes.reconexao ?? new SalasReconexao(undefined, opcoes.janelaReconexaoMs);
  const linkBase = opcoes.linkBase ?? obterLinkBase();
  const revalidarSessao = opcoes.revalidarSessao ?? (async (sessaoId, jogadorId) => {
    const sessao = await obterSessao(sessaoId);
    return sessao?.jogadorId === jogadorId;
  });

  // Stream de debug (issue #340): mesmo fallback de resolução dos handlers
  // (projeção → PG), injetado como função para o ws.ts e os handlers usarem
  // a mesma fonte de salaId. Instanciado ANTES dos handlers para ser
  // injetado no construtor — sem isso o `handler.espelhar()` vira no-op no
  // lobby real (o `ws.ts` passava o debug só para o `receberComando`).
  const debug = new DebugStreamDasSalas({
    resolverSalaId: async (jogadorId) => {
      const salaId = await projecao.obterAssociacaoJogador(jogadorId);
      if (salaId !== null) return salaId;
      return repo.obterSalaAtivaDoJogador(jogadorId);
    },
  });

  const handlers = new SalasHandlers({
    repo,
    projecao,
    broadcast,
    estado,
    reconexao,
    linkBase,
    revalidarSessao,
    gerarCodigo: opcoes.gerarCodigo,
    janelaReconexaoMs: opcoes.janelaReconexaoMs,
    ofertarEncaminhamento: opcoes.ofertarEncaminhamento,
    cancelarPartida: opcoes.cancelarPartida,
    redis: opcoes.redis,
    timeoutMs: opcoes.timeoutMs,
    debug,
  });

  return { estado, projecao, broadcast, handlers, repo, reconexao, debug };
}

export {
  SalasRepo,
  SalasProjecao,
  SalasBroadcaster,
  SalasHandlers,
  SalasReconexao,
  criarSalasState,
};
export type { SalasState } from './estado.ts';
