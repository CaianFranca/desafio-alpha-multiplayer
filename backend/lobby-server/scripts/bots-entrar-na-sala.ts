#!/usr/bin/env -S npx tsx
import WebSocket, { type ClientOptions } from 'ws';

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
const BOTS_DETERMINISTICOS: readonly JogadorCredenciais[] = [
  { email: 'bot-teste-1@exemplo.local', senha: SENHA_PADRAO, apelido: 'bot-teste-1' },
  { email: 'bot-teste-2@exemplo.local', senha: SENHA_PADRAO, apelido: 'bot-teste-2' },
  { email: 'bot-teste-3@exemplo.local', senha: SENHA_PADRAO, apelido: 'bot-teste-3' },
];

function log(prefix: string, ...args: unknown[]): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${prefix}`, ...args);
}

function parseArgs(): { codigo: string; baseUrl: string; emails: string[] | null; senha: string } {
  const raw = process.argv.slice(2).filter((a) => a !== '--');
  let codigo = '';
  let baseUrl = process.env.LOBBY_PUBLIC_URL ?? process.env.LOBBY_URL ?? BASE_PADRAO;
  let emails: string[] | null = null;
  let senha = SENHA_PADRAO;

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
      emails = raw[++i]!.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--emails=')) {
      emails = arg.slice('--emails='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--senha' && raw[i + 1]) {
      senha = raw[++i]!;
    } else if (arg.startsWith('--senha=')) {
      senha = arg.slice('--senha='.length);
    } else if (!arg.startsWith('--') && !codigo) {
      codigo = arg.toUpperCase().trim();
    }
  }

  if (!codigo) {
    console.error('Uso: npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts <CODIGO> [--emails a@x,b@x,c@x] [--senha ...] [--base-url http://localhost:8080]');
    process.exit(1);
  }
  if (!CODIGO_REGEX.test(codigo)) {
    console.error(`Código inválido "${codigo}": esperado 6 caracteres [A-Z0-9]`);
    process.exit(1);
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  return { codigo, baseUrl, emails, senha };
}

function printHelp(): void {
  console.log(`
Uso: npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts <CODIGO> [opções]
     npm run bots -- <CODIGO>  (atalho raiz)
     npm run bots -- <CODIGO>  (dentro de backend/lobby-server)

  CODIGO              Código de Sala (6 chars A-Z0-9)

Opções:
  --emails a,b,c      Emails de contas já criadas (tenta login primeiro)
  --senha SENHA       Senha das contas (padrão: ${SENHA_PADRAO})
  --base-url URL      Base do lobby (padrão: ${BASE_PADRAO} ou env LOBBY_PUBLIC_URL)

Opção C (padrão sem --emails):
  1) login com bot-teste-1..3@exemplo.local
  2) se 401 → register
  3) se 409 → login novamente
  4) se falhar → conta efêmera bot-<timestamp>-<i>@exemplo.local (pode poluir contas; limpar manualmente)

Exemplos:
  npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF
  npm run bots -- ABCDEF
  npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF --emails bot1@x,bot2@x,bot3@x --senha minhasenha
  LOBBY_PUBLIC_URL=http://localhost:8080 npx tsx backend/lobby-server/scripts/bots-entrar-na-sala.ts ABCDEF
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

async function tentarRegister(baseUrl: string, apelido: string, email: string, senha: string): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } } | { conflito: true } | null> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apelido, email, senha }),
  });
  if (res.status === 201) {
    const jogador = (await res.json()) as { id: string; apelido: string; email: string };
    return { cookies: extrairCookies(res), jogador };
  }
  if (res.status === 409) return { conflito: true };
  return null;
}

async function obterCredenciaisBot(
  baseUrl: string,
  cred: JogadorCredenciais,
  indice: number,
): Promise<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> {
  const apelidoBase = cred.apelido;
  const emailBase = cred.email;
  const senha = cred.senha;

  const login1 = await tentarLogin(baseUrl, emailBase, senha);
  if (login1 && login1.cookies.access_token) {
    log(`bot-${indice}`, `login ok (${login1.jogador.apelido})`);
    return login1;
  }

  const reg = await tentarRegister(baseUrl, apelidoBase, emailBase, senha);
  if (reg && 'cookies' in reg && reg.cookies.access_token) {
    log(`bot-${indice}`, `register ok (${reg.jogador.apelido})`);
    return reg;
  }
  if (reg && 'conflito' in reg) {
    const login2 = await tentarLogin(baseUrl, emailBase, senha);
    if (login2 && login2.cookies.access_token) {
      log(`bot-${indice}`, `login após 409 ok (${login2.jogador.apelido})`);
      return login2;
    }
  }

  const sufixo = `${Date.now()}-${indice}-${Math.random().toString(36).slice(2, 6)}`;
  const emailRand = `bot-${sufixo}@exemplo.local`;
  const apelidoRand = `bot-${sufixo}`.slice(0, 20);
  log(`bot-${indice}`, `fallback efêmero ${emailRand} — pode poluir contas; limpar manualmente se falhar sempre`);
  const regRand = await tentarRegister(baseUrl, apelidoRand, emailRand, senha);
  if (regRand && 'cookies' in regRand && regRand.cookies.access_token) {
    log(`bot-${indice}`, `register efêmero ok (${regRand.jogador.apelido})`);
    return regRand;
  }
  throw new Error(`bot-${indice}: falha ao obter credenciais para ${emailBase} (login/register falharam)`);
}

function criarWs(baseUrl: string, codigo: string, cookies: Cookies, jogadorId: string, apelido: string, indice: number): WebSocket {
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
  const MAX_TENTATIVAS_ENTRAR = 1;

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
      if (tentativasEntrar <= MAX_TENTATIVAS_ENTRAR) {
        const delay = 500;
        log(prefix, `retry ENTRAR_NA_SALA em ${delay}ms (single-shot com retry dev)`);
        setTimeout(() => enviarEntrar(), delay);
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
      if (t === 'PARTIDA_PREPARANDO' || t === 'PARTIDA_DISPONIVEL' || t === 'PARTIDA_RECUSADA' || t === 'PARTIDA_FALHOU') {
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
  const { codigo, baseUrl, emails, senha } = parseArgs();
  const credenciais: JogadorCredenciais[] = emails
    ? emails.map((email, i) => ({ email, senha, apelido: email.split('@')[0]!.slice(0, 20) || `bot-${i}` }))
    : BOTS_DETERMINISTICOS.map((b) => ({ ...b, senha }));

  const lista = credenciais.slice(0, 3);
  while (lista.length < 3) {
    const i = lista.length;
    lista.push({ email: `bot-teste-${i + 1}@exemplo.local`, senha, apelido: `bot-teste-${i + 1}` });
  }

  log('main', `código=${codigo} base=${baseUrl} bots=${lista.map((b) => b.email).join(', ')}`);

  const bots: Array<{ cookies: Cookies; jogador: { id: string; apelido: string; email: string } }> = [];
  for (let i = 0; i < lista.length; i++) {
    const cred = lista[i]!;
    try {
      const res = await obterCredenciaisBot(baseUrl, cred, i + 1);
      if (!res.cookies.access_token) throw new Error('sem access_token');
      bots.push(res);
    } catch (e) {
      log(`bot-${i + 1}`, `falha credenciais: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  const sockets: WebSocket[] = [];
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i]!;
    const ws = criarWs(baseUrl, codigo, b.cookies, b.jogador.id, b.jogador.apelido, i + 1);
    sockets.push(ws);
    await new Promise((r) => setTimeout(r, 150));
  }

  log('main', '3 bots conectados, prontidão enviada. Permanecendo conectados — Ctrl+C para sair. (sem keep-alive ping/pong; /ws/lobby é convenção — servidor aceita qualquer path via new WebSocketServer({ server }) em src/ws/ws.ts:70)');

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
