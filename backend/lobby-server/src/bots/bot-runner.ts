// BotRunner — instancia um bot efêmero in-process no lobby-server.
//
// Fluxo:
//   1. Registra conta efêmera via POST /api/auth/register (mesmo caminho do script).
//   2. Abre WS de lobby (ws://127.0.0.1:<porta>) autenticado com o access_token.
//   3. Entra na sala pelo código, alterna prontidão.
//   4. Ao receber PARTIDA_DISPONIVEL, conecta ao game-server via WS.
//   5. Usa JogadorBot para executar os turnos (Random Walk).
//   6. Encerra quando a partida termina, ao timeout ou via abort().
//
// Intencionalmente reutiliza o mesmo fluxo público do script de bots: o
// objetivo desta implementação é ergonomia de desenvolvimento local, não
// separação arquitetural de autenticação (essa é a Fase 2 da análise).

import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import type { EstadoDaPartidaSnapshot } from '@flicker/shared';
import { JogadorBot } from './jogador-bot.ts';

const MAX_TENTATIVAS_REGISTRO = 6;
// Timeout total do bot: 30 minutos. Uma partida longa não deve ultrapassar isso.
const TIMEOUT_BOT_MS = 30 * 60 * 1000;

export interface BotRunnerOpcoes {
  /** Código de 6 chars da sala alvo. */
  readonly codigoDeSala: string;
  /** URL base do lobby (ex.: http://localhost:3001). */
  readonly baseUrl: string;
  /** Callback opcional de log (padrão: console.log). */
  readonly log?: (...args: unknown[]) => void;
}

export interface BotInfo {
  readonly apelido: string;
  readonly email: string;
  readonly jogadorId: string;
}

type Cookies = { access_token?: string; refresh_token?: string };

function gerarCredenciaisEfemeras(): { email: string; apelido: string; senha: string } {
  const uniq = `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`.toLowerCase();
  const email = `bot-${uniq}@exemplo.local`;
  const apelido = `b-${Date.now().toString(36).slice(-4)}-${randomBytes(3).toString('hex')}`.toLowerCase().slice(0, 20);
  const senha = randomBytes(12).toString('base64url');
  return { email, apelido, senha };
}

function extrairCookies(headers: Headers): Cookies {
  const cookies: Cookies = {};
  // Node 18+ expõe getSetCookie() no Headers
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raws: string[] = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
  if (raws.length === 0) {
    const single = headers.get('set-cookie');
    if (single) raws.push(single);
  }
  for (const raw of raws) {
    const [par] = raw.split(';');
    if (!par) continue;
    const eq = par.indexOf('=');
    if (eq === -1) continue;
    const nome = par.slice(0, eq).trim();
    const valor = par.slice(eq + 1).trim();
    if (nome === 'access_token' || nome === 'refresh_token') {
      cookies[nome as keyof Cookies] = valor;
    }
  }
  return cookies;
}

function cookieHeader(cookies: Cookies): string {
  const partes: string[] = [];
  if (cookies.access_token) partes.push(`access_token=${cookies.access_token}`);
  if (cookies.refresh_token) partes.push(`refresh_token=${cookies.refresh_token}`);
  return partes.join('; ');
}

import { pool } from '../config/pg.ts';
import { redisClient } from '../config/redis.ts';
import { criarSessao } from '../sessoes.ts';
import { assinarAccess, assinarRefresh } from '../jwt.ts';
import { getConfig, assinarBotToken, chaveGameServer } from '@flicker/config';

// TTL de 2 horas para contas de bot no banco
const BOT_DB_TTL_HOURS = 2;

async function registrarBotEfemero(
  _baseUrl: string,
  log: (...args: unknown[]) => void,
): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_REGISTRO; tentativa++) {
    const cred = gerarCredenciaisEfemeras();
    try {
      // Inserção direta no PostgreSQL com bot=true e expira_em calculado
      const expiraEm = new Date(Date.now() + BOT_DB_TTL_HOURS * 60 * 60 * 1000);
      const res = await pool.query<{ id: string; apelido: string; email: string }>(
        `INSERT INTO usuarios (apelido, email, senha, bot, expira_em)
         VALUES ($1, $2, $3, true, $4)
         RETURNING id, apelido, email`,
        [cred.apelido, cred.email, 'bot_nopassword', expiraEm],
      );

      const jogador = res.rows[0];
      const { sessaoId } = await criarSessao(jogador.id);
      const access_token = assinarAccess(jogador, sessaoId);
      const refresh_token = assinarRefresh(jogador, sessaoId);

      log(`bot registrado diretamente no banco: ${jogador.apelido} (expiraEm: ${expiraEm.toISOString()})`);
      return { cookies: { access_token, refresh_token }, jogador };
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code === '23505') {
        log(`bot-runner: colisão de chave na tentativa ${tentativa}, gerando novas credenciais...`);
        await new Promise((r) => setTimeout(r, 50 * tentativa));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`bot-runner: falha ao registrar após ${MAX_TENTATIVAS_REGISTRO} tentativas`);
}

/**
 * Executa um bot efêmero completo: registro → lobby WS → sala → partida.
 * Retorna as informações do bot criado.
 * O bot roda de forma assíncrona até a partida terminar ou o timeout expirar.
 */
export async function iniciarBot(opcoes: BotRunnerOpcoes): Promise<BotInfo> {
  const { codigoDeSala, baseUrl } = opcoes;
  const log = opcoes.log ?? ((...args: unknown[]) => console.log('[bot-runner]', ...args));
  const wsBase = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

  const { cookies, jogador } = await registrarBotEfemero(baseUrl, log);
  const accessToken = cookies.access_token!;

  // Roda em background (não await) — o endpoint HTTP retorna logo
  void executarBotEmBackground({ codigoDeSala, wsBase, cookies, accessToken, jogador, log });

  return { apelido: jogador.apelido, email: jogador.email, jogadorId: jogador.id };
}

async function executarBotEmBackground(args: {
  codigoDeSala: string;
  wsBase: string;
  cookies: Cookies;
  accessToken: string;
  jogador: { id: string; apelido: string; email: string };
  log: (...args: unknown[]) => void;
}): Promise<void> {
  const { codigoDeSala, wsBase, cookies, accessToken, jogador, log } = args;
  const sockets: WebSocket[] = [];

  const timeout = setTimeout(() => {
    log(`timeout de ${TIMEOUT_BOT_MS / 60000}min atingido, encerrando bot`);
    for (const ws of sockets) ws.close(1000, 'timeout');
  }, TIMEOUT_BOT_MS);
  timeout.unref?.();

  try {
    await new Promise<void>((resolve) => {
      const wsLobby = new WebSocket(`${wsBase}/ws/lobby`, {
        headers: { Cookie: cookieHeader(cookies) },
      });
      sockets.push(wsLobby);

      let entrou = false;
      let prontoAgendado = false;
      let prontoEnviado = false;
      let partidaConectada = false;
      let membroId: string | null = null;

      wsLobby.on('open', () => {
        log(`WS lobby conectado → ENTRAR_NA_SALA ${codigoDeSala}`);
        wsLobby.send(JSON.stringify({ type: 'ENTRAR_NA_SALA', codigoDeSala }));
      });

      wsLobby.on('message', (data) => {
        let msg: unknown;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        const t = (msg as { type?: string }).type ?? '?';

        if (t === 'ERRO_DA_SALA') {
          const e = msg as { codigo: string; mensagem: string };
          log(`ERRO_DA_SALA ${e.codigo}: ${e.mensagem}`);
          return;
        }

        // Eventos que carregam sala
        if (
          t === 'SALA_ATUALIZADA' || t === 'MEMBRO_ENTROU' || t === 'PRONTIDAO_ATUALIZADA' ||
          t === 'MEMBRO_SAIU' || t === 'MEMBRO_DESCONECTADO' || t === 'MEMBRO_RECONECTADO' ||
          t === 'MEMBRO_EXPULSO' || t === 'ANFITRIAO_SUBSTITUIDO' ||
          t === 'PARTIDA_PREPARANDO' || t === 'PARTIDA_DISPONIVEL' ||
          t === 'PARTIDA_RECUSADA' || t === 'PARTIDA_FALHOU'
        ) {
          const sala = (msg as { sala?: { id: string; membros: { id: string; jogadorId: string; prontidao: boolean; ordemDeEntrada: number }[] } }).sala;
          if (sala) {
            const eu = sala.membros.find((m) => m.jogadorId === jogador.id);
            if (eu) {
              membroId = eu.id;
              if (!entrou) {
                entrou = true;
                log(`entrou na sala ordem=${eu.ordemDeEntrada}`);
              }
              if (!eu.prontidao && !prontoAgendado) {
                prontoAgendado = true;
                setTimeout(() => {
                  if (wsLobby.readyState === WebSocket.OPEN) {
                    log('→ ALTERNAR_PRONTIDAO');
                    wsLobby.send(JSON.stringify({ type: 'ALTERNAR_PRONTIDAO' }));
                    prontoEnviado = true;
                  }
                  prontoAgendado = false;
                }, 300);
              } else if (eu.prontidao && prontoEnviado) {
                log('prontidao confirmada');
              }
            }
          }
          if (t === 'PARTIDA_DISPONIVEL') {
            const d = msg as { partidaId: string; serverId: string };
            log(`PARTIDA_DISPONIVEL partida=${d.partidaId} server=${d.serverId}`);
            if (!partidaConectada) {
              partidaConectada = true;
              void (async () => {
                // Fase 2: assina Bot Service Token temporário dedicado para a partida
                const config = getConfig();
                const botToken = assinarBotToken(
                  { jogadorId: jogador.id, apelido: jogador.apelido, partidaId: d.partidaId },
                  config.jwtSecret,
                );

                // Descobre a URL do game-server via Redis ou fallback no config
                let gameServerWsBase: string | undefined;
                try {
                  const rawServer = await redisClient.get(chaveGameServer(d.serverId));
                  if (rawServer) {
                    const parsed = JSON.parse(rawServer) as { url?: string; host?: string; port?: number };
                    if (parsed.url) {
                      gameServerWsBase = parsed.url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
                    } else if (parsed.host && parsed.port) {
                      gameServerWsBase = `ws://${parsed.host}:${parsed.port}`;
                    }
                  }
                } catch (err) {
                  log(`erro ao consultar registro do game-server no redis: ${(err as Error).message}`);
                }

                if (!gameServerWsBase) {
                  const host = config.gameServerAdvertiseHost || '127.0.0.1';
                  const port = config.gameServerPort || 1234;
                  gameServerWsBase = `ws://${host}:${port}`;
                }

                const wsGame = conectarPartida({
                  wsBase: gameServerWsBase,
                  serverId: d.serverId,
                  partidaId: d.partidaId,
                  accessToken: botToken,
                  jogadorId: jogador.id,
                  apelido: jogador.apelido,
                  log,
                  onClose: resolve,
                });
                sockets.push(wsGame);
              })();
            }
          } else if (t === 'PARTIDA_RECUSADA' || t === 'PARTIDA_FALHOU') {
            log(`${t} ${JSON.stringify(msg).slice(0, 200)}`);
          }
          return;
        }
        // Ignora outros eventos (ex.: MENSAGEM_DE_CHAT)
      });

      wsLobby.on('error', (err) => { log(`WS lobby error: ${err.message}`); });
      wsLobby.on('close', (code, reason) => {
        log(`WS lobby close code=${code} reason=${reason.toString().slice(0, 80)}`);
        // Se o WS de lobby fechar sem termos conectado na partida, resolve para não vazar
        if (!partidaConectada) resolve();
      });

      void membroId; // Suprime "declared but never read"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function conectarPartida(args: {
  wsBase: string;
  serverId: string;
  partidaId: string;
  accessToken: string;
  jogadorId: string;
  apelido: string;
  log: (...a: unknown[]) => void;
  onClose: () => void;
}): WebSocket {
  const { wsBase, serverId, partidaId, accessToken, jogadorId, apelido, log, onClose } = args;
  const wsUrl =
    `${wsBase}/ws/game/${encodeURIComponent(serverId)}?partida-id=${encodeURIComponent(partidaId)}&token=${encodeURIComponent(accessToken)}`;
  log(`conectando ao game-server → ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  const bot = new JogadorBot({
    jogadorId,
    enviar: (cmd) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
    },
    log: (...a) => log('[jogo]', ...a),
  });

  ws.on('open', () => { log('WS game conectado'); });

  ws.on('message', (data) => {
    let msg: unknown;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const t = (msg as { type?: string }).type ?? '?';

    if (t === 'ADMISSAO_ACEITA') {
      log(`ADMISSAO_ACEITA apelido=${apelido}`);
      return;
    }
    if (t === 'ESTADO_DA_PARTIDA') {
      bot.aoReceberSnapshot((msg as { snapshot: EstadoDaPartidaSnapshot }).snapshot);
      return;
    }
    if (t === 'ERRO_DO_TABULEIRO') {
      const e = msg as { codigo?: string };
      bot.aoReceberErro(e.codigo ?? 'DADOS_INVALIDOS');
      return;
    }
    if (t === 'ADMISSAO_REJEITADA') {
      const e = msg as { codigo?: string; motivo?: string };
      log(`ADMISSAO_REJEITADA ${e.codigo ?? ''} ${e.motivo ?? ''}`);
      return;
    }
    bot.aoReceberEvento(msg);
    if (t === 'TURNO_INICIADO') log(`TURNO_INICIADO`);
    if (t === 'PARTIDA_TERMINADA') log(`PARTIDA_TERMINADA`);
  });

  ws.on('error', (err) => { log(`WS game error: ${err.message}`); });
  ws.on('close', (code, reason) => {
    log(`WS game close code=${code} reason=${reason.toString().slice(0, 80)}`);
    onClose();
  });

  return ws;
}
