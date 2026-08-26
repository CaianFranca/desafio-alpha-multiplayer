import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ServerMessage } from '@flicker/shared';
import { NOME_ACCESS_COOKIE } from '../cookies.ts';
import { parseCookies } from '../middleware/cookie.ts';
import { verificarAccess } from '../jwt.ts';
import { obterSessao } from '../sessoes.ts';
import { ehSalaComando } from '../salas/handlers.ts';
import type { SalasContexto } from '../salas/index.ts';

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
  /**
   * Contexto de Salas (issue #36). Quando presente, mensagens de
   * `SalaComandoDoCliente` são roteadas para `SalasHandlers.aplicarMensagem`;
   * quando ausente, o handler cai no fallback `PING/PONG` (preserva
   * compatibilidade com testes que não montam contexto de Salas).
   */
  contextoSalas?: SalasContexto;
}

async function autenticarRequest(
  request: IncomingMessage,
  deps: Required<Pick<WsDeps, 'verificarAccess' | 'obterSessao'>>,
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
  const depsResolvidas = {
    verificarAccess: deps.verificarAccess ?? verificarAccess,
    obterSessao: deps.obterSessao ?? obterSessao,
  };
  const contextoSalas = deps.contextoSalas;

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, request) => {
    // O listener de 'message' é registrado IMEDIATAMENTE após o
    // 'connection' — antes do `await autenticarRequest`. Sem isso, o
    // `EventEmitter` do Node descarta silenciosamente mensagens que
    // cheguem na janela entre o upgrade e o fim da autenticação (a
    // library `ws` emite 'message' de forma síncrona). Mensagens
    // recebidas antes do `socket.data` ser preenchido são bufferizadas
    // e drenadas após o aceite, com um teto anti-DoS de 32 entradas.
    const authSocket = socket as AuthenticatedWebSocket;
    const mensagensAguardandoAuth: RawData[] = [];
    const LIMITE_BUFFER_PRE_AUTH = 32;
    let autenticado = false;

    socket.on('error', (error) => {
      console.error('[ws] error:', error.message);
    });

    socket.on('message', (data) => {
      if (autenticado) {
        void handleMessage(data, authSocket, contextoSalas);
      } else if (mensagensAguardandoAuth.length < LIMITE_BUFFER_PRE_AUTH) {
        mensagensAguardandoAuth.push(data);
      }
      // Fora do limite: descarta silenciosamente (anti-DoS por cliente
      // malicioso que envia milhares de mensagens pré-autenticação).
    });

    socket.on('close', () => {
      console.log('[ws] disconnect');
      if (autenticado && contextoSalas !== undefined) {
        contextoSalas.handlers.handleFechamento(authSocket);
      }
    });

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

        authSocket.data = auth;
        autenticado = true;
        console.log(`[ws] auth: ${auth.jogadorId} (${auth.apelido})`);
        console.log(`[ws] connect: ${request.socket.remoteAddress} jogador=${auth.jogadorId}`);

        // Drena o buffer de mensagens que chegaram antes da autenticação.
        for (const data of mensagensAguardandoAuth.splice(0)) {
          void handleMessage(data, authSocket, contextoSalas);
        }
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

async function handleMessage(
  data: RawData,
  socket: AuthenticatedWebSocket,
  contextoSalas: SalasContexto | undefined,
): Promise<void> {
  // Parseia uma única vez; o despacho abaixo decide entre Salas e
  // PING/PONG sem custo extra de reparseamento.
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return;
  }

  // Salas primeiro (inclui todos os 9 comandos do protocolo — os 3 do #36
  // e os 6 fora do escopo, que respondem ERRO_DA_SALA no SalasHandlers).
  if (contextoSalas !== undefined && ehSalaComando(parsed)) {
    await contextoSalas.handlers.aplicarMensagem(socket, parsed);
    return;
  }

  // Fallback PING/PONG preservado do contrato original (issue #40).
  if (isPingMessage(parsed)) {
    try {
      socket.send(JSON.stringify({ type: 'PONG' }));
    } catch {}
  }
}

function isPingMessage(value: unknown): boolean {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'PING'
  );
}
