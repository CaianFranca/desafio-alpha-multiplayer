import type { WebSocket } from 'ws';
import type { PartidaId } from '@flicker/shared';

export interface ConexaoDoJogador {
  readonly socket: WebSocket;
  readonly jogadorId: string;
  readonly apelido: string;
  readonly partidaId: PartidaId;
}

const conexoesPorPartida = new Map<PartidaId, Set<ConexaoDoJogador>>();

export function adicionarConexao(conexao: ConexaoDoJogador): void {
  let conjunto = conexoesPorPartida.get(conexao.partidaId);
  if (conjunto === undefined) {
    conjunto = new Set();
    conexoesPorPartida.set(conexao.partidaId, conjunto);
  }
  conjunto.add(conexao);
}

export function removerConexao(conexao: ConexaoDoJogador): void {
  const conjunto = conexoesPorPartida.get(conexao.partidaId);
  if (conjunto !== undefined) {
    conjunto.delete(conexao);
    if (conjunto.size === 0) {
      conexoesPorPartida.delete(conexao.partidaId);
    }
  }
}

export function obterConexoes(partidaId: PartidaId): ReadonlySet<ConexaoDoJogador> {
  return conexoesPorPartida.get(partidaId) ?? new Set();
}
