// Servidor WebSocket do game-server (issues #46 e #117).
//
// Assinatura: `criarWebSocketServer(server, contexto, deps?)`. Todo upgrade
// passa pelo fluxo de admissão (issue #46) em `/ws/game/<serverId>` com
// `?partida-id=&token=`: o token de sessão (JWT → `jogadorId` + `apelido`) é
// validado junto ao Redis, a partida precisa existir no estado `preparada` e
// o `jogadorId` precisa constar no roster. Só então o upgrade é aceito com
// `ADMISSAO_ACEITA`; rejeições chegam como resposta HTTP com
// `ADMISSAO_REJEITADA` (400/401/403/404/500). O `jogadorId` é sempre o do
// JWT — o cliente não se autodeclara.
//
// Com `deps.partida` (issue #117), o socket admitido entra no canal da
// partida: registra no `PartidaBroadcaster`, recebe o turno corrente via
// `anunciarTurnoAtual` e roteia as mensagens ao `PartidaHandlers` — a guarda
// do contrato wire é dele, e mensagens fora do contrato são respondidas ao
// originador com ERRO_DO_TABULEIRO DADOS_INVALIDOS. Como a admissão é toda
// pré-upgrade, não há comando a bufferizar: quando os listeners anexam, a
// partida já está validada. PING/PONG responde sempre. Sem `deps`, o servidor
// opera apenas em PING/PONG.
//
// Substituição de Conexão duplicada (issue #155): uma nova admissão do mesmo
// Jogador na mesma Partida registra-se ANTES da transição de presença e só
// então encerra a conexão anterior com `4409 CONEXAO_SUBSTITUIDA` — nunca há
// janela sem conexão vigente, e um `close` do socket antigo durante a
// transição não é tratado como desconexão real. O `close` da conexão
// substituída NÃO marca `em_reconexao`: a presença do Jogador permanece
// `conectado` porque o registro já aponta para a nova conexão (checagem de
// vigência em `removerConexao`).

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { getConfig } from '@flicker/config';
import { origemPermitida, LimiteDeMensagensPorConexao, securityEvents, securityLogger as sharedSecurityLogger, primeiroValor } from '@flicker/shared/server';
import type { Logger } from 'pino';
import type {
  ServerMessage,
  PartidaId,
  ServerId,
  CodigoDeErroDeAdmissao,
  AdmissaoRejeitadaEvento,
} from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import { marcarDesconexao, obterPartida, transicionarSeCompletoOuAtualizarPresenca, type ResultadoTransicaoDePresenca } from '../partidas/partidas.ts';
import { verificarNaoInicioAposDesconexao } from '../partidas/nao-inicio.ts';
import {
  agendarExpiracaoDeReconexao,
  cancelarExpiracaoDeReconexao,
  definirJanelaDeReconexao,
  limparJanelaDeReconexao,
} from '../partidas/reconexao-em-andamento.ts';
import { obterEstadoDaPartida } from '../partidas/estado.ts';
import { paraSnapshotWire } from '../partidas/snapshot.ts';
import { validarTokenDeSessao, validarSessaoNoRedis } from '../auth.ts';
import { adicionarConexao, obterConexoes, removerConexao, type ConexaoDoJogador } from './conexao.ts';
import { tipoDeComandoDeDebug } from './debug-stream.ts';
import { PartidaBroadcaster } from '../partidas/broadcast.ts';
import { PartidaHandlers } from '../partidas/handlers.ts';

const WS_PATH_RE = /^\/ws\/game\/([^/]+)$/;

/** Endurecimento do WS (issue #409) — ver `getConfig()` para os defaults. */
type SegurancaWs = NonNullable<ContextoDoGameServer['wsSeguranca']>;

/** Fallback dos testes/instâncias sem `contexto.wsSeguranca` explícito. */
function segurancaDoConfig(): SegurancaWs {
  const config = getConfig();
  return {
    origensPermitidas: config.wsOrigensPermitidas,
    maxPayloadBytes: config.wsMaxPayloadBytes,
    limiteMensagens: config.wsLimiteMensagens,
    janelaLimiteMensagensMs: config.wsJanelaLimiteMensagensMs,
  };
}

// Só o que o `ws.ts` consome do canal de Partida: o `PartidaHandlers` já
// carrega a própria referência ao Redis. Deixar `redis` aqui seria peso morto.

const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,128}$/;

function sanitizarRequestId(valor: string | string[] | undefined): string | null {
  const raw = primeiroValor(valor);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!REQUEST_ID_RE.test(trimmed)) return null;
  return trimmed;
}

function extrairIpParaLog(req: IncomingMessage): string | undefined {
  const raw = primeiroValor(req.headers['x-forwarded-for'] as string | string[] | undefined);
  const trustHops = getConfig().trustProxyHops;
  if (trustHops > 0 && typeof raw === 'string' && raw.trim().length > 0) {
    const partes = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const idx = partes.length - trustHops;
    if (idx >= 0 && idx < partes.length) {
      return partes[idx] || (req.socket.remoteAddress ?? undefined);
    }
  }
  return req.socket.remoteAddress ?? undefined;
}
export interface PartidaWsDeps {
  readonly broadcaster: PartidaBroadcaster;
  readonly handlers: PartidaHandlers;
  /** Stream de debug (issue #340). Opcional: sem o campo, comandos de controle são ignorados. */
  readonly debug?: import('./debug-stream.ts').DebugStreamDaPartida;
}

let securityLogger: Logger = sharedSecurityLogger as unknown as Logger;

export function __setGameWsSecurityLoggerForTests(logger: Logger): void {
  securityLogger = logger;
}

export function __resetGameWsSecurityLogger(): void {
  securityLogger = sharedSecurityLogger as unknown as Logger;
}

export interface WebSocketServerDeps {
  readonly partida?: PartidaWsDeps;
  readonly securityLogger?: Logger;
}

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

/**
 * Limpeza do registro de conexões quando a admissão falha — tanto no caminho
 * de transição inválida (`transicao === null`) quanto no de exceção (ex.:
 * Redis fora, review da PR #181). Remove a conexão nova do registro (o
 * listener de `close` só é anexado no caminho de sucesso, então sem esta
 * remoção a entrada ficaria órfã apontando para o socket falhado), restaura a
 * conexão anterior como vigente quando ela ainda está aberta — preservando a
 * presença `conectado` — e, sem anterior aberta, marca `em_reconexao` (não há
 * conexão viva). A invariante "registro espelha a conexão vigente" precisa
 * valer nos dois caminhos: reconexão/durabilidade e a tela da partida (#156)
 * vão consumi-la.
 */
function limparAdmissaoFalha(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
  conexao: ConexaoDoJogador,
  conexaoAnterior: ConexaoDoJogador | null,
  broadcaster?: PartidaBroadcaster,
): void {
  const eraVigente = removerConexao(conexao);
  if (conexaoAnterior !== null && conexaoAnterior.socket.readyState === conexaoAnterior.socket.OPEN) {
    adicionarConexao(conexaoAnterior);
  } else if (eraVigente) {
    marcarDesconexaoEArmarJanela(redis, partidaId, jogadorId, undefined, broadcaster);
  }
}

/**
 * Janela de reconexão da Partida em andamento (issue #295): após marcar
 * `em_reconexao`, só a Partida `em_andamento` ganha janela TTL + timer que
 * converte em desistência; a `preparada` segue só com o não-início. Na
 * entrada armada, anuncia `JOGADOR_EM_RECONEXAO` aos restantes (seam de
 * presença da spec #292 história 2, consumido pela #294). Retorna se armou.
 */
export async function armarJanelaSeEmAndamento(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
  broadcaster?: PartidaBroadcaster,
): Promise<boolean> {
  try {
    const partida = await obterPartida(redis, partidaId);
    if (partida === null || partida.estado !== 'em_andamento') {
      return false;
    }
    await definirJanelaDeReconexao(redis, partidaId, jogadorId);
    agendarExpiracaoDeReconexao(partidaId, jogadorId, undefined, redis);
    broadcaster?.enviar(partidaId, { type: 'JOGADOR_EM_RECONEXAO', jogadorId });
    return true;
  } catch (err: unknown) {
    console.error('[ws] falha ao armar janela de reconexão:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Volta dentro da janela (issue #295): anuncia `JOGADOR_RECONECTADO` aos
 * restantes só na re-admissão efetiva em `em_andamento`
 * (`mudou && !iniciou`) — as N admissões iniciais que viram `em_andamento`
 * anunciam `PARTIDA_INICIADA` em vez disto, e a `preparada` nunca emite.
 * Retorna se anunciou.
 */
export function anunciarVoltaSeReadmissao(
  broadcaster: PartidaBroadcaster | undefined,
  partidaId: PartidaId,
  jogadorId: string,
  // Só a guarda interessa (`estado/mudou/iniciou` de
  // ResultadoTransicaoDePresenca) — o resto da transição não decide o anúncio.
  transicao: Pick<ResultadoTransicaoDePresenca, 'estado' | 'mudou' | 'iniciou'>,
): boolean {
  if (broadcaster === undefined) {
    return false;
  }
  if (transicao.estado !== 'em_andamento' || !transicao.mudou || transicao.iniciou) {
    return false;
  }
  broadcaster.enviar(partidaId, { type: 'JOGADOR_RECONECTADO', jogadorId });
  return true;
}

/**
 * Helper de desconexão (issue #295): marca `em_reconexao` e arma a janela de
 * reconexão da Partida em andamento. O `close` real passa o
 * `verificarNaoInicioAposDesconexao` como etapa intermediária (a `preparada`
 * segue só com o não-início); a limpeza de admissão falha não tem etapa extra.
 * Fire-and-forget com log único — a ordem marcar → extra → armar é preservada.
 */
function marcarDesconexaoEArmarJanela(
  redis: Redis,
  partidaId: PartidaId,
  jogadorId: string,
  etapaIntermediaria?: (redis: Redis, partidaId: PartidaId) => Promise<unknown>,
  broadcaster?: PartidaBroadcaster,
): void {
  void marcarDesconexao(redis, partidaId, jogadorId)
    .then(() => etapaIntermediaria?.(redis, partidaId))
    .then(() => armarJanelaSeEmAndamento(redis, partidaId, jogadorId, broadcaster))
    .catch((err: unknown) => console.error('[ws] falha ao marcar desconexão:', err instanceof Error ? err.message : String(err)));
}

export function criarWebSocketServer(
  server: Server,
  contexto: ContextoDoGameServer,
  deps?: WebSocketServerDeps,
): WebSocketServer {
  const seguranca = contexto.wsSeguranca ?? segurancaDoConfig();
  const wss = new WebSocketServer({ noServer: true, maxPayload: seguranca.maxPayloadBytes });
  // Nome distinto de `partida` (a PartidaPreparada buscada no Redis dentro do
  // fluxo de admissão) para evitar shadowing: `depsPartida` são as deps do
  // canal de Partida, `partida` é a partida persistida.
  const depsPartida = deps?.partida;
  const logger = deps?.securityLogger ?? securityLogger;

  server.on('upgrade', (request, socket, head) => {
    const connectionId = randomUUID();
    const requestId = sanitizarRequestId(request.headers['x-request-id'] as string | string[] | undefined) ?? connectionId;
    // Endurecimento do WS (issue #409): recusa por Origem ANTES de qualquer
    // validação de token/partida — o 403 (e não o 401 de sessão) prova a
    // precedência. Origem ausente (bot/serviço) é aceita. Nunca loga
    // token/cookie: só a origem.
    if (!origemPermitida(request.headers.origin, seguranca.origensPermitidas)) {
      try {
        logger.warn({
          event: securityEvents.WS_HANDSHAKE_REJECTED,
          reason: 'origin_not_allowed',
          origin: request.headers.origin ?? null,
          ip: extrairIpParaLog(request),
          connectionId,
          requestId,
        });
      } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
      // Evento estruturado já emitido (pino JSON); console.warn removido para não duplicar
      enviarErroNoSocket(socket, 403, erroRejeitada('ORIGEM_NAO_PERMITIDA', 'origem não permitida'));
      return;
    }

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

    void (async () => {
      // Bots autenticados por Service Token não dependem de sessão no Redis
      if (!sessao.isBot) {
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

      if (partida.estado !== 'preparada' && partida.estado !== 'em_andamento') {
        enviarErroNoSocket(socket, 404, erroRejeitada('PARTIDA_NAO_ENCONTRADA', 'partida não está no estado preparada'));
        return;
      }

      const membro = partida.roster.find((m) => m.jogadorId === sessao.jogadorId);
      if (membro === undefined) {
        enviarErroNoSocket(socket, 403, erroRejeitada('JOGADOR_FORA_DO_ROSTER', 'jogador não faz parte do roster desta partida'));
        return;
      }

      // Desistência (issue #290): quem desistiu saiu do engine (jogadores N−1)
      // mas segue no roster do Redis (o aviso de Retorno usa o roster
      // pré-desistência). Sem esta guarda o desistente readmitia e reassistia
      // como espectador. Estado ausente = preparada sem engine: ninguém
      // desistiu ainda, mantém o fluxo.
      const estadoAtual = await obterEstadoDaPartida(contexto.redis, partidaId);
      if (estadoAtual !== null && !estadoAtual.jogadores.some((j) => j.jogadorId === sessao.jogadorId)) {
        enviarErroNoSocket(socket, 403, erroRejeitada('JOGADOR_NAO_NA_PARTIDA', 'jogador desistiu ou não está na partida'));
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        // Referências fora da IIFE: o `catch` externo precisa delas para
        // aplicar a mesma limpeza do caminho de falha quando algo lançar
        // durante a admissão (ex.: Redis fora) — review da PR #181.
        let conexaoRegistrada: ConexaoDoJogador | null = null;
        let conexaoAnterior: ConexaoDoJogador | null = null;
        // Rate limit geral por conexão (issue #409): o handler de 'message'
        // só é anexado no fim da admissão, então só mensagens pós-admissão
        // contam. Bots (`sessao.isBot`) são isentos. Flag evita fechar
        // repetidamente quando a rajada continua chegando após o close.
        const limiteDeMensagens = new LimiteDeMensagensPorConexao(
          seguranca.limiteMensagens,
          seguranca.janelaLimiteMensagensMs,
        );
        let encerradoPorRateLimit = false;
        void (async () => {
          const conexao: ConexaoDoJogador = {
            socket: ws,
            jogadorId: sessao.jogadorId,
            apelido: sessao.apelido,
            partidaId,
          };
          // Substituição (#155): a nova conexão entra no registro ANTES da
          // transição de presença e de a antiga ser encerrada —
          // `adicionarConexao` devolve a anterior, que deixa de ser a vigente
          // neste instante. Registrar antes da transição fecha a janela em que
          // um `close` do socket antigo (queda de rede simultânea à nova
          // admissão) seria tratado como desconexão real e sobrescreveria a
          // presença recém-gravada com `em_reconexao`: durante o `await` da
          // transição, o antigo já não é vigente e o `close` dele pula
          // `marcarDesconexao`.
          conexaoAnterior = adicionarConexao(conexao);
          conexaoRegistrada = conexao;

          const transicao = await transicionarSeCompletoOuAtualizarPresenca(
            contexto.redis,
            partidaId,
            sessao.jogadorId,
          );

          if (transicao === null || (transicao.estado !== 'preparada' && transicao.estado !== 'em_andamento')) {
            limparAdmissaoFalha(contexto.redis, partidaId, sessao.jogadorId, conexao, conexaoAnterior, depsPartida?.broadcaster);
            try {
              ws.send(erroRejeitada('ERRO_INTERNO', 'estado da partida inconsistente'));
            } catch (e) { console.error('[ws] falha ao enviar erro interno:', e); }
            ws.close(1011, 'ERRO_INTERNO');
            return;
          }

          // Re-admissão dentro da janela (#295): só em `em_andamento` a volta
          // limpa a janela e cancela a conversão; a `preparada` nunca tem
          // janela (não-início intacto). A volta efetiva (presença
          // restaurada, fora da virada inicial) é anunciada aos restantes
          // com `JOGADOR_RECONECTADO` (seam da #294).
          if (transicao.estado === 'em_andamento') {
            cancelarExpiracaoDeReconexao(partidaId, sessao.jogadorId);
            void limparJanelaDeReconexao(contexto.redis, partidaId, sessao.jogadorId).catch((err: unknown) =>
              console.error('[ws] falha ao limpar janela de reconexão:', err instanceof Error ? err.message : String(err)),
            );
            anunciarVoltaSeReadmissao(depsPartida?.broadcaster, partidaId, sessao.jogadorId, transicao);
          }

          ws.send(JSON.stringify({
            type: 'ADMISSAO_ACEITA',
            jogadorId: sessao.jogadorId,
            apelido: sessao.apelido,
            partidaId,
            estado: transicao.estado,
          } satisfies ServerMessage));

          // Admissão concluída após upgrade: transição atômica dentro do
          // callback garante que a partida só inicie com N sockets vivos
          // (ST-14, N=2..4). Ordem: ADMISSAO_ACEITA (já enviada) → PARTIDA_INICIADA
          // broadcast (se N-ésima admissão) → ESTADO_DA_PARTIDA unicast →
          // anunciarTurnoAtual (TURNO_INICIADO). Snapshot e turno são unicast
          // ao socket admitido; PARTIDA_INICIADA é broadcast a todos da partida
          // e garantido mesmo se o snapshot falhar.
          if (depsPartida !== undefined) {
            depsPartida.broadcaster.registrar(partidaId, ws);
            void (async () => {
              if (transicao.iniciou) {
                depsPartida.broadcaster.enviar(partidaId, {
                  type: 'PARTIDA_INICIADA',
                  partidaId,
                  // Marco autoritativo do início (issue #259): a transição o
                  // grava atomicamente e devolve o valor persistido; NÃO usar
                  // relógio local aqui (review PR #374) — o snapshot abaixo
                  // projeta a MESMA fonte, então evento e foto nunca divergem.
                  iniciadaEm: transicao.iniciadaEm,
                });
              }
              try {
                // Snapshot atômico da Reconexão (issue #388): tabuleiro + chat
                // do mesmo instante intra-processo via cadeia serial da
                // Partida — a rajada de bot nunca intercala entre o GET do
                // estado e o LRANGE do chat (mononodo; 2 instâncias quebram).
                // Entregue em único ESTADO_DA_PARTIDA, sem replay separado.
                const atomico = await depsPartida.handlers.lerSnapshotAtomico(partidaId);
                if (atomico !== null) {
                  const snapshot = paraSnapshotWire(
                    atomico.estado,
                    atomico.partida.roster,
                    transicao.estado,
                    transicao.iniciadaEm,
                    atomico.historico,
                  );
                  depsPartida.broadcaster.enviarParaSocket(ws, {
                    type: 'ESTADO_DA_PARTIDA',
                    snapshot,
                  });
                } else {
                  // Diagnóstico best-effort só para o log (o snapshot já
                  // falhou): distingue `estado-nulo` de `partida-nula`.
                  let temEstado: boolean | null = null;
                  let temPartida: boolean | null = null;
                  let motivo: 'estado-nulo' | 'partida-nula' | 'diagnostico-falhou' = 'diagnostico-falhou';
                  try {
                    temEstado = (await obterEstadoDaPartida(contexto.redis, partidaId)) !== null;
                    if (!temEstado) {
                      motivo = 'estado-nulo';
                    } else {
                      temPartida = (await obterPartida(contexto.redis, partidaId)) !== null;
                      motivo = 'partida-nula';
                    }
                  } catch {
                    // Redis fora no diagnóstico: mantém nulls + falha.
                  }
                  console.error('[ws] estado indisponível para snapshot', {
                    partidaId,
                    temEstado,
                    temPartida,
                    motivo,
                  });
                  depsPartida.broadcaster.enviarParaSocket(ws, {
                    type: 'ERRO_DO_TABULEIRO',
                    codigo: 'ESTADO_INDISPONIVEL',
                    mensagem: 'Estado da partida indisponível para snapshot.',
                  });
                }
              } catch (erro: unknown) {
                console.error('[ws] falha ao enviar snapshot da partida:', {
                  partidaId,
                  temEstado: null,
                  temPartida: null,
                  motivo: 'excecao',
                  erro: erro instanceof Error ? erro.message : String(erro),
                });
                depsPartida.broadcaster.enviarParaSocket(ws, {
                  type: 'ERRO_DO_TABULEIRO',
                  codigo: 'ESTADO_INDISPONIVEL',
                  mensagem: 'Estado da partida indisponível para snapshot.',
                });
              }
              await depsPartida.handlers.anunciarTurnoAtual(partidaId, ws);
            })();
          }

          // Fechamento da conexão substituída (#155): acontece depois do
          // ADMISSAO_ACEITA da nova (já enviado) e depois do registro dela no
          // broadcaster — a antiga já saiu do registro, então seu `close`
          // não marca `em_reconexao` (ver handler de `close` abaixo).
          if (conexaoAnterior !== null) {
            console.info('[ws] conexão substituída', {
              jogadorId: sessao.jogadorId,
              partidaId,
            });
            try {
              conexaoAnterior.socket.close(4409, 'CONEXAO_SUBSTITUIDA');
            } catch {
              // Socket antigo já fechando ou fechado: nada a fazer.
            }
          }

          console.info('[ws] jogador admitido', {
            jogadorId: sessao.jogadorId,
            apelido: sessao.apelido,
            partidaId,
          });

          ws.on('error', (error) => {
            console.error('[ws] socket error:', error.message);
          });

          ws.on('message', (data: RawData) => {
            // Rate limit geral (issue #409): no topo, antes do parse/despacho.
            // Bots são isentos; o teto de payload é do próprio `ws` (1009).
            if (!sessao.isBot && !limiteDeMensagens.registrar()) {
              if (!encerradoPorRateLimit) {
                encerradoPorRateLimit = true;
                try {
                  logger.warn({
                    event: securityEvents.WS_RATE_LIMIT_EXCEEDED,
                    partidaId,
                    jogadorId: sessao.jogadorId,
                    connectionId,
                    requestId,
                    ip: extrairIpParaLog(request),
                  });
                } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
                ws.close(1008, 'RATE_LIMIT');
              }
              return;
            }

            const parsed = parsearMensagem(data);
            if (parsed === null) {
              try {
                logger.warn({
                  event: securityEvents.WS_MESSAGE_REJECTED,
                  reason: 'invalid_json',
                  partidaId,
                  jogadorId: sessao.jogadorId,
                  connectionId,
                  requestId,
                  ip: extrairIpParaLog(request),
                });
              } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
              return;
            }

            // PING/PONG responde sempre, mesmo com o canal de partida ativo.
            if (isPing(parsed)) {
              ws.send(JSON.stringify({ type: 'PONG' } satisfies ServerMessage));
              return;
            }

            // Controle do stream de debug (issue #340): interceptado ANTES de
            // `aplicarMensagem` — a guarda do contrato os recusaria como
            // DADOS_INVALIDOS (o conjunto fechado de `wire.ts` não os conhece).
            const tipoDeDebug = tipoDeComandoDeDebug(parsed);
            if (tipoDeDebug !== null) {
              depsPartida?.debug?.receberComando(ws, partidaId, tipoDeDebug);
              return;
            }

            if (depsPartida === undefined) {
              return;
            }

            // Comandos fora do contrato (guard em `handlers.ts`) também seguem
            // para o handler: ele responde ERRO_DO_TABULEIRO DADOS_INVALIDOS ao
            // originador — descartar aqui quebraria o contrato fechado do wire
            // (issue #117) e o teste de guarda de peões.
            // O ator do dispatch é a sessão autenticada (`sessao.jogadorId`),
            // nunca o `jogadorId` autodeclarado no wire: o handler injeta a
            // sessão como ator (#155) mesmo quando o `jogadorId` do wire
            // diverge — o campo segue obrigatório só pela guarda de forma.
            // Issue #411: propaga connectionId/requestId para correlação nos logs.
            void depsPartida.handlers.aplicarMensagem(ws, partidaId, sessao.jogadorId, parsed, { connectionId, requestId });
          });

          ws.on('close', (code: number) => {
            if (code === 1009) {
              try {
                logger.warn({
                  event: securityEvents.WS_PAYLOAD_TOO_LARGE,
                  partidaId,
                  jogadorId: sessao.jogadorId,
                  connectionId,
                  requestId,
                  ip: extrairIpParaLog(request),
                });
              } catch (e) { console.error('[securityLogger] falha ao emitir evento:', e); }
            }
            console.info('[ws] jogador desconectado', {
              jogadorId: sessao.jogadorId,
              partidaId,
            });
            // Stream de debug (issue #340): desconexão encerra o registro do
            // cliente de debug.
            depsPartida?.debug?.desconectar(ws);
            // Só marca `em_reconexao` quando a conexão fechada era a vigente do
            // Jogador: no fechamento por substituição (#155) a vigente já é a
            // nova conexão, e a presença permanece `conectado`.
            const eraVigente = removerConexao(conexao);
            if (depsPartida !== undefined) {
              depsPartida.broadcaster.remover(ws);
              // Chat de Partida (issue #390): sem conexões vigentes na
              // Partida, a entrada do rate-limit fica sem dono — libera.
              if (obterConexoes(partidaId).size === 0) {
                depsPartida.handlers.liberarLimiteDeChat(partidaId);
              }
            }
            if (!eraVigente) {
              return;
            }
            marcarDesconexaoEArmarJanela(contexto.redis, partidaId, sessao.jogadorId, (r, p) =>
              verificarNaoInicioAposDesconexao(r, p),
              depsPartida?.broadcaster,
            );
          });
        })().catch((error: unknown) => {
          console.error('[ws] falha na transição pós-upgrade:', error instanceof Error ? error.message : String(error));
          // Exceção durante a admissão (ex.: Redis fora): a mesma limpeza do
          // caminho de falha — sem ela, o socket novo ficaria registrado como
          // vigente (morto) e a conexão antiga desregistrada (review #181).
          if (conexaoRegistrada !== null) {
            limparAdmissaoFalha(contexto.redis, partidaId, sessao.jogadorId, conexaoRegistrada, conexaoAnterior, depsPartida?.broadcaster);
          }
          try {
            ws.send(erroRejeitada('ERRO_INTERNO', 'falha na admissão da partida'));
          } catch (e) { console.error('[ws] falha ao enviar erro interno na admissão:', e); }
          try { ws.close(1011, 'ERRO_INTERNO'); } catch (e) { console.error('[ws] falha ao fechar socket na admissão:', e); }
        });
      });
    })().catch((error: unknown) => {
      console.error('[ws] falha no fluxo de admissao:', error instanceof Error ? error.message : String(error));
      enviarErroNoSocket(socket, 500, erroRejeitada('ERRO_INTERNO', 'falha interna no servidor'));
    });
  });

  return wss;
}
