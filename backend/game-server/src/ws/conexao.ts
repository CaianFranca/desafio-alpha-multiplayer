import type { WebSocket } from 'ws';
import type { PartidaId } from '@flicker/shared';

export interface ConexaoDoJogador {
  readonly socket: WebSocket;
  readonly jogadorId: string;
  readonly apelido: string;
  readonly partidaId: PartidaId;
  /** Sessão que autenticou a conexão (issue #410); migra na rotação do refresh. */
  sessaoId: string;
  /** Bots são isentos da revalidação de Sessão (issue #410). */
  readonly isBot: boolean;
}

// Registro único por Jogador dentro de cada Partida (issue #155): uma nova
// Conexão à Partida do mesmo Jogador substitui a anterior, então a estrutura
// é Map<partidaId, Map<jogadorId, ConexaoDoJogador>> — nunca há mais de uma
// conexão vigente por Jogador.
const conexoesPorPartida = new Map<PartidaId, Map<string, ConexaoDoJogador>>();

/**
 * Registra a conexão como a vigente do Jogador na Partida e devolve a conexão
 * anterior (`null` se não havia). Quem chama fica responsável por encerrar a
 * conexão anterior (substituição de Conexão duplicada, #155) — ela já saiu do
 * registro aqui.
 */
export function adicionarConexao(conexao: ConexaoDoJogador): ConexaoDoJogador | null {
  let porJogador = conexoesPorPartida.get(conexao.partidaId);
  if (porJogador === undefined) {
    porJogador = new Map();
    conexoesPorPartida.set(conexao.partidaId, porJogador);
  }
  const anterior = porJogador.get(conexao.jogadorId) ?? null;
  porJogador.set(conexao.jogadorId, conexao);
  return anterior;
}

/**
 * Remove a conexão do registro. Retorna `true` apenas se a conexão fechada
 * era a vigente do Jogador — o `close` usa isso para decidir se marca
 * `em_reconexao`: quando a conexão já foi substituída (#155), a presença do
 * Jogador permanece `conectado`.
 */
export function removerConexao(conexao: ConexaoDoJogador): boolean {
  const porJogador = conexoesPorPartida.get(conexao.partidaId);
  if (porJogador === undefined) {
    return false;
  }
  if (porJogador.get(conexao.jogadorId) !== conexao) {
    return false;
  }
  porJogador.delete(conexao.jogadorId);
  if (porJogador.size === 0) {
    conexoesPorPartida.delete(conexao.partidaId);
  }
  return true;
}

/** Conexões vigentes da Partida, indexadas por `jogadorId`. */
export function obterConexoes(partidaId: PartidaId): ReadonlyMap<string, ConexaoDoJogador> {
  return conexoesPorPartida.get(partidaId) ?? new Map();
}

/** Todas as conexões vigentes registradas — a revalidação de Sessão as varre (issue #410). */
export function listarConexoes(): ConexaoDoJogador[] {
  const conexoes: ConexaoDoJogador[] = [];
  for (const porJogador of conexoesPorPartida.values()) {
    for (const conexao of porJogador.values()) {
      conexoes.push(conexao);
    }
  }
  return conexoes;
}
