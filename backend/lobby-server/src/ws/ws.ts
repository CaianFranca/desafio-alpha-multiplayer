import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { getConfig } from '@flicker/config';
import { origemPermitida, LimiteDeMensagensPorConexao, securityEvents, securityLogger as sharedSecurityLogger } from '@flicker/shared/server';
import type { ServerMessage } from '@flicker/shared';
import type { Logger } from 'pino';
import { NOME_ACCESS_COOKIE } from '../cookies.ts';
import { parseCookies } from '../middleware/cookie.ts';
import { verificarAccess } from '../jwt.ts';
import { obterSessao } from '../sessoes.ts';
import { ehSalaComando } from '../salas/handlers.ts';
import { tipoDeComandoDeDebug } from './debug-stream.ts';
import type { SalasContexto } from '../salas/index.ts';

let securityLogger: Logger = sharedSecurityLogger as unknown as Logger;

export function __setWsSecurityLoggerForTests(logger: Logger): void {
  securityLogger = logger;
}

export function __resetWsSecurityLogger(): void {
  securityLogger = sharedSecurityLogger as unknown as Logger;
}

export interface WsAuthData {
  jogadorId: string;
  sessaoId: string;
  apelido: string;
  email: string;
}

export type AuthenticatedWebSocket = WebSocket & { data: WsAuthData };

/** Endurecimento do WS (issue #409) — ver `getConfig()` para os defaults. */
export interface SegurancaWs {
  origensPermitidas: readonly string[];
  maxPayloadBytes: number;
  limiteMensagens: number;
  janelaLimiteMensagensMs: number;
}

/** Domínio reservado de bots (ver `routes/auth.ts`): conexões de bot não consomem o rate limit. */
const DOMINIO_BOT = '@bot.teste';

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
  /**
   * Endurecimento do WS (issue #409): allowlist de Origem, teto de payload e
   * rate limit geral por conexão. Quando ausente, deriva de `getConfig()`.
   */
  seguranca?: SegurancaWs;
  securityLogger?: Logger;
}

function segurancaDoConfig(): SegurancaWs {
  const config = getConfig();
  return {
    origensPermitidas: config.wsOrigensPermitidas,
    maxPayloadBytes: config.wsMaxPayloadBytes,
    limiteMensagens: config.wsLimiteMensagens,
    janelaLimiteMensagensMs: config.wsJanelaLimiteMensagensMs,
  };
}

function ehConexaoDeBot(socket: AuthenticatedWebSocket): boolean {
  return socket.data.email.endsWith(DOMINIO_BOT);
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
  const seguranca = deps.seguranca ?? segurancaDoConfig();
  const logger = deps.securityLogger ?? securityLogger;

  const wss = new WebSocketServer({
    server,
    maxPayload: seguranca.maxPayloadBytes,
    verifyClient: (info, callback) => {
      const origin = info.req.headers.origin;
      // Recusa no handshake, ANTES de qualquer leitura de sessão. Loga só a
      // origem — nunca cookie/token.
      if (!origemPermitida(origin, seguranca.origensPermitidas)) {
        const connectionId = randomUUID();
        const requestId = (info.req.headers['x-request-id'] as string | undefined) ?? connectionId;
        const ip = info.req.headers['x-forwarded-for'] as string | undefined
          ?? info.req.socket.remoteAddress ?? undefined;
        try {
          logger.warn({
            event: securityEvents.WS_HANDSHAKE_REJECTED,
            reason: 'origin_not_allowed',
            origin: origin ?? null,
            ip,
            connectionId,
            requestId,
          });
        } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
        // Evento estruturado já emitido acima (pino JSON); console.warn removido para não duplicar
        // Se precisar de visibilidade em dev, use DEBUG=* ou log do pino
        callback(false, 403, 'Forbidden');
        return;
      }
      callback(true);
    },
  });

  wss.on('connection', (socket, request) => {
    // Log de diagnóstico não-estruturado mantido apenas para correlação local (sem segredo)
    console.log(`[ws] upgrade: ${request.method} ${request.url} ${request.socket.remoteAddress}`);
    const connectionId = randomUUID();
    // WS upgrade não passa pelo middleware Express, então X-Request-Id raramente vem do cliente/proxy.
    // Usa connectionId como fallback para garantir correlação (spec exige id de requisição/conexão).
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? connectionId;
    // Guarda connectionId no socket para uso em logs posteriores (inclui disconnect).
    (socket as unknown as Record<string, unknown>).__connectionId = connectionId;
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
    // Rate limit geral por conexão (issue #409), aplicado a partir da autenticação:
    // mensagens pré-auth bufferizadas não consomem cota antes do aceite, mas contam
    // ao serem drenadas. Bots (@bot.teste) são isentos.
    const limiteDeMensagens = new LimiteDeMensagensPorConexao(
      seguranca.limiteMensagens,
      seguranca.janelaLimiteMensagensMs,
    );
    let encerradoPorRateLimit = false;

    const processarMensagem = (data: RawData): void => {
      if (!ehConexaoDeBot(authSocket) && !limiteDeMensagens.registrar()) {
        if (!encerradoPorRateLimit) {
          encerradoPorRateLimit = true;
          try {
            logger.warn({
              event: securityEvents.WS_RATE_LIMIT_EXCEEDED,
              connectionId,
              requestId,
              ip: request.socket.remoteAddress ?? undefined,
              jogadorId: (authSocket as unknown as { data?: WsAuthData }).data?.jogadorId,
            });
          } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
          socket.close(1008, 'RATE_LIMIT');
        }
        return;
      }
      void handleMessage(data, authSocket, contextoSalas, logger, connectionId, requestId);
    };

    socket.on('error', (error) => {
      console.error('[ws] error:', error.message);
    });

    socket.on('message', (data) => {
      if (autenticado) {
        processarMensagem(data);
      } else if (mensagensAguardandoAuth.length < LIMITE_BUFFER_PRE_AUTH) {
        mensagensAguardandoAuth.push(data);
      }
      // Fora do limite: descarta silenciosamente (anti-DoS por cliente
      // malicioso que envia milhares de mensagens pré-autenticação).
    });

    socket.on('close', (code: number) => {
      if (code === 1009) {
        try {
          logger.warn({
            event: securityEvents.WS_PAYLOAD_TOO_LARGE,
            connectionId,
            requestId,
            ip: request.socket.remoteAddress ?? undefined,
          });
        } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      }
      // Limpa marca de correlação para GC
      try { delete (socket as unknown as Record<string, unknown>).__connectionId; } catch {}
      console.log('[ws] disconnect');
      // Stream de debug (issue #340): desconexão encerra o registro do
      // cliente de debug antes do fechamento das Salas.
      contextoSalas?.debug?.desconectar(authSocket);
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

        // Reconexão automática (issue #38): se o Jogador tem vínculo em
        // `em_reconexao`, reentra automaticamente na Sala com janela de 60s.
        if (contextoSalas !== undefined) {
          try {
            await contextoSalas.handlers.tratarReconexaoSeNecessario(authSocket);
          } catch (erro) {
            console.error('[ws] falha na reconexao automatica:', erro);
          }
        }

        // Drena o buffer de mensagens que chegaram antes da autenticação.
        for (const data of mensagensAguardandoAuth.splice(0)) {
          processarMensagem(data);
        }
      } catch {
        try {
          socket.close(1011, 'Internal error');
        } catch {
          try {
            socket.terminate();
          } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
        }
      }
    })().catch(() => {
      try {
        socket.terminate();
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
    });
  });

  return wss;
}

async function handleMessage(
  data: RawData,
  socket: AuthenticatedWebSocket,
  contextoSalas: SalasContexto | undefined,
  loggerParam?: Logger,
  connectionId?: string,
  requestId?: string,
): Promise<void> {
  const secLogger = loggerParam ?? securityLogger;
  // Parseia uma única vez; o despacho abaixo decide entre Salas e
  // PING/PONG sem custo extra de reparseamento.
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    try {
      secLogger.warn({
        event: securityEvents.WS_MESSAGE_REJECTED,
        reason: 'invalid_json',
        connectionId,
        requestId,
        jogadorId: (socket as unknown as { data?: WsAuthData }).data?.jogadorId,
      });
    } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
    return;
  }

  // Controle do stream de debug (issue #340): interceptado ANTES do despacho —
  // os handlers recusariam como DADOS_INVALIDOS (o switch não conhece as
  // variantes ATIVAR_DEBUG/DESATIVAR_DEBUG).
  const tipoDeDebug = tipoDeComandoDeDebug(parsed);
  if (tipoDeDebug !== null) {
    void contextoSalas?.debug?.receberComando(socket, tipoDeDebug);
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
    } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
    return;
  }

  // Mensagem fora do contrato (não é sala nem debug nem PING) — rejeição estruturada.
  // Evita logar payload cru — só razão e ids.
  try {
    secLogger.warn({
      event: securityEvents.WS_MESSAGE_REJECTED,
      reason: 'invalid_command',
      connectionId,
      requestId,
      jogadorId: (socket as unknown as { data?: WsAuthData }).data?.jogadorId,
    });
  } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
}

function isPingMessage(value: unknown): boolean {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'PING'
  );
}
