// Broadcaster intra-processo do canal de Partida (issue #117).
//
// Mononodo no MVP: sem Redis Pub/Sub. O `WebSocketServer` compartilha o loop
// de eventos, então o fan-out é feito em memória. Espelha o princípio de
// `lobby-server/src/salas/broadcast.ts`: tratar `readyState === OPEN`, engolir
// erros de `send` e remover sockets no `close`.

import type { WebSocket } from 'ws';
import type { SalaServerMessage } from '@flicker/shared';

export class PartidaBroadcaster {
  private readonly partidaParaSockets: Map<string, Set<WebSocket>> = new Map();
  private readonly socketParaPartida: Map<WebSocket, string> = new Map();

  /** Associa o socket a uma partida (idempotente). */
  registrar(partidaId: string, socket: WebSocket): void {
    this.socketParaPartida.set(socket, partidaId);
    let sockets = this.partidaParaSockets.get(partidaId);
    if (sockets === undefined) {
      sockets = new Set();
      this.partidaParaSockets.set(partidaId, sockets);
    }
    sockets.add(socket);
  }

  /**
   * Remove o socket de toda a partida a que estava associado. Seguro chamar
   * para sockets nunca registrados.
   */
  remover(socket: WebSocket): void {
    const partidaId = this.socketParaPartida.get(socket);
    this.socketParaPartida.delete(socket);
    if (partidaId === undefined) {
      return;
    }
    const sockets = this.partidaParaSockets.get(partidaId);
    if (sockets !== undefined) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.partidaParaSockets.delete(partidaId);
      }
    }
  }

  /** Envia um ou mais eventos para todos os sockets da partida (broadcast). */
  enviar(partidaId: string, ...eventos: readonly SalaServerMessage[]): void {
    const sockets = this.partidaParaSockets.get(partidaId);
    if (sockets === undefined) {
      return;
    }
    for (const evento of eventos) {
      const payload = JSON.stringify(evento);
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(payload);
          } catch {
            // Socket em estado intermediário: engole para não interromper o
            // broadcast dos demais; o `close` subsequente cuida da remoção.
          }
        }
      }
    }
  }

  /** Envia o evento apenas para o socket de origem (erros individuais). */
  enviarParaSocket(socket: WebSocket, evento: SalaServerMessage): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    try {
      socket.send(JSON.stringify(evento));
    } catch {
      // engole; idem `enviar`.
    }
  }

  /** Fecha todos os sockets de uma partida não iniciada para forçar reconnect → ADMISSAO_REJEITADA no upgrade. */
  encerrarPorNaoInicio(partidaId: string, code = 4000, reason = 'PARTIDA_NAO_INICIADA'): void {
    const sockets = this.partidaParaSockets.get(partidaId);
    if (sockets === undefined) return;
    for (const socket of [...sockets]) {
      try {
        if (socket.readyState === socket.OPEN) socket.close(code, reason);
        else socket.terminate();
      } catch {}
    }
  }
}