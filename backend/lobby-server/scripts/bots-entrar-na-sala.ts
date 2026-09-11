#!/usr/bin/env -S npx tsx
import { randomBytes } from 'node:crypto';
import WebSocket, { type ClientOptions } from 'ws';
import type { EstadoDaPartidaSnapshot } from '@flicker/shared';
import { JogadorBot } from '../src/bots/jogador-bot.ts';

type Cookies = { access_token?: string; refresh_token?: string };

interface JogadorCredenciais {
  email: string;
  senha: string;
  apelido: string;
}

type MembroSala = {
  id: string;
  jogadorId: string;
  prontidao: boolean;
  apelido: string;
  ordemDeEntrada: number;
};

type SalaWire = {
  id: string;
  codigoDeSala: string;
  membros: MembroSala[];
};

const SENHA_PADRAO = 'senha_dev_123';
const BASE_PADRAO = 'http://localhost:8080';
const CODIGO_REGEX = /^[A-Z0-9]{6}$/;
// Bots são sempre efêmeros: cada execução gera email/apelido/senha únicos
// para nunca reutilizar um Jogador ainda associado a outra Sala (evita
// JOGADOR_JA_ASSOCIADO após Ctrl+C). Contas antigas expiram sozinhas no
// servidor (janela de reconexão 60s); limpar no banco quando desejado com:
//   DELETE FROM usuarios WHERE email LIKE 'bot-%@teste.local';
const MAX_TENTATIVAS_REGISTRO = 8;

function log(prefix: string, ...args: unknown[]): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${prefix}`, ...args);
}

function parseArgs(): { codigo: string; baseUrl: string; emails: string[] | null; senha: string; quantidade: number } {
  const raw = process.argv.slice(2).filter((a) => a !== '--');
  let codigo = '';
  let baseUrl = process.env.LOBBY_PUBLIC_URL ?? process.env.LOBBY_URL ?? BASE_PADRAO;
  let emails: string[] | null = null;
  let senha = SENHA_PADRAO;
  let quantidade = 3;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--base-url' && raw[i + 1]) {
      baseUrl = raw[++i]!;
    } else if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--emails' && raw[i + 1]) {
      emails = raw[++i]!.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--emails=')) {
      emails = arg.slice('--emails='.length).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--senha' && raw[i + 1]) {
      senha = raw[++i]!;
    } else if (arg.startsWith('--senha=')) {
      senha = arg.slice('--senha='.length);
    } else if (arg === '--quantidade' && raw[i + 1]) {
      const v = Number(raw[++i]!);
      if (!Number.isInteger(v) || v < 1 || v > 3) {
        console.error(`--quantidade inválida "${raw[i]!}": esperado 1, 2 ou 3`);
        process.exit(1);
      }
      quantidade = v;
    } else if (arg.startsWith('--quantidade=')) {
      const v = Number(arg.slice('--quantidade='.length));
      if (!Number.isInteger(v) || v < 1 || v > 3) {
        console.error(`--quantidade inválida "${arg}": esperado 1, 2 ou 3`);
        process.exit(1);
      }
      quantidade = v;
    } else if (!arg.startsWith('--') && !codigo) {
      codigo = arg.toUpperCase().trim();
    }
  }

  if (!codigo) {
    console.error('Uso: npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts <CODIGO> [--quantidade 1|2|3] [--emails a@x,b@x,c@x] [--senha ...] [--base-url http://localhost:8080]');
    process.exit(1);
  }
  if (!CODIGO_REGEX.test(codigo)) {
    console.error(`Código inválido "${codigo}": esperado 6 caracteres [A-Z0-9]`);
    process.exit(1);
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  return { codigo, baseUrl, emails, senha, quantidade };
}

function printHelp(): void {
  console.log(`
Uso: npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts <CODIGO> [opções]
     npm run bots -- <CODIGO>  (atalho raiz)
     npm run bots -- <CODIGO>  (dentro de backend/lobby-server)

  CODIGO              Código de Sala (6 chars A-Z0-9)

Opções:
  --quantidade N      Quantidade de bots (1..3, padrão 3) — N+1 total na sala
  --emails a,b,c      Emails de contas já criadas (tenta login primeiro; usa --senha)
  --senha SENHA       Senha das contas de --emails (padrão: ${SENHA_PADRAO}; ignorada sem --emails)
  --base-url URL      Base do lobby (padrão: ${BASE_PADRAO} ou env LOBBY_PUBLIC_URL)

Padrão (sem --emails): gera --quantidade contas efêmeras por execução, com
  email/apelido/senha aleatórios e únicos, e registra direto (sem login).
  Em 409 (apelido/email em uso) gera novas credenciais e repete (até
  ${MAX_TENTATIVAS_REGISTRO}x). Cada execução cria N linhas em usuarios;
  para limpar: DELETE FROM usuarios WHERE email LIKE 'bot-%@teste.local';

Exemplos:
  npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF
  npm run bots -- ABCDEF --quantidade 1   # sala de 2 (humana + 1 bot)
  npm run bots -- ABCDEF --quantidade 2   # sala de 3
  npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF --emails bot1@x,bot2@x --senha minhasenha --quantidade 2
  LOBBY_PUBLIC_URL=http://localhost:8080 npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF --quantidade 3
`.trim());
}

function extrairCookies(res: Response): Cookies {
  const cookies: Cookies = {};
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raws: string[] = typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [];
  if (raws.length === 0) {
    const single = res.headers.get('set-cookie');
    if (single) raws.push(single);
  }
  for (const raw of raws) {
    const [par] = raw.split(';');
    if (!par) continue;
    const eq = par.indexOf('=');
    if (eq === -1) continue;
    const nome = par.slice(0, eq).trim();
    const valor = par.slice(eq + 1).trim();
    if (nome === 'access_token' || nome === 'refresh_token') cookies[nome as keyof Cookies] = valor;
  }
  return cookies;
}

function cookieHeader(cookies: Cookies): string {
  const partes: string[] = [];
  if (cookies.access_token) partes.push(`access_token=${cookies.access_token}`);
  if (cookies.refresh_token) partes.push(`refresh_token=${cookies.refresh_token}`);
  return partes.join('; ');
}

async function tentarLogin(baseUrl: string, email: string, senha: string): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } } | null> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  if (res.status === 200) {
    const jogador = (await res.json()) as { id: string; apelido: string; email: string };
    return { cookies: extrairCookies(res), jogador };
  }
  return null;
}

type ResultadoRegister =
  | { ok: true; cookies: Cookies; jogador: { id: string; apelido: string; email: string } }
  | { ok: false; motivo: 'conflito' | 'validacao' | 'http'; status: number; corpo: string };

async function tentarRegister(baseUrl: string, apelido: string, email: string, senha: string): Promise<ResultadoRegister> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apelido, email, senha }),
  });
  if (res.status === 201) {
    const jogador = (await res.json()) as { id: string; apelido: string; email: string };
    return { ok: true, cookies: extrairCookies(res), jogador };
  }
  const corpo = await res.text().catch(() => '');
  if (res.status === 409) return { ok: false, motivo: 'conflito', status: res.status, corpo: corpo.slice(0, 300) };
  if (res.status === 400) return { ok: false, motivo: 'validacao', status: res.status, corpo: corpo.slice(0, 300) };
  return { ok: false, motivo: 'http', status: res.status, corpo: corpo.slice(0, 300) };
}

function gerarCredenciaisEfemeras(): JogadorCredenciais {
  // email: válido, minúsculo, único (timestamp base36 + 6 bytes hex).
  // apelido: 3–20 chars, só [a-z0-9-], único.
  // senha: 16 chars base64url (sempre >= 8, sem espaços).
  const uniq = `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`.toLowerCase();
  // CLI cria via registro público: usa domínio de teste NÃO reservado.
  // (@bot.teste é reservado a Cadastros internos do BotRunner via INSERT direto.)
  const email = `bot-${uniq}@teste.local`;
  const apelido = `b-${Date.now().toString(36).slice(-4)}-${randomBytes(3).toString('hex')}`.toLowerCase().slice(0, 20);
  const senha = randomBytes(12).toString('base64url');
  return { email, senha, apelido };
}

async function registrarBotEfemero(
  baseUrl: string,
  indice: number,
): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> {
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_REGISTRO; tentativa++) {
    const cred = gerarCredenciaisEfemeras();
    const res = await tentarRegister(baseUrl, cred.apelido, cred.email, cred.senha);
    if (res.ok) {
      if (!res.cookies.access_token) throw new Error(`bot-${indice}: register sem access_token`);
      log(`bot-${indice}`, `register efêmero ok (${res.jogador.apelido}) tentativa=${tentativa}`);
      return res;
    }
    ultimoErro = `${res.motivo} http=${res.status} ${res.corpo}`;
    if (res.motivo === 'conflito') {
      log(`bot-${indice}`, `conflito 409 na tentativa ${tentativa}, gerando novas credenciais...`);
      await new Promise((r) => setTimeout(r, 100 * tentativa));
      continue;
    }
    throw new Error(`bot-${indice}: falha no register (${ultimoErro})`);
  }
  throw new Error(`bot-${indice}: falha ao registrar após ${MAX_TENTATIVAS_REGISTRO} tentativas (último: ${ultimoErro})`);
}

async function obterCredenciaisContaExistente(
  baseUrl: string,
  cred: JogadorCredenciais,
  indice: number,
): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> {
  const login = await tentarLogin(baseUrl, cred.email, cred.senha);
  if (login && login.cookies.access_token) {
    log(`bot-${indice}`, `login ok (${login.jogador.apelido})`);
    return login;
  }
  const reg = await tentarRegister(baseUrl, cred.apelido, cred.email, cred.senha);
  if (reg.ok) {
    if (!reg.cookies.access_token) throw new Error(`bot-${indice}: register sem access_token`);
    log(`bot-${indice}`, `register ok (${reg.jogador.apelido})`);
    return reg;
  }
  if (!reg.ok && reg.motivo === 'conflito') {
    const login2 = await tentarLogin(baseUrl, cred.email, cred.senha);
    if (login2 && login2.cookies.access_token) {
      log(`bot-${indice}`, `login após 409 ok (${login2.jogador.apelido})`);
      return login2;
    }
  }
  throw new Error(`bot-${indice}: falha ao obter credenciais para ${cred.email} (${reg.ok ? 'sem token' : `${reg.motivo} http=${reg.status} ${reg.corpo}`})`);
}

function entrarNaPartida(
  baseUrl: string,
  serverId: string,
  partidaId: string,
  accessToken: string,
  jogadorId: string,
  apelido: string,
  indice: number,
  sockets: WebSocket[],
  prefix: string,
): WebSocket {
  const wsGameUrl =
    baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') +
    `/ws/game/${encodeURIComponent(serverId)}?partida-id=${encodeURIComponent(partidaId)}&token=${encodeURIComponent(accessToken)}`;
  // Segurança (#365 item 1): CLI dev também não loga Bearer token.
  log(prefix, `entrando na partida server=${serverId} partida=${partidaId} token=***${accessToken.slice(-4)}`);
  const ws = new WebSocket(wsGameUrl);
  sockets.push(ws);
  // Driver do turno (Random Walk): o espelho é semeado pelo snapshot da
  // admissão e avança pelos eventos do broadcast; o turno roda no
  // TURNO_INICIADO do próprio bot.
  const bot = new JogadorBot({
    jogadorId,
    enviar: (comando) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(comando));
      }
    },
    log: (...args) => log(prefix, '[bot]', ...args),
  });

  ws.on('open', () => {
    log(prefix, `WS de partida conectado (aguardando admissão)`);
  });

  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const t = (msg as { type?: string }).type ?? '?';
    if (t === 'ADMISSAO_ACEITA') {
      const a = msg as { jogadorId: string; apelido: string; partidaId: string; estado: string };
      log(prefix, `ADMISSAO_ACEITA jogador=${a.apelido} partida=${a.partidaId} estado=${a.estado} — dentro da partida`);
      return;
    }
    if (t === 'PARTIDA_INICIADA') {
      log(prefix, `PARTIDA_INICIADA ${JSON.stringify(msg)}`);
      return;
    }
    if (t === 'ESTADO_DA_PARTIDA') {
      log(prefix, `ESTADO_DA_PARTIDA recebido (snapshot)`);
      bot.aoReceberSnapshot(
        (msg as { snapshot: EstadoDaPartidaSnapshot }).snapshot,
      );
      return;
    }
    if (t === 'ERRO_DO_TABULEIRO') {
      const e = msg as { codigo?: string; motivo?: string; mensagem?: string };
      log(prefix, `ERRO_DO_TABULEIRO ${e.codigo ?? ''} ${e.motivo ?? e.mensagem ?? ''}`.trim());
      bot.aoReceberErro(e.codigo ?? 'DADOS_INVALIDOS');
      return;
    }
    if (t === 'ADMISSAO_REJEITADA') {
      const e = msg as { codigo?: string; motivo?: string; mensagem?: string };
      log(prefix, `${t} ${e.codigo ?? ''} ${e.motivo ?? e.mensagem ?? ''}`.trim());
      return;
    }
    if (t === 'TURNO_INICIADO') {
      log(prefix, `TURNO_INICIADO ${JSON.stringify(msg).slice(0, 200)}`);
      bot.aoReceberEvento(msg);
      return;
    }
    // Demais eventos do canal da partida alimentam o espelho do bot.
    bot.aoReceberEvento(msg);
    log(prefix, `partida evento ${t} ${JSON.stringify(msg).slice(0, 200)}`);
  });

  ws.on('error', (err) => {
    log(prefix, `WS partida error: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    log(prefix, `WS partida close code=${code} reason=${reason.toString().slice(0, 100)}`);
  });

  return ws;
}

function criarWs(
  baseUrl: string,
  codigo: string,
  cookies: Cookies,
  jogadorId: string,
  apelido: string,
  indice: number,
  sockets: WebSocket[],
): WebSocket {
  const accessToken = cookies.access_token ?? '';
  const wsUrl = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/lobby';
  const headers: Record<string, string> = { Cookie: cookieHeader(cookies) };
  const wsOptions: ClientOptions = { headers };
  const ws = new WebSocket(wsUrl, wsOptions);
  const prefix = `bot-${indice}(${apelido})`;

  let salaId: string | null = null;
  let membroId: string | null = null;
  let entrou = false;
  let prontoEnviado = false;
  let prontoAgendado = false;
  let tentativasEntrar = 0;
  let partidaConectada = false;
  const MAX_TENTATIVAS_ENTRAR = 1;
  // Contas efêmeras nunca deveriam cair aqui; se cair, é fatal (não adianta
  // repetir: conta nova não tem associação prévia — o problema é a sala).
  const ERROS_FATAIS_ENTRADA = new Set([
    'JOGADOR_JA_ASSOCIADO',
    'JOGADOR_EXPULSO',
    'SALA_CHEIA',
    'SALA_ENCERRADA',
    'SALA_NAO_ENCONTRADA',
    'SALA_ENCAMINHADA',
  ]);

  function enviarEntrar(): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    tentativasEntrar++;
    log(prefix, `WS conectado → ENTRAR_NA_SALA ${codigo} (tentativa ${tentativasEntrar})`);
    ws.send(JSON.stringify({ type: 'ENTRAR_NA_SALA', codigoDeSala: codigo }));
  }

  ws.on('open', () => {
    enviarEntrar();
  });

  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const t = (msg as { type?: string }).type ?? '?';
    if (t === 'ERRO_DA_SALA') {
      const e = msg as { codigo: string; mensagem: string };
      log(prefix, `ERRO_DA_SALA ${e.codigo}: ${e.mensagem}`);
      if (!ERROS_FATAIS_ENTRADA.has(e.codigo) && tentativasEntrar <= MAX_TENTATIVAS_ENTRAR) {
        const delay = 500;
        log(prefix, `retry ENTRAR_NA_SALA em ${delay}ms (single-shot com retry dev)`);
        setTimeout(() => enviarEntrar(), delay);
      } else if (ERROS_FATAIS_ENTRADA.has(e.codigo)) {
        log(prefix, `erro fatal — sem retry (conta efêmera nova; verifique a sala/código)`);
      }
      return;
    }
    if (t === 'SALA_ATUALIZADA' || t === 'MEMBRO_ENTROU' || t === 'PRONTIDAO_ATUALIZADA' || t === 'MEMBRO_SAIU' || t === 'MEMBRO_DESCONECTADO' || t === 'MEMBRO_RECONECTADO' || t === 'MEMBRO_EXPULSO' || t === 'ANFITRIAO_SUBSTITUIDO' || t === 'PARTIDA_PREPARANDO' || t === 'PARTIDA_DISPONIVEL' || t === 'PARTIDA_RECUSADA' || t === 'PARTIDA_FALHOU') {
      const sala = (msg as { sala?: SalaWire }).sala;
      if (sala) {
        salaId = sala.id;
        const eu = sala.membros.find((m) => m.jogadorId === jogadorId);
        if (eu) {
          membroId = eu.id;
          if (!entrou) {
            entrou = true;
            log(prefix, `entrou ordem=${eu.ordemDeEntrada ?? '?'} sala=${sala.codigoDeSala}`);
          }
          if (!eu.prontidao && !prontoAgendado) {
            prontoAgendado = true;
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                log(prefix, '→ ALTERNAR_PRONTIDAO (ficar pronto)');
                ws.send(JSON.stringify({ type: 'ALTERNAR_PRONTIDAO' }));
                prontoEnviado = true;
              }
              prontoAgendado = false;
            }, 300);
          } else if (eu.prontidao && prontoEnviado) {
            log(prefix, 'pronto=true confirmado');
          }
        }
      }
      if (t === 'PRONTIDAO_ATUALIZADA') {
        const p = msg as { membroId: string; prontidao: boolean };
        if (p.membroId === membroId) log(prefix, `PRONTIDAO_ATUALIZADA pronto=${p.prontidao}`);
      }
      if (t === 'PARTIDA_PREPARANDO') {
        log(prefix, `PARTIDA_PREPARANDO`);
      } else if (t === 'PARTIDA_DISPONIVEL') {
        const d = msg as { partidaId: string; serverId: string };
        log(prefix, `PARTIDA_DISPONIVEL partida=${d.partidaId} server=${d.serverId}`);
        if (!partidaConectada && accessToken) {
          partidaConectada = true;
          entrarNaPartida(baseUrl, d.serverId, d.partidaId, accessToken, jogadorId, apelido, indice, sockets, prefix);
        } else if (!accessToken) {
          log(prefix, `sem access_token — não é possível entrar na partida`);
        }
      } else if (t === 'PARTIDA_RECUSADA' || t === 'PARTIDA_FALHOU') {
        log(prefix, t, JSON.stringify(msg));
      }
      return;
    }
    if (t === 'MENSAGEM_DE_CHAT') {
      const c = msg as { apelido: string; conteudo: string };
      log(prefix, `chat ${c.apelido}: ${c.conteudo}`);
      return;
    }
    log(prefix, `evento ${t}`, JSON.stringify(msg).slice(0, 300));
  });

  ws.on('close', (code, reason) => {
    log(prefix, `WS close code=${code} reason=${reason.toString().slice(0, 100)} (sem reconexão automática; servidor suporta reconexão 60s via ws.ts)`);
  });

  ws.on('error', (err) => {
    log(prefix, `WS error: ${err.message}`);
  });

  void salaId;
  return ws;
}

async function main(): Promise<void> {
  const { codigo, baseUrl, emails, senha, quantidade } = parseArgs();
  if (emails !== null && emails.length !== quantidade) {
    console.error(`--quantidade ${quantidade} conflita com --emails (${emails.length} emails): informe exatamente ${quantidade} emails ou omita --emails para usar contas efêmeras`);
    process.exit(1);
  }

  const bots: Array<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> = [];
  if (emails) {
    const lista = emails.slice(0, quantidade).map((email, i) => ({
      email,
      senha,
      apelido: email.split('@')[0]!.slice(0, 20) || `bot-${i}`,
    }));
    log('main', `código=${codigo} base=${baseUrl} modo=contas-existentes bots=${lista.map((b) => b.email).join(', ')} (quantidade=${quantidade}, sala N=${quantidade + 1})`);
    for (let i = 0; i < lista.length; i++) {
      const cred = lista[i]!;
      try {
        const res = await obterCredenciaisContaExistente(baseUrl, cred, i + 1);
        if (!res.cookies.access_token) throw new Error('sem access_token');
        bots.push(res);
      } catch (e) {
        log(`bot-${i + 1}`, `falha credenciais: ${(e as Error).message}`);
        process.exit(1);
      }
    }
  } else {
    log('main', `código=${codigo} base=${baseUrl} modo=efêmero (${quantidade} contas novas por execução, sala N=${quantidade + 1})`);
    for (let i = 0; i < quantidade; i++) {
      try {
        const res = await registrarBotEfemero(baseUrl, i + 1);
        bots.push(res);
      } catch (e) {
        log(`bot-${i + 1}`, `falha credenciais: ${(e as Error).message}`);
        process.exit(1);
      }
    }
    log('main', `bots=${bots.map((b) => b.jogador.email).join(', ')}`);
  }

  const sockets: WebSocket[] = [];
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i]!;
    const ws = criarWs(baseUrl, codigo, b.cookies, b.jogador.id, b.jogador.apelido, i + 1, sockets);
    sockets.push(ws);
    await new Promise((r) => setTimeout(r, 150));
  }

  log('main', `${quantidade} bot(s) conectado(s) ao lobby, prontidão enviada. Quando o anfitrião iniciar a partida, cada bot conecta no game-server via /ws/game/<serverId>. Permanecendo conectados — Ctrl+C para sair.`);

  const encerrar = () => {
    log('main', 'encerrando bots...');
    for (const ws of sockets) {
      try {
        ws.close(1000, 'bots encerrados');
      } catch {}
    }
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
