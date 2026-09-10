// Broadcaster intra-processo das Salas (issue #36).
//
// Decisão do plano: sem Redis Pub/Sub. O escopo do lobby-server é
// mononodo no MVP; a instância atual já concentra o broadcast via
// `WebSocketServer` que compartilha o loop de eventos. Para escalar
// horizontalmente, o caminho natural é mover o fan-out para um transporte
// pub/sub (Redis Streams ou NATS) — fora do #36.
//
// Modelo:
//   jogadorId -> salaId
//   socket    -> salaId
//   salaId    -> Set<socket>
//
// `socket -> jogadorId` e `socket -> salaId` são mantidos para remover
// corretamente no `close` (o handler pode chegar a partir de um socket que
// não estava associado a uma sala — ex.: jogador sem Sala no momento da
// conexão). Suporta múltiplas conexões por jogador (verificado em
// `ws-auth.integration.test.ts`); cada socket é entregue o mesmo evento
// independentemente.

import type { WebSocket } from 'ws';
import type { SalaEventoDoServidor, SalaServerMessage } from '@flicker/shared';

export class SalasBroadcaster {
  private readonly socketParaSala: Map<WebSocket, string> = new Map();
  private readonly socketParaJogador: Map<WebSocket, string> = new Map();
  private readonly jogadorParaSala: Map<string, string> = new Map();
  private readonly salaParaSockets: Map<string, Set<WebSocket>> = new Map();

  /**
   * Associa o socket ao jogador+sala. O jogador pode ter várias conexões
   * abertas simultaneamente; o broadcaster entrega o evento para todas.
   * Idempotente para o mesmo `(jogadorId, salaId, socket)`.
   */
  registrarSocket(jogadorId: string, salaId: string, socket: WebSocket): void {
    this.socketParaSala.set(socket, salaId);
    this.socketParaJogador.set(socket, jogadorId);
    this.jogadorParaSala.set(jogadorId, salaId);

    let sockets = this.salaParaSockets.get(salaId);
    if (sockets === undefined) {
      sockets = new Set();
      this.salaParaSockets.set(salaId, sockets);
    }
    sockets.add(socket);
  }

  /**
   * Remove o socket. Devolve a Sala a que estava associado (se houver) e a
   * contagem restante de conexões do Jogador para diagnóstico. Presença e
   * reconexão pertencem à #38.
   */
  removerSocket(socket: WebSocket): { salaId: string | null; jogadorId: string | null; restantes: number } {
    const salaId = this.socketParaSala.get(socket) ?? null;
    const jogadorId = this.socketParaJogador.get(socket) ?? null;
    this.socketParaSala.delete(socket);
    this.socketParaJogador.delete(socket);

    if (salaId !== null) {
      const sockets = this.salaParaSockets.get(salaId);
      if (sockets !== undefined) {
        sockets.delete(socket);
        if (sockets.size === 0) {
          this.salaParaSockets.delete(salaId);
        }
      }
    }

    if (jogadorId !== null) {
      const outrasConexoes = this.contarConexoesDoJogador(jogadorId);
      if (outrasConexoes === 0) {
        this.jogadorParaSala.delete(jogadorId);
      }
      return { salaId, jogadorId, restantes: outrasConexoes };
    }

    return { salaId, jogadorId: null, restantes: 0 };
  }

  /** Conta quantos sockets ainda estão abertos para o jogador. */
  private contarConexoesDoJogador(jogadorId: string): number {
    let count = 0;
    for (const j of this.socketParaJogador.values()) {
      if (j === jogadorId) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Envia o evento para todos os sockets da sala. Sockets em estado de
   * fechamento (OPEN !== readyState) são pulados sem erro — `ws` reescreve
   * a flag imediatamente após `close()`.
   */
  enviar(salaId: string, evento: SalaServerMessage): void {
    const sockets = this.salaParaSockets.get(salaId);
    if (sockets === undefined) {
      return;
    }
    const payload = JSON.stringify(evento);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.send(payload);
        } catch {
          // Socket em estado intermediário: engole para não interromper o
          // broadcast dos demais. O `close` subsequente cuidará da remoção.
        }
      }
    }
  }

  /**
   * Envia o evento apenas para o socket de origem (usado para erros
   * individuais — ex.: `ERRO_DA_SALA` quando o engine rejeita).
   */
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

  /**
   * Envia o evento para todos os sockets do jogador. Útil para erros
   * derivados de validação local que devem aparecer em todas as abas
   * conectadas (não usado no escopo atual, mas mantém a API consistente).
   */
  enviarParaJogador(jogadorId: string, evento: SalaServerMessage): void {
    const payload = JSON.stringify(evento);
    for (const [socket, j] of this.socketParaJogador.entries()) {
      if (j === jogadorId && socket.readyState === socket.OPEN) {
        try {
          socket.send(payload);
        } catch {
          // engole; idem `enviar`.
        }
      }
    }
  }

  /**
   * Remove todos os sockets associados a uma sala (usado no encerramento
   * explícito para evitar vazamento de fan-out).
   */
  removerPorSala(salaId: string): void {
    const sockets = this.salaParaSockets.get(salaId);
    if (sockets === undefined) {
      return;
    }
    const jogadores = new Set<string>();
    for (const socket of sockets) {
      const j = this.socketParaJogador.get(socket);
      if (j !== undefined) jogadores.add(j);
    }
    for (const socket of sockets) {
      this.socketParaSala.delete(socket);
      this.socketParaJogador.delete(socket);
    }
    this.salaParaSockets.delete(salaId);
    for (const j of jogadores) {
      if (this.contarConexoesDoJogador(j) === 0) {
        this.jogadorParaSala.delete(j);
      }
    }
  }

  /**
   * Remove TODOS os sockets de um jogador (usado no bypass de Partida Órfã —
   * review JF532, O3: o chamador só tem o `jogadorId`, não um socket
   * específico). Espelha `removerPorSala`: limpa os três mapas por socket e
   * remove `jogadorParaSala` quando o jogador fica sem conexões. Devolve a
   * contagem removida; idempotente.
   */
  removerSocketPorJogadorId(jogadorId: string): number {
    const sockets: WebSocket[] = [];
    for (const [socket, j] of this.socketParaJogador.entries()) {
      if (j === jogadorId) {
        sockets.push(socket);
      }
    }
    for (const socket of sockets) {
      const salaId = this.socketParaSala.get(socket);
      if (salaId !== undefined) {
        const socketsDaSala = this.salaParaSockets.get(salaId);
        if (socketsDaSala !== undefined) {
          socketsDaSala.delete(socket);
          if (socketsDaSala.size === 0) {
            this.salaParaSockets.delete(salaId);
          }
        }
      }
      this.socketParaSala.delete(socket);
      this.socketParaJogador.delete(socket);
    }
    if (sockets.length > 0 && this.contarConexoesDoJogador(jogadorId) === 0) {
      this.jogadorParaSala.delete(jogadorId);
    }
    return sockets.length;
  }
}
