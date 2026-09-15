// Revalidação periódica da Sessão das conexões WS abertas do game-server
// (issue #410). Espelha a do lobby — implementação local por servidor, sem
// abstração nova em `packages/shared`.
//
// A cada `wsSessaoRevalidacaoMs` varre o registro de conexões vigentes:
//   - bots são isentos;
//   - se a Sessão continua válida para o Jogador, mantém a conexão;
//   - se sumiu, segue o marcador `sessao:rotacionada:<id>` (rotação do
//     refresh) até achar uma Sessão válida e migra `conexao.sessaoId`;
//   - sem sucessor (logout, expiração, revogação) encerra com 4401 — o `close`
//     resultante mantém `marcarDesconexaoEArmarJanela` como hoje.
//
// Falha de Redis não derruba conexões: `validarSessaoNoRedis` devolve `false`
// só quando a Sessão não existe/pertence a outro Jogador.

import type { Redis } from 'ioredis';
import { obterSucessorDeSessaoNoRedis, validarSessaoNoRedis } from '../auth.ts';
import { listarConexoes, type ConexaoDoJogador } from './conexao.ts';

/** Código de fechamento de Sessão encerrada (mesmo do handshake do lobby). */
const CODIGO_SESSAO = 4401;
const MOTIVO_SESSAO_INVALIDA = 'SESSAO_INVALIDA';
/** Teto de saltos no encadeamento de marcadores de rotação, anti-loop. */
const MAX_SALTOS_ROTACAO = 8;

export interface DepsRevalidacaoSessao {
  listarConexoes: () => readonly ConexaoDoJogador[];
  validarSessao: (sessaoId: string, jogadorId: string) => Promise<boolean>;
  obterSucessorDeSessao: (sessaoId: string) => Promise<string | null>;
}

export interface OpcoesRevalidacaoSessao {
  intervaloMs: number;
  redis: Redis;
  listarConexoes?: DepsRevalidacaoSessao['listarConexoes'];
  validarSessao?: DepsRevalidacaoSessao['validarSessao'];
  obterSucessorDeSessao?: DepsRevalidacaoSessao['obterSucessorDeSessao'];
}

export interface HandleRevalidacao {
  parar(): void;
}

/**
 * Resolve a Sessão válida correspondente à conexão, seguindo os marcadores de
 * rotação. Devolve o `sessaoId` vigente, ou `null` quando a Sessão não existe
 * mais (ou pertence a outro Jogador).
 */
async function resolverSessaoViva(
  deps: DepsRevalidacaoSessao,
  conexao: ConexaoDoJogador,
): Promise<string | null> {
  let sessaoId = conexao.sessaoId;
  for (let saltos = 0; saltos <= MAX_SALTOS_ROTACAO; saltos += 1) {
    if (await deps.validarSessao(sessaoId, conexao.jogadorId)) {
      return sessaoId;
    }
    const sucessor = await deps.obterSucessorDeSessao(sessaoId);
    if (sucessor === null || sucessor === sessaoId) {
      return null;
    }
    sessaoId = sucessor;
  }
  return null;
}

function fecharConexao(conexao: ConexaoDoJogador): void {
  try {
    conexao.socket.close(CODIGO_SESSAO, MOTIVO_SESSAO_INVALIDA);
  } catch {
    try {
      conexao.socket.terminate();
    } catch {
      // Socket já encerrado: nada a fazer.
    }
  }
}

export async function revalidarConexoesDeSessao(deps: DepsRevalidacaoSessao): Promise<void> {
  for (const conexao of deps.listarConexoes()) {
    if (conexao.isBot) {
      continue;
    }
    try {
      const sessaoViva = await resolverSessaoViva(deps, conexao);
      if (sessaoViva === null) {
        fecharConexao(conexao);
      } else if (sessaoViva !== conexao.sessaoId) {
        conexao.sessaoId = sessaoViva;
      }
    } catch (erro) {
      console.error(
        '[ws] falha na revalidação de sessão:',
        erro instanceof Error ? erro.message : String(erro),
      );
    }
  }
}

export function iniciarRevalidacaoDeSessao(opcoes: OpcoesRevalidacaoSessao): HandleRevalidacao {
  const deps: DepsRevalidacaoSessao = {
    listarConexoes: opcoes.listarConexoes ?? listarConexoes,
    validarSessao:
      opcoes.validarSessao
      ?? ((sessaoId, jogadorId) => validarSessaoNoRedis(opcoes.redis, sessaoId, jogadorId)),
    obterSucessorDeSessao:
      opcoes.obterSucessorDeSessao
      ?? ((sessaoId) => obterSucessorDeSessaoNoRedis(opcoes.redis, sessaoId)),
  };
  const timer = setInterval(() => {
    void revalidarConexoesDeSessao(deps);
  }, opcoes.intervaloMs);
  timer.unref();
  return {
    parar: () => clearInterval(timer),
  };
}
