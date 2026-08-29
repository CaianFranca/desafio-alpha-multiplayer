// Servidor WebSocket do game-server (issue #80).
//
// Assinatura: `createWebSocketServer(server, deps?)`. Quando `deps.tabuleiro`
// está presente, um socket só entra no canal da partida se `obterPartida`
// confirmar a existência da partida E a posse do `jogadorId` (via
// `?partidaId=&jogadorId=`, checagem leve no roster — MVP #80, sem auth de
// token). Comandos de tabuleiro válidos são roteados ao `TabuleiroHandlers`;
// PING/PONG responde sempre. Sem `deps`, o servidor opera apenas em PING/PONG.

import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ServerMessage } from '@flicker/shared';
import { obterPartida } from '../partidas/partidas.ts';
import { TabuleiroBroadcaster } from '../tabuleiro/broadcast.ts';
import { TabuleiroHandlers } from '../tabuleiro/handlers.ts';
import { ehComandoDoTabuleiro } from '../tabuleiro/validacao.ts';

export interface TabuleiroWsDeps {
  readonly redis: import('ioredis').Redis;
  readonly broadcaster: TabuleiroBroadcaster;
  readonly handlers: TabuleiroHandlers;
}

export interface WebSocketServerDeps {
  readonly tabuleiro?: TabuleiroWsDeps;
}

export function createWebSocketServer(
  server: Server,
  deps?: WebSocketServerDeps,
): WebSocketServer {
  const wss = new WebSocketServer({ server, maxPayload: 1_048_576 });
  const tabuleiro = deps?.tabuleiro;

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    console.log(`[ws] connect: ${request.socket.remoteAddress}`);

    // `partidaId`/`jogadorId` são resolvidos de forma assíncrona (validação no
    // Redis + posse no roster). Até lá, comandos são bufferizados em `pendentes`
    // para não perdê-los (issue #80 — evita o drop do primeiro comando).
    let partidaId: string | null = null;
    let jogadorId: string | null = null;
    const pendentes: unknown[] = [];

    socket.on('error', (error) => {
      console.error('[ws] error:', error.message);
    });

    socket.on('message', (data: RawData) => {
      const parsed = parsearMensagem(data);
      if (parsed === null) {
        return;
      }

      // PING/PONG responde sempre, mesmo antes da validação.
      if (isPing(parsed)) {
        socket.send(JSON.stringify({ type: 'PONG' } satisfies ServerMessage));
        return;
      }

      // Sem módulo de tabuleiro: ignora qualquer outra mensagem.
      if (tabuleiro === undefined) {
        return;
      }

      // Já validado: roteia o comando de tabuleiro.
      if (partidaId !== null) {
        if (ehComandoDoTabuleiro(parsed)) {
          void tabuleiro.handlers.aplicarMensagem(socket, partidaId, parsed);
        }
        return;
      }

      // Validação pendente: bufferiza o comando (não-PING) para reenvio após OK.
      pendentes.push(parsed);
    });

    socket.on('close', () => {
      console.log('[ws] disconnect');
      pendentes.length = 0;
      if (tabuleiro !== undefined) {
        tabuleiro.broadcaster.remover(socket);
      }
    });

    // Valida a partida e a posse do jogador, e registra o socket no broadcaster.
    // Feito após anexar os listeners para não perder mensagens; o buffer
    // `pendentes` protege o roteamento até a validação terminar.
    if (tabuleiro !== undefined) {
      const url = new URL(request.url ?? '', 'http://localhost');
      const candidataPartida = url.searchParams.get('partidaId');
      const candidataJogador = url.searchParams.get('jogadorId');
      if (
        candidataPartida !== null && candidataPartida.length > 0
        && candidataJogador !== null && candidataJogador.length > 0
      ) {
        void (async () => {
          try {
            const partida = await obterPartida(tabuleiro.redis, candidataPartida);
            // Posse (MVP #80, sem auth de token): o jogador deve estar no roster
            // da partida. `jogadorId` é autodeclarado pelo cliente.
            const temPosse =
              partida !== null
              && partida.roster.some((m) => m.jogadorId === candidataJogador);
            if (temPosse && socket.readyState === socket.OPEN) {
              partidaId = candidataPartida;
              jogadorId = candidataJogador;
              tabuleiro.broadcaster.registrar(candidataPartida, socket);
              // Reenvia os comandos bufferizados durante a validação.
              const bufferizados = pendentes.splice(0, pendentes.length);
              for (const mensagem of bufferizados) {
                if (ehComandoDoTabuleiro(mensagem)) {
                  void tabuleiro.handlers.aplicarMensagem(socket, partidaId, mensagem);
                }
              }
            } else if (socket.readyState === socket.OPEN) {
              // Partida inexistente ou jogador fora do roster: encerra.
              socket.close(4403, 'forbidden');
            }
          } catch (erro) {
            console.error('[ws] erro ao validar partida/posse para o canal WS:', erro);
            if (socket.readyState === socket.OPEN) {
              socket.close(4500, 'internal');
            }
          }
        })();
      }
    }
  });

  return wss;
}

function parsearMensagem(data: RawData): unknown {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function isPing(value: unknown): boolean {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'PING'
  );
}
