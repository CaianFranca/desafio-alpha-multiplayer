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
// Jogador na mesma Partida registra-se e só então encerra a conexão anterior
// com `4409 CONEXAO_SUBSTITUIDA` — nunca há janela sem conexão vigente. O
// `close` da conexão substituída NÃO marca `em_reconexao`: a presença do
// Jogador permanece `conectado` porque o registro já aponta para a nova
// conexão (checagem de vigência em `removerConexao`).

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type {
  ServerMessage,
  PartidaId,
  ServerId,
  CodigoDeErroDeAdmissao,
  AdmissaoRejeitadaEvento,
} from '@flicker/shared';
import type { ContextoDoGameServer } from '../contexto.ts';
import { marcarDesconexao, obterPartida, transicionarSeCompletoOuAtualizarPresenca } from '../partidas/partidas.ts';
import { obterEstadoDaPartida } from '../partidas/estado.ts';
import { paraSnapshotWire } from '../partidas/snapshot.ts';
import { validarTokenDeSessao, validarSessaoNoRedis } from '../auth.ts';
import { adicionarConexao, removerConexao, type ConexaoDoJogador } from './conexao.ts';
import { PartidaBroadcaster } from '../partidas/broadcast.ts';
import { PartidaHandlers } from '../partidas/handlers.ts';

const WS_PATH_RE = /^\/ws\/game\/([^/]+)$/;

// Só o que o `ws.ts` consome do canal de Partida: o `PartidaHandlers` já
// carrega a própria referência ao Redis. Deixar `redis` aqui seria peso morto.
export interface PartidaWsDeps {
  readonly broadcaster: PartidaBroadcaster;
  readonly handlers: PartidaHandlers;
}

export interface WebSocketServerDeps {
  readonly partida?: PartidaWsDeps;
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

export function criarWebSocketServer(
  server: Server,
  contexto: ContextoDoGameServer,
  deps?: WebSocketServerDeps,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  // Nome distinto de `partida` (a PartidaPreparada buscada no Redis dentro do
  // fluxo de admissão) para evitar shadowing: `depsPartida` são as deps do
  // canal de Partida, `partida` é a partida persistida.
  const depsPartida = deps?.partida;

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

    void (async () => {
      const sessaoValida = await validarSessaoNoRedis(contexto.redis, sessao.sessaoId, sessao.jogadorId);
      if (!sessaoValida) {
        enviarErroNoSocket(socket, 401, erroRejeitada('SESSAO_INVALIDA', 'sessão revogada ou inexistente'));
        return;
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

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        void (async () => {
          const transicao = await transicionarSeCompletoOuAtualizarPresenca(
            contexto.redis,
            partidaId,
            sessao.jogadorId,
          );

          if (transicao === null || (transicao.estado !== 'preparada' && transicao.estado !== 'em_andamento')) {
            try {
              ws.send(erroRejeitada('ERRO_INTERNO', 'estado da partida inconsistente'));
            } catch {}
            ws.close(1011, 'ERRO_INTERNO');
            return;
          }

          ws.send(JSON.stringify({
            type: 'ADMISSAO_ACEITA',
            jogadorId: sessao.jogadorId,
            apelido: sessao.apelido,
            partidaId,
            estado: transicao.estado,
          } satisfies ServerMessage));

          const conexao: ConexaoDoJogador = {
            socket: ws,
            jogadorId: sessao.jogadorId,
            apelido: sessao.apelido,
            partidaId,
          };
          // Substituição (#155): a nova conexão entra no registro ANTES de a
          // antiga ser encerrada — `adicionarConexao` devolve a anterior, que
          // deixa de ser a vigente neste instante.
          const conexaoAnterior = adicionarConexao(conexao);

          // Admissão concluída após upgrade: transição atômica dentro do
          // callback garante que a partida só inicie com 4 sockets vivos
          // (ST-14). Ordem: ADMISSAO_ACEITA (já enviada) → PARTIDA_INICIADA
          // broadcast (se 4ª admissão) → ESTADO_DA_PARTIDA unicast →
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
                });
              }
              try {
                const [estadoEngine, partidaAtual] = await Promise.all([
                  obterEstadoDaPartida(contexto.redis, partidaId),
                  obterPartida(contexto.redis, partidaId),
                ]);
                if (estadoEngine !== null && partidaAtual !== null) {
                  const snapshot = paraSnapshotWire(
                    estadoEngine,
                    partidaAtual.roster,
                    transicao.estado,
                  );
                  depsPartida.broadcaster.enviarParaSocket(ws, {
                    type: 'ESTADO_DA_PARTIDA',
                    snapshot,
                  });
                } else {
                  console.error('[ws] estado indisponível para snapshot', {
                    partidaId,
                    temEstado: estadoEngine !== null,
                    temPartida: partidaAtual !== null,
                  });
                  depsPartida.broadcaster.enviarParaSocket(ws, {
                    type: 'ERRO_DO_TABULEIRO',
                    codigo: 'ESTADO_INDISPONIVEL',
                    mensagem: 'Estado da partida indisponível para snapshot.',
                  });
                }
              } catch (erro) {
                console.error('[ws] falha ao enviar snapshot da partida:', (erro as Error).message);
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
          const parsed = parsearMensagem(data);
          if (parsed === null) {
            return;
          }

          // PING/PONG responde sempre, mesmo com o canal de partida ativo.
          if (isPing(parsed)) {
            ws.send(JSON.stringify({ type: 'PONG' } satisfies ServerMessage));
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
          void depsPartida.handlers.aplicarMensagem(ws, partidaId, sessao.jogadorId, parsed);
        });

        ws.on('close', () => {
          console.info('[ws] jogador desconectado', {
            jogadorId: sessao.jogadorId,
            partidaId,
          });
          // Só marca `em_reconexao` quando a conexão fechada era a vigente do
          // Jogador: no fechamento por substituição (#155) a vigente já é a
          // nova conexão, e a presença permanece `conectado`.
          const eraVigente = removerConexao(conexao);
          if (depsPartida !== undefined) {
            depsPartida.broadcaster.remover(ws);
          }
          if (!eraVigente) {
            return;
          }
          void marcarDesconexao(contexto.redis, partidaId, sessao.jogadorId).catch((err) =>
            console.error('[ws] falha ao marcar desconexão:', (err as Error).message),
          );
        });
        })().catch((error) => {
          console.error('[ws] falha na transição pós-upgrade:', (error as Error).message);
          try { ws.close(1011, 'ERRO_INTERNO'); } catch {}
        });
      });
    })().catch((error) => {
      console.error('[ws] falha no fluxo de admissao:', (error as Error).message);
      enviarErroNoSocket(socket, 500, erroRejeitada('ERRO_INTERNO', 'falha interna no servidor'));
    });
  });

  return wss;
}
