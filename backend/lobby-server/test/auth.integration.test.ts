// Testes de integração de `/api/auth` no lobby-server.
// Estilo: node:test + assert/strict (espelha `backend/game-server/test/encaminhamento.test.ts`).
// Pré-condições: Postgres e Redis acessíveis conforme `getConfig()` (host/porta do .env).
// A suíte assume a tabela `usuarios` migrada e faz TRUNCATE/FLUSHDB entre testes.
//
// Não cobre expiração temporal (TTL de 15min / 7d) — usar TTL curto em ambiente
// é frágil e o caso de rotação já valida o ciclo de vida da Sessão.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { criarClienteRedis } from '@flicker/config';
import { createApp } from '../src/app.ts';
import { pool } from '../src/config/pg.ts';

interface ServidorEfemero {
  baseUrl: string;
  fechar(): Promise<void>;
}

interface Cookies {
  access_token?: string;
  refresh_token?: string;
}

interface JogadorResponse {
  id: string;
  apelido: string;
  email: string;
}

interface ErroResponse {
  erros: Array<{ campo?: 'apelido' | 'email' | 'senha'; mensagem: string }>;
}

const redis = criarClienteRedis();
let appServidor: ReturnType<typeof createApp> | null = null;
let contador = 0;

async function subirServidor(): Promise<ServidorEfemero> {
  if (appServidor === null) {
    appServidor = createApp();
  }
  const server = http.createServer(appServidor);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
  };
}

async function comServidor<T>(executar: (servidor: ServidorEfemero) => Promise<T>): Promise<T> {
  const servidor = await subirServidor();
  try {
    return await executar(servidor);
  } finally {
    await servidor.fechar();
  }
}

function sufixo(): string {
  // Apenas o contador mantém o sufixo curto para não estourar os limites
  // de Apelido (3–20) do contrato OpenAPI.
  contador += 1;
  return `${contador}`;
}

function apelidoUnico(prefixo: string): string {
  // Prefixos devem ser curtos: somados ao sufixo numérico cabem em 20 chars.
  // `jogador` (7) + `-` (1) + sufixo (até ~6 dígitos) = ~14 chars.
  return `${prefixo}-${sufixo()}`;
}

function emailUnico(prefixo: string): string {
  return `${prefixo}-${sufixo()}@exemplo.local`;
}

function extrairCookies(res: Response): Cookies {
  const setCookies = res.headers.getSetCookie();
  const cookies: Cookies = {};
  for (const raw of setCookies) {
    const [par] = raw.split(';');
    if (!par) continue;
    const eq = par.indexOf('=');
    if (eq === -1) continue;
    const nome = par.slice(0, eq).trim();
    const valor = par.slice(eq + 1).trim();
    if (nome === 'access_token' || nome === 'refresh_token') {
      cookies[nome] = valor;
    }
  }
  return cookies;
}

function headerDeCookies(cookies: Cookies): string {
  const partes: string[] = [];
  if (typeof cookies.access_token === 'string') {
    partes.push(`access_token=${cookies.access_token}`);
  }
  if (typeof cookies.refresh_token === 'string') {
    partes.push(`refresh_token=${cookies.refresh_token}`);
  }
  return partes.join('; ');
}

function postJson(baseUrl: string, path: string, corpo: unknown, cookies?: Cookies): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) {
    headers.cookie = cookieHeader;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function getAuth(baseUrl: string, path: string, cookies?: Cookies): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) {
    headers.cookie = cookieHeader;
  }
  return fetch(`${baseUrl}${path}`, { method: 'GET', headers });
}

before(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(`Postgres indisponível para os testes de auth: ${(error as Error).message}`);
  }
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de auth: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit().catch(() => redis.disconnect());
  } else {
    redis.disconnect();
  }
  await pool.end().catch(() => undefined);
  // Garante saída limpa: ioredis/pg podem deixar handles ativos mesmo após
  // quit/end bem-sucedidos em ambiente com tsx + watch de handles.
  setImmediate(() => process.exit(0));
});

beforeEach(async () => {
  // DELETE em vez de TRUNCATE: `usuarios` é referenciada por outras tabelas
  // (ex.: `salas_historico`) e TRUNCATE em cascata apagaria dados não
  // pertinentes aos testes de auth.
  await pool.query('DELETE FROM usuarios');
  await redis.flushdb();
});

function cadastroValido(sobrescreve: Partial<{ apelido: string; email: string; senha: string }> = {}): {
  apelido: string;
  email: string;
  senha: string;
} {
  return {
    apelido: apelidoUnico('jogador'),
    email: emailUnico('jogador'),
    senha: 'senha_dev_123',
    ...sobrescreve,
  };
}

// --- 1. register: 201 + cookies + body Jogador ---

test('register: 201 + cookies httpOnly + body Jogador', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const res = await postJson(servidor.baseUrl, '/api/auth/register', corpo);

    assert.equal(res.status, 201);
    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    const refresh = setCookies.find((c) => c.startsWith('refresh_token='));
    assert.ok(access, 'cookie access_token ausente');
    assert.ok(refresh, 'cookie refresh_token ausente');
    assert.match(access!, /HttpOnly/);
    assert.match(access!, /SameSite=Strict/);
    assert.match(access!, /Path=\//);
    assert.match(refresh!, /HttpOnly/);
    assert.match(refresh!, /SameSite=Strict/);

    const body = (await res.json()) as JogadorResponse;
    assert.equal(body.apelido, corpo.apelido);
    assert.equal(body.email, corpo.email);
    assert.ok(typeof body.id === 'string' && body.id.length > 0);
  });
});

// --- 2. register: 409 com campo=apelido em apelido duplicado ---

test('register: 409 com campo=apelido em apelido duplicado', async () => {
  await comServidor(async (servidor) => {
    const apelido = apelidoUnico('jogador');
    const primeiro = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido,
      email: emailUnico('primeiro'),
      senha: 'senha_dev_123',
    });
    assert.equal(primeiro.status, 201);

    const segundo = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido,
      email: emailUnico('segundo'),
      senha: 'senha_dev_123',
    });
    assert.equal(segundo.status, 409);
    const body = (await segundo.json()) as ErroResponse;
    assert.equal(body.erros.length, 1);
    assert.equal(body.erros[0].campo, 'apelido');
    assert.equal(body.erros[0].mensagem, 'Apelido já está em uso.');
  });
});

// --- 3. register: 409 com campo=email em email duplicado ---

test('register: 409 com campo=email em email duplicado', async () => {
  await comServidor(async (servidor) => {
    const email = emailUnico('compartilhado');
    const primeiro = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email,
      senha: 'senha_dev_123',
    });
    assert.equal(primeiro.status, 201);

    const segundo = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('outro'),
      email,
      senha: 'senha_dev_123',
    });
    assert.equal(segundo.status, 409);
    const body = (await segundo.json()) as ErroResponse;
    assert.equal(body.erros.length, 1);
    assert.equal(body.erros[0].campo, 'email');
    assert.equal(body.erros[0].mensagem, 'Email já está em uso.');
  });
});

// --- 4. register: 400 com campo=apelido em apelido de 2 chars ---

test('register: 400 com campo=apelido em apelido de 2 chars', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: 'ab',
      email: emailUnico('curto'),
      senha: 'senha_dev_123',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ErroResponse;
    const erroApelido = body.erros.find((e) => e.campo === 'apelido');
    assert.ok(erroApelido, 'esperava erro de campo=apelido');
    assert.match(erroApelido!.mensagem, /3 e 20/);
  });
});

// --- 5. register: 400 com campo=apelido em apelido de 21 chars ---

test('register: 400 com campo=apelido em apelido de 21 chars', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: 'a'.repeat(21),
      email: emailUnico('longo'),
      senha: 'senha_dev_123',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ErroResponse;
    const erroApelido = body.erros.find((e) => e.campo === 'apelido');
    assert.ok(erroApelido, 'esperava erro de campo=apelido');
    assert.match(erroApelido!.mensagem, /3 e 20/);
  });
});

// --- 6. register: 400 com campo=email em email sem @ ---

test('register: 400 com campo=email em email sem @', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: 'nao-eh-email',
      senha: 'senha_dev_123',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ErroResponse;
    const erroEmail = body.erros.find((e) => e.campo === 'email');
    assert.ok(erroEmail, 'esperava erro de campo=email');
    assert.match(erroEmail!.mensagem, /email válido/);
  });
});

// --- 7. register: 400 com campo=senha em senha de 7 chars ---

test('register: 400 com campo=senha em senha de 7 chars', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('jogador'),
      senha: 'curta123', // 8 chars na verdade
    });
    // Como 8 chars é o limite, vamos para 7:
    const res2 = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('jogador'),
      senha: 'curta12', // 7 chars
    });
    assert.equal(res.status, 201, '8 chars deve passar');
    assert.equal(res2.status, 400);
    const body = (await res2.json()) as ErroResponse;
    const erroSenha = body.erros.find((e) => e.campo === 'senha');
    assert.ok(erroSenha, 'esperava erro de campo=senha');
    assert.match(erroSenha!.mensagem, /8 caracteres/);
  });
});

// --- 8. register: 400 com múltiplos erros ---

test('register: 400 com múltiplos erros (sem apelido + sem email + senha curta)', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: '',
      email: '',
      senha: 'curta',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ErroResponse;
    const campos = new Set(body.erros.map((e) => e.campo));
    assert.ok(campos.has('apelido'), 'esperava erro de campo=apelido');
    assert.ok(campos.has('email'), 'esperava erro de campo=email');
    assert.ok(campos.has('senha'), 'esperava erro de campo=senha');
    assert.ok(body.erros.length >= 3);
  });
});

// --- 9. register: apelido nos limites 3 e 20 ---

test('register: apelido nos limites 3 e 20 chars ambos OK', async () => {
  await comServidor(async (servidor) => {
    const curto = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: 'abc',
      email: emailUnico('tres'),
      senha: 'senha_dev_123',
    });
    assert.equal(curto.status, 201);

    const longo = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: 'a'.repeat(20),
      email: emailUnico('vinte'),
      senha: 'senha_dev_123',
    });
    assert.equal(longo.status, 201);
  });
});

// --- 10. login: 200 + cookies + body ---

test('login: 200 + cookies + body Jogador', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);

    const res = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: corpo.email,
      senha: corpo.senha,
    });
    assert.equal(res.status, 200);
    const cookies = extrairCookies(res);
    assert.ok(cookies.access_token, 'access_token ausente');
    assert.ok(cookies.refresh_token, 'refresh_token ausente');
    const body = (await res.json()) as JogadorResponse;
    assert.equal(body.email, corpo.email);
  });
});

// --- 11. login: 401 com email inexistente ---

test('login: 401 com email inexistente', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: emailUnico('inexistente'),
      senha: 'senha_dev_123',
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as ErroResponse;
    assert.deepEqual(body, { erros: [{ mensagem: 'Credenciais inválidas.' }] });
  });
});

// --- 12. login: 401 com senha errada ---

test('login: 401 com senha errada', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);

    const res = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: corpo.email,
      senha: 'senha_errada_999',
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as ErroResponse;
    assert.deepEqual(body, { erros: [{ mensagem: 'Credenciais inválidas.' }] });
  });
});

// --- 13. login: 401 com email inexistente e 401 com senha errada têm a mesma forma ---

test('login: 401 com email inexistente e 401 com senha errada têm a mesma forma', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);

    const inexistente = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: emailUnico('fantasma'),
      senha: 'senha_dev_123',
    });
    const errada = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: corpo.email,
      senha: 'senha_errada_999',
    });

    const bodyInexistente = (await inexistente.json()) as ErroResponse;
    const bodyErrada = (await errada.json()) as ErroResponse;
    assert.equal(inexistente.status, 401);
    assert.equal(errada.status, 401);
    assert.strictEqual(bodyInexistente.erros[0].mensagem, bodyErrada.erros[0].mensagem);
  });
});

// --- 14. sessão única: novo login revoga o anterior ---

test('sessão única: novo login revoga o anterior', async () => {
  await comServidor(async (servidor) => {
    const a = cadastroValido({ apelido: apelidoUnico('alpha') });
    const b = cadastroValido({ apelido: apelidoUnico('bravo') });
    const regA = await postJson(servidor.baseUrl, '/api/auth/register', a);
    const regB = await postJson(servidor.baseUrl, '/api/auth/register', b);
    assert.equal(regA.status, 201);
    assert.equal(regB.status, 201);
    const cookiesIniciaisA = extrairCookies(regA);

    // /me com cookies iniciais de A: ok
    const me1 = await getAuth(servidor.baseUrl, '/api/auth/me', cookiesIniciaisA);
    assert.equal(me1.status, 200);

    // novo login de A: novos cookies
    const novoLoginA = await postJson(servidor.baseUrl, '/api/auth/login', {
      email: a.email,
      senha: a.senha,
    });
    assert.equal(novoLoginA.status, 200);
    const cookiesNovosA = extrairCookies(novoLoginA);

    // /me com cookies antigos de A: 401 (Sessão revogada)
    const me2 = await getAuth(servidor.baseUrl, '/api/auth/me', cookiesIniciaisA);
    assert.equal(me2.status, 401);

    // /me com cookies novos de A: 200
    const me3 = await getAuth(servidor.baseUrl, '/api/auth/me', cookiesNovosA);
    assert.equal(me3.status, 200);
  });
});

// --- 15. logout: 204 + Set-Cookie Max-Age=0; /me subsequente → 401 ---

test('logout: 204 + Set-Cookie Max-Age=0; /me subsequente → 401', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);

    const res = await postJson(servidor.baseUrl, '/api/auth/logout', {}, cookies);
    assert.equal(res.status, 204);
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      if (c.startsWith('access_token=') || c.startsWith('refresh_token=')) {
        assert.match(c, /Max-Age=0/);
      }
    }

    const me = await getAuth(servidor.baseUrl, '/api/auth/me', cookies);
    assert.equal(me.status, 401);
  });
});

// --- 16. logout sem cookie: 401 ---

test('logout sem cookie: 401', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/logout', {});
    assert.equal(res.status, 401);
  });
});

// --- 17. /me sem cookie: 401 ---

test('/me sem cookie: 401', async () => {
  await comServidor(async (servidor) => {
    const res = await getAuth(servidor.baseUrl, '/api/auth/me');
    assert.equal(res.status, 401);
  });
});

// --- 18. /me com access válido: 200 + Jogador ---

test('/me com access válido: 200 + Jogador', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);

    const res = await getAuth(servidor.baseUrl, '/api/auth/me', cookies);
    assert.equal(res.status, 200);
    const body = (await res.json()) as JogadorResponse;
    assert.equal(body.email, corpo.email);
    assert.equal(body.apelido, corpo.apelido);
  });
});

// --- 19. /me com access inválido (token lixo): 401 ---

test('/me com access inválido (token lixo): 401', async () => {
  await comServidor(async (servidor) => {
    const res = await getAuth(servidor.baseUrl, '/api/auth/me', {
      access_token: 'isto.nao.eh.um.jwt.valido',
    });
    assert.equal(res.status, 401);
  });
});

// --- 20. refresh: login → usar refresh → novos cookies funcionam; reusar refresh antigo → 401 ---

test('refresh: login → usar refresh → novos cookies funcionam; reusar refresh antigo → 401', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookiesIniciais = extrairCookies(reg);

    const res = await postJson(servidor.baseUrl, '/api/auth/refresh', {}, cookiesIniciais);
    assert.equal(res.status, 200);
    const cookiesNovos = extrairCookies(res);
    assert.ok(cookiesNovos.access_token);
    assert.ok(cookiesNovos.refresh_token);
    assert.notStrictEqual(cookiesNovos.access_token, cookiesIniciais.access_token);
    assert.notStrictEqual(cookiesNovos.refresh_token, cookiesIniciais.refresh_token);

    // reusar o refresh antigo: 401
    const res2 = await postJson(servidor.baseUrl, '/api/auth/refresh', {}, cookiesIniciais);
    assert.equal(res2.status, 401);

    // /me com cookies novos: 200
    const me = await getAuth(servidor.baseUrl, '/api/auth/me', cookiesNovos);
    assert.equal(me.status, 200);
  });
});

// --- 21. refresh sem cookie: 401 ---

test('refresh sem cookie: 401', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(servidor.baseUrl, '/api/auth/refresh', {});
    assert.equal(res.status, 401);
  });
});

// --- 22. refresh com refresh_token forjado (assinatura inválida): 401 ---

test('refresh com refresh_token forjado (assinatura inválida): 401', async () => {
  await comServidor(async (servidor) => {
    const res = await postJson(
      servidor.baseUrl,
      '/api/auth/refresh',
      {},
      { refresh_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.assinatura_invalida' },
    );
    assert.equal(res.status, 401);
  });
});
