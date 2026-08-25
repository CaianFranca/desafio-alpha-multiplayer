import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@flicker/shared';
import { NOME_ACCESS_COOKIE } from '../cookies.ts';
import { parseCookies } from '../middleware/cookie.ts';
import { verificarAccess } from '../jwt.ts';
import { obterSessao } from '../sessoes.ts';

export interface WsAuthData {
  jogadorId: string;
  sessaoId: string;
  apelido: string;
  email: string;
}

export type AuthenticatedWebSocket = WebSocket & { data: WsAuthData };

export interface WsDeps {
  verificarAccess?: typeof verificarAccess;
  obterSessao?: typeof obterSessao;
}

async function autenticarRequest(
  request: IncomingMessage,
  deps: Required<WsDeps>,
): Promise<WsAuthData | null> {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[NOME_ACCESS_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const payload = deps.verificarAccess(token);
  if (payload === null) {
    return null;
  }
  let sessao: Awaited<ReturnType<typeof deps.obterSessao>> | null;
  try {
    sessao = await deps.obterSessao(payload.sessaoId);
  } catch {
    return null;
  }
  if (sessao === null || sessao.jogadorId !== payload.jogadorId) {
    return null;
  }
  return {
    jogadorId: payload.jogadorId,
    sessaoId: payload.sessaoId,
    apelido: payload.apelido,
    email: payload.email,
  };
}

export function createWebSocketServer(server: Server, deps: WsDeps = {}): WebSocketServer {
  const depsResolvidas: Required<WsDeps> = {
    verificarAccess: deps.verificarAccess ?? verificarAccess,
    obterSessao: deps.obterSessao ?? obterSessao,
  };

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, request) => {
    (async () => {
      try {
        const auth = await autenticarRequest(request as IncomingMessage, depsResolvidas);
        if (auth === null) {
          console.log(`[ws] reject: ${request.socket.remoteAddress} (sessão inválida)`);
          try {
            socket.close(4401, 'Unauthorized');
          } catch {
            socket.terminate();
          }
          return;
        }

        (socket as AuthenticatedWebSocket).data = auth;
        console.log(`[ws] auth: ${auth.jogadorId} (${auth.apelido})`);

        console.log(`[ws] connect: ${request.socket.remoteAddress} jogador=${auth.jogadorId}`);

        socket.on('error', (error) => {
          console.error('[ws] error:', error.message);
        });

        socket.on('message', (data) => {
          const reply = handleMessage(data);
          if (reply) {
            socket.send(JSON.stringify(reply));
          }
        });

        socket.on('close', () => {
          console.log('[ws] disconnect');
        });
      } catch {
        try {
          socket.close(1011, 'Internal error');
        } catch {
          try {
            socket.terminate();
          } catch {}
        }
      }
    })().catch(() => {
      try {
        socket.terminate();
      } catch {}
    });
  });

  return wss;
}

function handleMessage(data: RawData): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (!isClientMessage(parsed)) {
    return null;
  }

  switch (parsed.type) {
    case 'PING':
      return { type: 'PONG' };
    default:
      return null;
  }
}

function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'PING'
  );
}
