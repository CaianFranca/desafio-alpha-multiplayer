// Revalidação periódica da Sessão das conexões WS abertas do lobby (issue #410).
//
// A cada `wsSessaoRevalidacaoMs` varre o registro de conexões e, para cada uma:
//   - bots (flag `isBot`) são isentos;
//   - se `sessao:<id>` continua viva e do mesmo Jogador, mantém a conexão;
//   - se sumiu, segue o marcador `sessao:rotacionada:<antigaId>` (rotação do
//     refresh) até achar uma Sessão viva do mesmo Jogador e migra o `sessaoId`;
//   - sem sucessor (logout, expiração, revogação) encerra com 4401.
//
// A implementação é local ao lobby (a do game-server é espelhada, sem
// abstração nova em `packages/shared`). Falha de Redis não derruba conexões:
// o ciclo é abortado na primeira falha (uma única linha de log) e repetido no
// próximo intervalo. Ticks não se sobrepõem: o handle guarda uma flag
// anti-sobreposição e o próximo tick é ignorado enquanto o anterior roda.

import { obterSessao, obterSucessorDeSessao } from '../sessoes.ts';
import {
  CODIGO_SESSAO,
  MOTIVO_SESSAO_INVALIDA,
  registroDeConexoes,
  type DadosDeConexaoWs,
  type RegistroDeConexoes,
} from './registro-de-conexoes.ts';

/** Teto de saltos no encadeamento de marcadores de rotação, anti-loop. */
const MAX_SALTOS_ROTACAO = 8;

export interface DepsRevalidacaoSessao {
  registro: RegistroDeConexoes;
  obterSessao: (sessaoId: string) => Promise<{ jogadorId: string } | null>;
  obterSucessorDeSessao: (sessaoId: string) => Promise<string | null>;
}

export interface OpcoesRevalidacaoSessao {
  intervaloMs: number;
  registro?: RegistroDeConexoes;
  obterSessao?: DepsRevalidacaoSessao['obterSessao'];
  obterSucessorDeSessao?: DepsRevalidacaoSessao['obterSucessorDeSessao'];
}

export interface HandleRevalidacao {
  parar(): void;
}

/**
 * Resolve a Sessão viva correspondente à conexão, seguindo os marcadores de
 * rotação. Devolve o `sessaoId` vigente, ou `null` quando a Sessão não existe
 * mais (ou pertence a outro Jogador).
 */
async function resolverSessaoViva(
  deps: DepsRevalidacaoSessao,
  dados: DadosDeConexaoWs,
): Promise<string | null> {
  let sessaoId = dados.sessaoId;
  for (let saltos = 0; saltos <= MAX_SALTOS_ROTACAO; saltos += 1) {
    const sessao = await deps.obterSessao(sessaoId);
    if (sessao !== null) {
      return sessao.jogadorId === dados.jogadorId ? sessaoId : null;
    }
    const sucessor = await deps.obterSucessorDeSessao(sessaoId);
    if (sucessor === null || sucessor === sessaoId) {
      return null;
    }
    sessaoId = sucessor;
  }
  return null;
}

export async function revalidarConexoesDeSessao(deps: DepsRevalidacaoSessao): Promise<void> {
  for (const { socket, dados } of deps.registro.listar()) {
    if (dados.isBot === true) {
      continue;
    }
    try {
      const sessaoViva = await resolverSessaoViva(deps, dados);
      if (sessaoViva === null) {
        deps.registro.fecharConexao(socket, CODIGO_SESSAO, MOTIVO_SESSAO_INVALIDA);
      } else if (sessaoViva !== dados.sessaoId) {
        deps.registro.migrarSessao(socket, sessaoViva);
      }
    } catch (erro) {
      // Falha de Redis/infra: aborta o ciclo inteiro. Loga uma única vez para
      // não spammar o log a cada conexão — o próximo tick reexecuta.
      console.error(
        '[ws] falha na revalidação de sessão (ciclo abortado):',
        erro instanceof Error ? erro.message : String(erro),
      );
      break;
    }
  }
}

export function iniciarRevalidacaoDeSessao(opcoes: OpcoesRevalidacaoSessao): HandleRevalidacao {
  const deps: DepsRevalidacaoSessao = {
    registro: opcoes.registro ?? registroDeConexoes,
    obterSessao: opcoes.obterSessao ?? obterSessao,
    obterSucessorDeSessao: opcoes.obterSucessorDeSessao ?? obterSucessorDeSessao,
  };
  // Guarda anti-sobreposição: um tick lento (Redis) não pode acumular ciclos
  // concorrentes sobre o mesmo registro. Enquanto um roda, os próximos são
  // ignorados.
  let emExecucao = false;
  const timer = setInterval(() => {
    if (emExecucao) {
      return;
    }
    emExecucao = true;
    void revalidarConexoesDeSessao(deps).finally(() => {
      emExecucao = false;
    });
  }, opcoes.intervaloMs);
  timer.unref();
  return {
    parar: () => clearInterval(timer),
  };
}
