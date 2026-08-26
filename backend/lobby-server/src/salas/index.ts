// Contexto de Salas — composição dos singletons (issue #36).
// O `index.ts` instancia o contexto e passa para `createWebSocketServer`.
// O `SalasHandlers` é o ponto de entrada usado pelo `ws.ts` em
// `'message'` e `'close'`.

import { SalasRepo } from './repositorio.ts';
import { SalasProjecao } from './projecao.ts';
import { SalasBroadcaster } from './broadcast.ts';
import { criarSalasState, type SalasState } from './estado.ts';
import { SalasHandlers, obterLinkBase } from './handlers.ts';
import { obterSessao } from '../sessoes.ts';

export interface SalasContexto {
  readonly estado: SalasState;
  readonly projecao: SalasProjecao;
  readonly broadcast: SalasBroadcaster;
  readonly handlers: SalasHandlers;
  readonly repo: SalasRepo;
}

export interface CriarContextoOpcoes {
  readonly repo?: SalasRepo;
  readonly projecao?: SalasProjecao;
  readonly broadcast?: SalasBroadcaster;
  readonly estado?: SalasState;
  readonly linkBase?: string;
  readonly revalidarSessao?: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  readonly gerarCodigo?: () => string;
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
  const linkBase = opcoes.linkBase ?? obterLinkBase();
  const revalidarSessao = opcoes.revalidarSessao ?? (async (sessaoId, jogadorId) => {
    const sessao = await obterSessao(sessaoId);
    return sessao?.jogadorId === jogadorId;
  });

  const handlers = new SalasHandlers({
    repo,
    projecao,
    broadcast,
    estado,
    linkBase,
    revalidarSessao,
    gerarCodigo: opcoes.gerarCodigo,
  });

  return { estado, projecao, broadcast, handlers, repo };
}

export {
  SalasRepo,
  SalasProjecao,
  SalasBroadcaster,
  SalasHandlers,
  criarSalasState,
};
export type { SalasState } from './estado.ts';
