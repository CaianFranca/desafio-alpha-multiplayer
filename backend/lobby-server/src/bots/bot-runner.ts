// BotRunner — instancia um bot efêmero in-process no lobby-server.
//
// Fluxo:
//   1. Registra Cadastro efêmero via INSERT direto no PG (bot=true, expira_em
//      TTL 2h, retry por colisão) + Sessão Redis + access_token. Não passa pelo
//      POST /api/auth/register: o domínio @bot.teste é reservado no registro
//      público (routes/auth.ts) e o runner cria direto no banco.
//   2. Abre Conexão WS de lobby autenticada com o access_token.
//   3. Entra na sala pelo código, alterna prontidão.
//   4. Ao receber PARTIDA_DISPONIVEL, conecta ao game-server via WS.
//   5. Usa JogadorBot para executar os turnos (Random Walk).
//   6. Encerra quando a partida termina, ao timeout ou via abort().
//
// Falha pós-202 (#365 item 3): join recusado ou admissão rejeitada atualiza o
// estado em bots/estado.ts (falhou), purga o Cadastro órfão e chama os
// callbacks para a rota difundir BOT_FALHOU + liberar a trava de admissão.
// Sem isso, o Anfitrião veria só o 202 e a linha órfã ficaria 2h no banco.

import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import type { EstadoDaPartidaSnapshot } from '@flicker/shared';
import { JogadorBot } from './jogador-bot.ts';
import { escolherApelidoDeBot } from './nomes-de-bots.ts';

const MAX_TENTATIVAS_REGISTRO = 6;
// Timeout total do bot: 30 minutos. Uma partida longa não deve ultrapassar isso.
const TIMEOUT_BOT_MS = 30 * 60 * 1000;

export interface BotRunnerOpcoes {
  /** Código de 6 chars da sala alvo. */
  readonly codigoDeSala: string;
  /** Sala alvo (para estado + purga + broadcast de falha). */
  readonly salaId: string;
  /** URL base do lobby (ex.: http://localhost:3001). */
  readonly baseUrl: string;
  /**
   * Apelidos ocupados na Sala (membros + in-flight, montados pela rota).
   * A escolha temática exclui para não repetir nome na mesma Sala.
   */
  readonly apelidosOcupados?: readonly string[];
  /** Callback opcional de log (padrão: console.log). */
  readonly log?: (...args: unknown[]) => void;
  /** Chamado quando o bot confirma entrada na Sala (vira Membro). */
  readonly aoAdmitir?: (bot: { jogadorId: string; apelido: string }) => void;
  /** Chamado quando a admissão falha (join recusado / admissão rejeitada). */
  readonly aoFalhar?: (bot: { jogadorId: string; apelido: string; codigo: string; mensagem: string }) => void;
  /** Chamado ao encerrar (partida terminou, timeout ou WS fechou após admitir). */
  readonly aoEncerrar?: (bot: { jogadorId: string }) => void;
}

export interface BotInfo {
  readonly apelido: string;
  readonly email: string;
  readonly jogadorId: string;
}

type Cookies = { access_token?: string };

function gerarCredenciaisEfemeras(
  apelidosOcupados: readonly string[] = [],
): { email: string; apelido: string; senha: string } {
  const uniq = `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`.toLowerCase();
  // Domínio canônico de bots (opção A da review #365): também reservado no
  // registro público, mesma regra do CLI e dos testes.
  const email = `bot-${uniq}@bot.teste`;
  // Apelido temático do Sanatório (follow-up #365): escolha excluindo os
  // ocupados da Sala; sufixo " 2", " 3"... só quando o pool esgota.
  const apelido = escolherApelidoDeBot(apelidosOcupados);
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
    if (nome === 'access_token') {
      cookies[nome as keyof Cookies] = valor;
    }
  }
  return cookies;
}

function cookieHeader(cookies: Cookies): string {
  const partes: string[] = [];
  if (cookies.access_token) partes.push(`access_token=${cookies.access_token}`);
  return partes.join('; ');
}

import { pool } from '../config/pg.ts';
import { redisClient } from '../config/redis.ts';
import { criarSessao } from '../sessoes.ts';
import { assinarAccess } from '../jwt.ts';
import { getConfig, assinarBotToken, chaveGameServer } from '@flicker/config';
import { marcarBotAtivo, marcarBotEncerrado, marcarBotFalhou, registrarBotEmAdmissao } from './estado.ts';

// TTL de 2 horas para Cadastros de bot no banco
const BOT_DB_TTL_HOURS = 2;

/** Códigos de ERRO_DA_SALA que encerram a admissão sem retry (Cadastro novo, sem associação prévia). */
const ERROS_FATAIS_ADMISSAO = new Set([
  'JOGADOR_JA_ASSOCIADO',
  'JOGADOR_EXPULSO',
  'SALA_CHEIA',
  'SALA_ENCERRADA',
  'SALA_NAO_ENCONTRADA',
  'SALA_ENCAMINHADA',
]);

async function registrarBotEfemero(
  log: (...args: unknown[]) => void,
  apelidosOcupados: readonly string[] = [],
): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> {
  // Candidatos já tentados nesta chamada entram na exclusão: em 23505 o retry
  // nunca repete o mesmo Apelido (o UNIQUE global é o árbitro final).
  const tentados: string[] = [...apelidosOcupados];
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_REGISTRO; tentativa++) {
    const cred = gerarCredenciaisEfemeras(tentados);
    try {
      // Inserção direta no PostgreSQL com bot=true e expira_em calculado.
      // Bypass intencional do POST /api/auth/register: o domínio @bot.teste é
      // reservado justamente para Cadastros internos como este.
      const expiraEm = new Date(Date.now() + BOT_DB_TTL_HOURS * 60 * 60 * 1000);
      const res = await pool.query<{ id: string; apelido: string; email: string }>(
        `INSERT INTO usuarios (apelido, email, senha, bot, expira_em)
         VALUES ($1, $2, $3, true, $4)
         RETURNING id, apelido, email`,
        [cred.apelido, cred.email, 'bot_nopassword', expiraEm],
      );

      const jogador = res.rows[0]!;
      const { sessaoId } = await criarSessao(jogador.id);
      // Só access_token: o WS do lobby autentica pelo cookie access_token
      // (ws.ts) e a Conexão persiste — refresh nunca é usado pelo bot.
      const access_token = assinarAccess(jogador, sessaoId);

      log(`bot registrado diretamente no banco: ${jogador.apelido} (expiraEm: ${expiraEm.toISOString()})`);
      return { cookies: { access_token }, jogador };
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code === '23505') {
        tentados.push(cred.apelido);
        log(`bot-runner: colisão de chave na tentativa ${tentativa}, gerando novas credenciais...`);
        await new Promise((r) => setTimeout(r, 50 * tentativa));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`bot-runner: falha ao registrar após ${MAX_TENTATIVAS_REGISTRO} tentativas`);
}

async function purgarCadastroOrfao(jogadorId: string, log: (...args: unknown[]) => void): Promise<void> {
  try {
    await pool.query(`DELETE FROM usuarios WHERE id = $1 AND bot = true`, [jogadorId]);
  } catch (err) {
    log(`falha ao purgar Cadastro órfão do bot ${jogadorId}: ${(err as Error).message}`);
  }
}

function mascararToken(token: string): string {
  return `***${token.slice(-4)}`;
}

/**
 * Executa um bot efêmero completo: registro → lobby WS → sala → partida.
 * Retorna as informações do bot criado.
 * O bot roda de forma assíncrona até a partida terminar ou o timeout expirar.
 */
export async function iniciarBot(opcoes: BotRunnerOpcoes): Promise<BotInfo> {
  const { codigoDeSala, salaId, baseUrl } = opcoes;
  const log = opcoes.log ?? ((...args: unknown[]) => console.log('[bot-runner]', ...args));
  const wsBase = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

  const { cookies, jogador } = await registrarBotEfemero(log, opcoes.apelidosOcupados ?? []);
  const accessToken = cookies.access_token!;

  registrarBotEmAdmissao({
    jogadorId: jogador.id,
    apelido: jogador.apelido,
    salaId,
    codigoDeSala,
  });

  // Roda em background (não await) — o endpoint HTTP retorna logo
  void executarBotEmBackground({
    codigoDeSala,
    wsBase,
    cookies,
    accessToken,
    jogador,
    log,
    aoAdmitir: opcoes.aoAdmitir,
    aoFalhar: opcoes.aoFalhar,
    aoEncerrar: opcoes.aoEncerrar,
  });

  return { apelido: jogador.apelido, email: jogador.email, jogadorId: jogador.id };
}

async function executarBotEmBackground(args: {
  codigoDeSala: string;
  wsBase: string;
  cookies: Cookies;
  accessToken: string;
  jogador: { id: string; apelido: string; email: string };
  log: (...args: unknown[]) => void;
  aoAdmitir?: (bot: { jogadorId: string; apelido: string }) => void;
  aoFalhar?: (bot: { jogadorId: string; apelido: string; codigo: string; mensagem: string }) => void;
  aoEncerrar?: (bot: { jogadorId: string }) => void;
}): Promise<void> {
  const { codigoDeSala, wsBase, cookies, jogador, log, aoAdmitir, aoFalhar, aoEncerrar } = args;
  const conexoes: WebSocket[] = [];

  let falhou = false;
  let admitido = false;
  const finalizarFalha = async (codigo: string, mensagem: string): Promise<void> => {
    if (falhou) return;
    falhou = true;
    marcarBotFalhou(jogador.id, codigo, mensagem);
    await purgarCadastroOrfao(jogador.id, log);
    try {
      aoFalhar?.({ jogadorId: jogador.id, apelido: jogador.apelido, codigo, mensagem });
    } catch (err) {
      log(`callback aoFalhar lançou: ${(err as Error).message}`);
    }
  };

  const timeout = setTimeout(() => {
    log(`timeout de ${TIMEOUT_BOT_MS / 60000}min atingido, encerrando bot`);
    for (const ws of conexoes) ws.close(1000, 'timeout');
  }, TIMEOUT_BOT_MS);
  timeout.unref?.();

  try {
    await new Promise<void>((resolve) => {
      const wsLobby = new WebSocket(`${wsBase}/ws/lobby`, {
        headers: { Cookie: cookieHeader(cookies) },
      });
      conexoes.push(wsLobby);

      let entrou = false;
      let prontoAgendado = false;
      let prontoEnviado = false;
      let partidaConectada = false;

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
          if (ERROS_FATAIS_ADMISSAO.has(e.codigo) && !entrou) {
            void finalizarFalha(e.codigo, e.mensagem).then(() => {
              try { wsLobby.close(1000, 'admissao-recusada'); } catch { /* ignora */ }
            });
          }
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
              if (!entrou) {
                entrou = true;
                admitido = true;
                marcarBotAtivo(jogador.id);
                log(`entrou na sala ordem=${eu.ordemDeEntrada}`);
                try {
                  aoAdmitir?.({ jogadorId: jogador.id, apelido: jogador.apelido });
                } catch (err) {
                  log(`callback aoAdmitir lançou: ${(err as Error).message}`);
                }
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
            } else if (
              entrou &&
              (t === 'MEMBRO_EXPULSO' || t === 'MEMBRO_SAIU') &&
              (msg as { jogadorId?: string }).jogadorId === jogador.id
            ) {
              // Removido da Sala pelo Anfitrião (bots saem sem bloqueio e com
              // o Cadastro purgado pelo handler): encerra sem falha — o close
              // abaixo não vira `falhou` porque `entrou` já é true.
              log('removido da sala pelo anfitriao, encerrando');
              marcarBotEncerrado(jogador.id);
              try {
                wsLobby.close(1000, 'removido-da-sala');
              } catch {
                /* ignora */
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
                let motivoFallback: string | null = null;
                try {
                  const rawServer = await redisClient.get(chaveGameServer(d.serverId));
                  if (rawServer) {
                    try {
                      const parsed = JSON.parse(rawServer) as { url?: string; host?: string; port?: number };
                      if (parsed.url) {
                        gameServerWsBase = parsed.url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
                      } else if (parsed.host && parsed.port) {
                        gameServerWsBase = `ws://${parsed.host}:${parsed.port}`;
                      } else {
                        motivoFallback = 'registro-sem-url-nem-host-port';
                      }
                    } catch {
                      motivoFallback = 'registro-json-invalido';
                    }
                  } else {
                    motivoFallback = 'registro-ausente';
                  }
                } catch (err) {
                  motivoFallback = `redis-erro:${(err as Error).message}`;
                }

                if (!gameServerWsBase) {
                  const host = config.gameServerAdvertiseHost || '127.0.0.1';
                  const port = config.gameServerPort || 1234;
                  gameServerWsBase = `ws://${host}:${port}`;
                  console.warn(
                    `[bot-runner] fallback de game-server server=${d.serverId} motivo=${motivoFallback ?? 'desconhecido'} → ${host}:${port}`,
                  );
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
                  // Rejeição na partida usa o mesmo caminho visível da admissão:
                  // marca `falhou` (não vira `encerrado` no finally), purga o
                  // Cadastro, difunde BOT_FALHOU via callback e sai da Sala
                  // fechando o WS do lobby (remove o Membro).
                  onFalha: (codigo, mensagem) => {
                    void finalizarFalha(codigo, mensagem).then(() => {
                      try {
                        wsLobby.close(1000, 'admissao-rejeitada');
                      } catch {
                        /* ignora */
                      }
                    });
                  },
                });
                conexoes.push(wsGame);
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
        // Se o WS de lobby fechar sem termos entrado na Sala, é falha de
        // admissão: marca + purga para não vazar Cadastro órfão.
        if (!entrou && !falhou) {
          void finalizarFalha('CONEXAO_ENCERRADA', 'Conexão com o lobby encerrada antes de entrar na sala.');
        }
        // Se fechou sem conectar na partida, resolve para não vazar
        if (!partidaConectada) resolve();
      });
    });
  } finally {
    clearTimeout(timeout);
    if (admitido && !falhou) {
      marcarBotEncerrado(jogador.id);
      try {
        aoEncerrar?.({ jogadorId: jogador.id });
      } catch (err) {
        log(`callback aoEncerrar lançou: ${(err as Error).message}`);
      }
    }
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
  onFalha: (codigo: string, mensagem: string) => void;
}): WebSocket {
  const { wsBase, serverId, partidaId, accessToken, jogadorId, apelido, log, onClose, onFalha } = args;
  const wsUrl =
    `${wsBase}/ws/game/${encodeURIComponent(serverId)}?partida-id=${encodeURIComponent(partidaId)}&token=${encodeURIComponent(accessToken)}`;
  // Segurança (#365 item 1): nunca logar o Bearer token — só host/ids + sufixo.
  log(`conectando ao game-server host=${wsBase} server=${serverId} partida=${partidaId} token=${mascararToken(accessToken)}`);
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
      const e = msg as { codigo?: string; motivo?: string; mensagem?: string };
      const codigo = e.codigo ?? 'ADMISSAO_REJEITADA';
      const mensagem = e.motivo ?? e.mensagem ?? 'Admissão na partida rejeitada.';
      log(`ADMISSAO_REJEITADA ${codigo} ${mensagem}`);
      // Mesmo caminho visível da falha de admissão no lobby (#365 item 3):
      // finalizarFalha marca `falhou` (o finally não sobrescreve com
      // `encerrado`), purga o Cadastro e difunde BOT_FALHOU. Fecha o WS do
      // jogo para não vazar a Conexão.
      try {
        onFalha(codigo, mensagem);
      } catch (err) {
        log(`callback onFalha lançou: ${(err as Error).message}`);
      }
      try {
        ws.close(1000, 'admissao-rejeitada');
      } catch {
        /* ignora */
      }
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
