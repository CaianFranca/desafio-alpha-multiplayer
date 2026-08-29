// Servidor WebSocket do game-server (issue #80).
//
// Assinatura: `createWebSocketServer(server, deps?)`. Quando `deps.tabuleiro`
// está presente, um socket só entra no canal da partida se `obterPartida`
// confirmar a existência da partida (via `?partidaId=`). Comandos de tabuleiro
// válidos são roteados ao `TabuleiroHandlers`; PING/PONG continua como
// fallback. Sem `deps`, o servidor opera apenas em PING/PONG para não quebrar
// em cenários sem o módulo de tabuleiro.

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
  const wss = new WebSocketServer({ server });
  const tabuleiro = deps?.tabuleiro;

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    console.log(`[ws] connect: ${request.socket.remoteAddress}`);

    // `partidaId` é resolvido de forma assíncrona (validação no Redis); o
    // handler de mensagens abaixo só roteia comandos de tabuleiro depois que
    // ele for preenchido.
    let partidaId: string | null = null;

    socket.on('error', (error) => {
      console.error('[ws] error:', error.message);
    });

    socket.on('message', (data: RawData) => {
      const parsed = parsearMensagem(data);
      if (parsed === null) {
        return;
      }

      // Sem módulo de tabuleiro (ou socket fora de qualquer partida): só PING/PONG.
      if (tabuleiro === undefined || partidaId === null) {
        if (isPing(parsed)) {
          socket.send(JSON.stringify({ type: 'PONG' } satisfies ServerMessage));
        }
        return;
      }

      if (ehComandoDoTabuleiro(parsed)) {
        void tabuleiro.handlers.aplicarMensagem(socket, partidaId, parsed);
        return;
      }

      if (isPing(parsed)) {
        socket.send(JSON.stringify({ type: 'PONG' } satisfies ServerMessage));
      }
    });

    socket.on('close', () => {
      console.log('[ws] disconnect');
      if (tabuleiro !== undefined) {
        tabuleiro.broadcaster.remover(socket);
      }
    });

    // Valida a partida e registra o socket no broadcaster. Feito após anexar
    // os listeners para não perder mensagens; o `partidaId` protege o roteamento
    // até a validação terminar.
    if (tabuleiro !== undefined) {
      const url = new URL(request.url ?? '', 'http://localhost');
      const candidata = url.searchParams.get('partidaId');
      if (candidata !== null && candidata.length > 0) {
        void (async () => {
          try {
            const partida = await obterPartida(tabuleiro.redis, candidata);
            if (partida !== null) {
              partidaId = candidata;
              tabuleiro.broadcaster.registrar(candidata, socket);
            }
          } catch (erro) {
            console.error('[ws] erro ao validar partida para o canal WS:', erro);
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
