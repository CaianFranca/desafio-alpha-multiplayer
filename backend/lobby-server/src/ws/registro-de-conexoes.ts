// Registro das conexões WS autenticadas do lobby (issue #410).
//
// Mantém dois índices espelhados — jogador → sockets e socket → dados da
// autenticação — para (a) localizar e encerrar todas as conexões vigentes de
// um Jogador (logout e troca de Sessão) e (b) a revalidação periódica varrer
// as conexões abertas. O tipo dos dados é deliberadamente local (não importa
// `WsAuthData` de `ws.ts`) para não criar ciclo de runtime entre os módulos;
// estruturalmente é o mesmo objeto gravado em `socket.data` por `ws.ts`, então
// mutar `sessaoId` aqui também atualiza a autenticação do socket.

import type { WebSocket } from 'ws';

/** Código de fechamento de Sessão (reutilizado do handshake do #40). */
export const CODIGO_SESSAO = 4401;
export const MOTIVO_SESSAO_ENCERRADA = 'SESSAO_ENCERRADA';
export const MOTIVO_SESSAO_SUBSTITUIDA = 'SESSAO_SUBSTITUIDA';
export const MOTIVO_SESSAO_INVALIDA = 'SESSAO_INVALIDA';

/** Dados de autenticação associados a uma conexão (mesma forma de `WsAuthData`). */
export interface DadosDeConexaoWs {
  jogadorId: string;
  sessaoId: string;
  email: string;
  apelido: string;
}

export interface ConexaoRegistrada {
  readonly socket: WebSocket;
  readonly dados: DadosDeConexaoWs;
}

export class RegistroDeConexoes {
  private readonly porJogador = new Map<string, Set<WebSocket>>();
  private readonly porSocket = new Map<WebSocket, DadosDeConexaoWs>();

  registrar(socket: WebSocket, dados: DadosDeConexaoWs): void {
    this.porSocket.set(socket, dados);
    let sockets = this.porJogador.get(dados.jogadorId);
    if (sockets === undefined) {
      sockets = new Set();
      this.porJogador.set(dados.jogadorId, sockets);
    }
    sockets.add(socket);
  }

  desregistrar(socket: WebSocket): void {
    const dados = this.porSocket.get(socket);
    if (dados === undefined) {
      return;
    }
    this.porSocket.delete(socket);
    const sockets = this.porJogador.get(dados.jogadorId);
    if (sockets !== undefined) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.porJogador.delete(dados.jogadorId);
      }
    }
  }

  /** Conexões registradas no momento — a revalidação varre esta lista. */
  listar(): ConexaoRegistrada[] {
    return [...this.porSocket].map(([socket, dados]) => ({ socket, dados }));
  }

  /**
   * Migra o `sessaoId` da conexão (rotação do refresh). O objeto de dados é o
   * mesmo referenciado por `socket.data`, então a autenticação do socket
   * acompanha a migração.
   */
  migrarSessao(socket: WebSocket, sessaoId: string): void {
    const dados = this.porSocket.get(socket);
    if (dados !== undefined) {
      dados.sessaoId = sessaoId;
    }
  }

  /** Remove a conexão dos índices e a encerra. */
  fecharConexao(socket: WebSocket, codigo: number, motivo: string): void {
    this.desregistrar(socket);
    this.fechar(socket, codigo, motivo);
  }

  /**
   * Encerra todas as conexões vigentes do Jogador (logout/troca de Sessão) e
   * devolve quantas foram fechadas.
   */
  fecharPorJogador(jogadorId: string, codigo: number, motivo: string): number {
    const sockets = this.porJogador.get(jogadorId);
    if (sockets === undefined) {
      return 0;
    }
    let fechadas = 0;
    for (const socket of [...sockets]) {
      this.fecharConexao(socket, codigo, motivo);
      fechadas += 1;
    }
    return fechadas;
  }

  private fechar(socket: WebSocket, codigo: number, motivo: string): void {
    try {
      socket.close(codigo, motivo);
    } catch {
      try {
        socket.terminate();
      } catch {
        // Socket já encerrado: nada a fazer.
      }
    }
  }
}

/** Singleton compartilhado entre o WS e as rotas de auth. */
export const registroDeConexoes = new RegistroDeConexoes();
