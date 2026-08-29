import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData } from 'ws';
import type { ClientMessage, ServerMessage, PartidaId, ServerId, MembroDaSala, CodigoDeErroDeAdmissao, AdmissaoRejeitadaEvento } from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import { obterPartida, atualizarPresencaAtomica } from '../partidas/partidas.ts';
import { validarTokenDeSessao, validarSessaoNoRedis } from '../auth.ts';
import { adicionarConexao, removerConexao, type ConexaoDoJogador } from './conexao.ts';

const WS_PATH_RE = /^\/ws\/game\/([^/]+)$/;

interface UpgradeResultado {
  readonly permitido: true;
  readonly serverId: ServerId;
  readonly partidaId: PartidaId;
  readonly token: string;
}

type UpgradeErro = { readonly permitido: false; readonly status: number; readonly body: string };

function erroRejeitada(codigo: CodigoDeErroDeAdmissao, motivo: string): string {
  return JSON.stringify({ type: 'ADMISSAO_REJEITADA', codigo, motivo } satisfies AdmissaoRejeitadaEvento);
}

function parsearUpgrade(request: IncomingMessage, serverIdProprio: ServerId): UpgradeResultado | UpgradeErro {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const match = WS_PATH_RE.exec(url.pathname);

  if (match === null) {
    return { permitido: false, status: 404, body: erroRejeitada('SERVER_ID_INVALIDO', 'path inválido') };
  }

  const serverIdFromPath = decodeURIComponent(match[1]);
  if (serverIdFromPath !== serverIdProprio) {
    return { permitido: false, status: 404, body: erroRejeitada('SERVER_ID_INVALIDO', 'serverId não corresponde a este game-server') };
  }

  const partidaId = url.searchParams.get('partida-id');
  if (partidaId === null || partidaId.length === 0) {
    return { permitido: false, status: 400, body: erroRejeitada('PARTIDA_ID_AUSENTE', 'query param partida-id é obrigatório') };
  }

  const token = extrairToken(request, url);
  if (token === null) {
    return { permitido: false, status: 401, body: erroRejeitada('SESSAO_INVALIDA', 'token de sessão ausente') };
  }

  return { permitido: true, serverId: serverIdFromPath as ServerId, partidaId: partidaId as PartidaId, token };
}

function extrairToken(request: IncomingMessage, url: URL): string | null {
  // 1. Cookie access_token
  const cookieHeader = request.headers.cookie;
  if (cookieHeader !== undefined) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.split('=');
      if (name === 'access_token') {
        return rest.join('=');
      }
    }
  }

  // 2. Query param token
  const tokenParam = url.searchParams.get('token');
  if (tokenParam !== null && tokenParam.length > 0) {
    return tokenParam;
  }

  return null;
}

function enviarErroNoSocket(socket: Duplex, status: number, body: string): void {
  const response = [
    `HTTP/1.1 ${status} ${STATUS_PHRASES[status] ?? 'Error'}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
  socket.write(response);
  socket.destroy();
}

const STATUS_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

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

export function criarWebSocketServer(server: Server, contexto: ContextoDoGameServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const resultado = parsearUpgrade(request, contexto.serverId);

    if (!resultado.permitido) {
      enviarErroNoSocket(socket, resultado.status, resultado.body);
      return;
    }

    const { partidaId, token } = resultado;

    const sessao = validarTokenDeSessao(token, contexto.jwtSecret);
    if (sessao === null) {
      enviarErroNoSocket(socket, 401, erroRejeitada('SESSAO_INVALIDA', 'token de sessão inválido ou expirado'));
      return;
    }

    (async () => {
      if (sessao.sessaoId !== undefined) {
        const sessaoValida = await validarSessaoNoRedis(contexto.redis, sessao.sessaoId, sessao.jogadorId);
        if (!sessaoValida) {
          enviarErroNoSocket(socket, 401, erroRejeitada('SESSAO_INVALIDA', 'sessão revogada ou inexistente'));
          return;
        }
      }

      const partida = await obterPartida(contexto.redis, partidaId);
      if (partida === null) {
        enviarErroNoSocket(socket, 404, erroRejeitada('PARTIDA_NAO_ENCONTRADA', `partida ${partidaId} não encontrada`));
        return;
      }

      if (partida.estado !== 'preparada') {
        enviarErroNoSocket(socket, 404, erroRejeitada('PARTIDA_NAO_ENCONTRADA', 'partida não está no estado preparada'));
        return;
      }

      const membro = partida.roster.find((m: MembroDaSala) => m.jogadorId === sessao.jogadorId);
      if (membro === undefined) {
        enviarErroNoSocket(socket, 403, erroRejeitada('JOGADOR_FORA_DO_ROSTER', 'jogador não faz parte do roster desta partida'));
        return;
      }

      await atualizarPresencaAtomica(contexto.redis, partidaId, sessao.jogadorId);

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.send(JSON.stringify({
          type: 'ADMISSAO_ACEITA',
          jogadorId: sessao.jogadorId,
          apelido: sessao.apelido,
          partidaId,
        } satisfies ServerMessage));

        const conexao: ConexaoDoJogador = {
          socket: ws,
          jogadorId: sessao.jogadorId,
          apelido: sessao.apelido,
          partidaId,
        };
        adicionarConexao(conexao);

        console.info('[ws] jogador admitido', {
          jogadorId: sessao.jogadorId,
          apelido: sessao.apelido,
          partidaId,
        });

        ws.on('error', (error) => {
          console.error('[ws] socket error:', error.message);
        });

        ws.on('message', (data) => {
          const reply = handleMessage(data);
          if (reply) {
            ws.send(JSON.stringify(reply));
          }
        });

        ws.on('close', () => {
          console.info('[ws] jogador desconectado', {
            jogadorId: sessao.jogadorId,
            partidaId,
          });
          removerConexao(conexao);
        });
      });
    })().catch((error) => {
      console.error('[ws] falha no fluxo de admissao:', (error as Error).message);
      enviarErroNoSocket(socket, 500, erroRejeitada('ERRO_INTERNO', 'falha interna no servidor'));
    });
  });

  return wss;
}
