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
import jwt from 'jsonwebtoken';
import { criarClienteRedis, getConfig, SESSION_ISS, SESSION_ACCESS_AUDIENCE, SESSION_REFRESH_AUDIENCE } from '@flicker/config';
import { createApp } from '../src/app.ts';
import { pool } from '../src/config/pg.ts';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';

registrarArquivoDeTeste();

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

async function subirServidorCom(app: ReturnType<typeof createApp>): Promise<ServidorEfemero> {
  const server = http.createServer(app);
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

async function subirServidor(): Promise<ServidorEfemero> {
  if (appServidor === null) {
    appServidor = createApp();
  }
  return subirServidorCom(appServidor);
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
  return `${prefixo}-${sufixo()}@teste.local`;
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

function postJson(
  baseUrl: string,
  path: string,
  corpo: unknown,
  cookies?: Cookies,
  ip?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) {
    headers.cookie = cookieHeader;
  }
  if (ip !== undefined) {
    // Com `trust proxy` = 1, o Express usa o primeiro IP do XFF como req.ip.
    headers['x-forwarded-for'] = ip;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

// Executa com variáveis de ambiente de rate limit sobrescritas e as restaura
// ao final, mesmo em caso de falha — `getConfig()` lê `process.env` a cada
// chamada, então a rota enxerga os valores vigentes no momento do request.
async function comEnv<T>(valores: Record<string, string>, executar: () => Promise<T>): Promise<T> {
  const anteriores = new Map<string, string | undefined>();
  for (const [chave, valor] of Object.entries(valores)) {
    anteriores.set(chave, process.env[chave]);
    process.env[chave] = valor;
  }
  try {
    return await executar();
  } finally {
    for (const [chave, anterior] of anteriores) {
      if (anterior === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = anterior;
      }
    }
  }
}

const CORPO_EXCESSO = { erros: [{ mensagem: 'Muitas tentativas. Tente novamente mais tarde.' }] };

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
  // redisClient (singleton) e pool são encerrados uma única vez via ./teardown.ts
  // quando o último arquivo de teste terminar.
  await finalizarArquivoDeTeste();
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

// --- 22b. Sessão com iss/aud (issue #416): corte seco + tipo trocado ---

test('sessao: access e refresh carregam iss/aud distintos por tipo', async () => {
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido());
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    const access = jwt.decode(cookies.access_token!) as Record<string, unknown>;
    const refresh = jwt.decode(cookies.refresh_token!) as Record<string, unknown>;
    assert.equal(access.iss, SESSION_ISS);
    assert.equal(access.aud, SESSION_ACCESS_AUDIENCE);
    assert.equal(refresh.iss, SESSION_ISS);
    assert.equal(refresh.aud, SESSION_REFRESH_AUDIENCE);
    assert.notEqual(access.aud, refresh.aud);
  });
});

test('/me com access sem iss/aud (token antigo): 401 — corte seco', async () => {
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido());
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    const { jwtSecret } = getConfig();
    // Re-assina o MESMO payload/sessão sem iss/aud: sem o corte seco,
    // passaria (sessão existe no Redis); com iss/aud exigido, cai no 401.
    const payload = jwt.decode(cookies.access_token!) as Record<string, unknown>;
    const legado = jwt.sign(
      { sub: payload.sub, apelido: payload.apelido, email: payload.email, sessaoId: payload.sessaoId },
      jwtSecret,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
    const res = await getAuth(servidor.baseUrl, '/api/auth/me', { access_token: legado });
    assert.equal(res.status, 401);
  });
});

test('/me com access de aud errada (refresh) ou iss errado: 401', async () => {
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido());
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    const { jwtSecret } = getConfig();
    const payload = jwt.decode(cookies.access_token!) as Record<string, unknown>;
    const base = { sub: payload.sub, apelido: payload.apelido, email: payload.email, sessaoId: payload.sessaoId };

    const audErrada = jwt.sign(base, jwtSecret, {
      algorithm: 'HS256', expiresIn: '1h', issuer: SESSION_ISS, audience: SESSION_REFRESH_AUDIENCE,
    });
    assert.equal((await getAuth(servidor.baseUrl, '/api/auth/me', { access_token: audErrada })).status, 401);

    const issErrado = jwt.sign(base, jwtSecret, {
      algorithm: 'HS256', expiresIn: '1h', issuer: 'outro-emissor', audience: SESSION_ACCESS_AUDIENCE,
    });
    assert.equal((await getAuth(servidor.baseUrl, '/api/auth/me', { access_token: issErrado })).status, 401);
  });
});

test('sessao: access como refresh e refresh como access → 401 (tipo trocado)', async () => {
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido());
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);

    // refresh usado como access → 401 no /me
    const me = await getAuth(servidor.baseUrl, '/api/auth/me', { access_token: cookies.refresh_token });
    assert.equal(me.status, 401);

    // access usado como refresh → 401 no /refresh
    const refresh = await postJson(servidor.baseUrl, '/api/auth/refresh', {}, { refresh_token: cookies.access_token });
    assert.equal(refresh.status, 401);
  });
});

test('/refresh com refresh de aud errada (access): 401', async () => {
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido());
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);
    const { jwtRefreshSecret } = getConfig();
    const payload = jwt.decode(cookies.refresh_token!) as Record<string, unknown>;
    const forjado = jwt.sign(
      { sub: payload.sub, sessaoId: payload.sessaoId },
      jwtRefreshSecret,
      { algorithm: 'HS256', expiresIn: '1h', issuer: SESSION_ISS, audience: SESSION_ACCESS_AUDIENCE },
    );
    const res = await postJson(servidor.baseUrl, '/api/auth/refresh', {}, { refresh_token: forjado });
    assert.equal(res.status, 401);
  });
});

// --- 23. concorrência em criarSessao mantém apenas 1 sessão por jogador ---

test('concorrência: N logins paralelos mantêm apenas 1 sessão ativa por jogador', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const jogador = (await reg.json()) as JogadorResponse;

    const N = 5;
    const logins = await Promise.all(
      Array.from({ length: N }, () =>
        postJson(servidor.baseUrl, '/api/auth/login', {
          email: corpo.email,
          senha: corpo.senha,
        }),
      ),
    );
    const statuses = logins.map((r) => r.status);
    if (!statuses.every((s) => s === 200)) {
      const diagnosticBodies = await Promise.all(
        logins.map(async (r, i) => `idx=${i};status=${r.status};body=${await r.text()}`),
      );
      throw new Error(`login concorrente falhou: ${diagnosticBodies.join(' | ')}`);
    }

    // Verifica no Redis: exatamente 1 chave sessao:* (não mapping) deve
    // existir, e o mapping jogador→sessao deve apontar para ela. Os5
    // logins paralelos competem pelo mesmo slot; sem o script Lua atômico
    // ficariam 5 sessões órfãs (TOCTOU) — a fix cobre isso.
    const todas = await redis.keys('sessao:*');
    const chavesSessao = todas.filter(
      (k) => k.startsWith('sessao:') && !k.startsWith('sessao:jogador:'),
    );
    assert.equal(
      chavesSessao.length,
      1,
      `esperava 1 chave sessao:*, encontrei ${chavesSessao.length} (${chavesSessao.join(', ')})`,
    );

    const mapping = await redis.get(`sessao:jogador:${jogador.id}`);
    assert.ok(mapping !== null, 'mapping jogador→sessao ausente');
    assert.ok(
      chavesSessao.includes(`sessao:${mapping}`),
      `mapping (${mapping}) não bate com a única sessão restante`,
    );
  });
});

// --- 24. concorrência em rotacionarSessao consome o refresh exatamente uma vez ---

test('concorrência: 2 refreshes paralelos com o mesmo refresh — exatamente 1 sucesso', async () => {
  await comServidor(async (servidor) => {
    const corpo = cadastroValido();
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', corpo);
    assert.equal(reg.status, 201);
    const cookies = extrairCookies(reg);

    const N = 2;
    const refreshes = await Promise.all(
      Array.from({ length: N }, () =>
        postJson(servidor.baseUrl, '/api/auth/refresh', {}, cookies),
      ),
    );
    const sucessos = refreshes.filter((r) => r.status === 200).length;
    const falhas = refreshes.filter((r) => r.status === 401).length;
    assert.equal(sucessos, 1, `esperava 1 sucesso, encontrei ${sucessos}`);
    assert.equal(falhas, N - 1, `esperava ${N - 1} falhas, encontrei ${falhas}`);
  });
});

// --- 25. login: 429 por IP após exceder AUTH_RATE_LIMIT_MAX_POR_IP ---

test('login: 429 por IP após exceder AUTH_RATE_LIMIT_MAX_POR_IP', async () => {
  await comEnv(
    {
      AUTH_RATE_LIMIT_MAX_POR_IP: '2',
      AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '100',
      AUTH_RATE_LIMIT_JANELA_SEGUNDOS: '900',
    },
    async () => {
      await comServidor(async (servidor) => {
        const ip = '203.0.113.10';
        const credenciais = { email: emailUnico('limite-ip'), senha: 'senha_dev_123' };

        const primeira = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
        const segunda = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
        const terceira = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);

        assert.equal(primeira.status, 401);
        assert.equal(segunda.status, 401);
        assert.equal(terceira.status, 429);
        const retryAfter = terceira.headers.get('retry-after');
        assert.ok(retryAfter !== null, 'esperava header Retry-After');
        assert.ok(Number.isInteger(Number(retryAfter)) && Number(retryAfter) > 0, `Retry-After inválido: ${retryAfter}`);
        assert.deepEqual(await terceira.json(), CORPO_EXCESSO);
      });
    },
  );
});

// --- 26. login: 429 por Cadastro com IPs distintos ---

test('login: 429 por Cadastro quando IPs distintos excedem AUTH_RATE_LIMIT_MAX_POR_CADASTRO', async () => {
  await comEnv(
    { AUTH_RATE_LIMIT_MAX_POR_IP: '100', AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '2' },
    async () => {
      await comServidor(async (servidor) => {
        const credenciais = { email: emailUnico('limite-cadastro'), senha: 'senha_dev_123' };

        const primeira = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, '203.0.113.21');
        const segunda = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, '203.0.113.22');
        const terceira = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, '203.0.113.23');

        assert.equal(primeira.status, 401);
        assert.equal(segunda.status, 401);
        assert.equal(terceira.status, 429);
        assert.deepEqual(await terceira.json(), CORPO_EXCESSO);
      });
    },
  );
});

// --- 27. register: 429 por IP ---

test('register: 429 por IP após exceder AUTH_RATE_LIMIT_MAX_POR_IP', async () => {
  await comEnv({ AUTH_RATE_LIMIT_MAX_POR_IP: '2', AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '100' }, async () => {
    await comServidor(async (servidor) => {
      const ip = '203.0.113.31';
      const primeira = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido(), undefined, ip);
      const segunda = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido(), undefined, ip);
      const terceira = await postJson(servidor.baseUrl, '/api/auth/register', cadastroValido(), undefined, ip);

      assert.equal(primeira.status, 201);
      assert.equal(segunda.status, 201);
      assert.equal(terceira.status, 429);
      assert.ok(terceira.headers.get('retry-after') !== null, 'esperava header Retry-After');
      assert.deepEqual(await terceira.json(), CORPO_EXCESSO);
    });
  });
});

// --- 28. register: 429 por Cadastro com IPs distintos ---

test('register: 429 por Cadastro quando IPs distintos excedem AUTH_RATE_LIMIT_MAX_POR_CADASTRO', async () => {
  await comEnv({ AUTH_RATE_LIMIT_MAX_POR_IP: '100', AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '2' }, async () => {
    await comServidor(async (servidor) => {
      const corpo = {
        apelido: apelidoUnico('jogador'),
        email: emailUnico('limite-cadastro-reg'),
        senha: 'senha_dev_123',
      };
      const primeira = await postJson(servidor.baseUrl, '/api/auth/register', corpo, undefined, '203.0.113.41');
      const segunda = await postJson(servidor.baseUrl, '/api/auth/register', corpo, undefined, '203.0.113.42');
      const terceira = await postJson(servidor.baseUrl, '/api/auth/register', corpo, undefined, '203.0.113.43');

      assert.equal(primeira.status, 201);
      assert.equal(segunda.status, 409);
      assert.equal(terceira.status, 429);
      assert.deepEqual(await terceira.json(), CORPO_EXCESSO);
    });
  });
});

// --- 29. 429 não distingue Cadastro existente de inexistente ---

test('login: 429 não distingue Cadastro existente de inexistente', async () => {
  const existente = cadastroValido();
  await comServidor(async (servidor) => {
    const reg = await postJson(servidor.baseUrl, '/api/auth/register', existente);
    assert.equal(reg.status, 201);
  });

  await comEnv({ AUTH_RATE_LIMIT_MAX_POR_IP: '1', AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '1' }, async () => {
    const respostaExistente = await comServidor(async (servidor) => {
      const ip = '203.0.113.51';
      const credenciais = { email: existente.email, senha: 'senha_errada_999' };
      await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
      return postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
    });

    await redis.flushdb();

    const respostaInexistente = await comServidor(async (servidor) => {
      const ip = '203.0.113.52';
      const credenciais = { email: emailUnico('inexistente-limite'), senha: 'senha_dev_123' };
      await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
      return postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
    });

    assert.equal(respostaExistente.status, 429);
    assert.equal(respostaInexistente.status, 429);
    assert.equal(
      respostaExistente.headers.get('retry-after') !== null,
      respostaInexistente.headers.get('retry-after') !== null,
    );
    assert.deepEqual(await respostaExistente.json(), await respostaInexistente.json());
  });
});

// --- 30. contador sobrevive a nova instância da aplicação (mesmo Redis) ---

test('rate limit: contador persiste em nova instância da aplicação', async () => {
  await comEnv({ AUTH_RATE_LIMIT_MAX_POR_IP: '1', AUTH_RATE_LIMIT_MAX_POR_CADASTRO: '100' }, async () => {
    const ip = '203.0.113.61';
    const credenciais = { email: emailUnico('persistente'), senha: 'senha_dev_123' };

    await comServidor(async (servidor) => {
      const primeira = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
      const segunda = await postJson(servidor.baseUrl, '/api/auth/login', credenciais, undefined, ip);
      assert.equal(primeira.status, 401);
      assert.equal(segunda.status, 429);
    });

    const novaInstancia = await subirServidorCom(createApp());
    try {
      const terceira = await postJson(novaInstancia.baseUrl, '/api/auth/login', credenciais, undefined, ip);
      assert.equal(terceira.status, 429, 'nova instância deve enxergar o contador no Redis');
      assert.deepEqual(await terceira.json(), CORPO_EXCESSO);
    } finally {
      await novaInstancia.fechar();
    }
  });
});

// --- 31. register: senha acima de 72 bytes (UTF-8) é recusada ---

test('register: 400 com campo=senha para senha acima de 72 bytes', async () => {
  await comServidor(async (servidor) => {
    const ascii = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('senha-73'),
      senha: 'a'.repeat(73),
    });
    assert.equal(ascii.status, 400);
    const bodyAscii = (await ascii.json()) as ErroResponse;
    const erroAscii = bodyAscii.erros.find((e) => e.campo === 'senha');
    assert.ok(erroAscii, 'esperava erro de campo=senha');
    assert.equal(erroAscii!.mensagem, 'A senha excede o limite de 72 bytes (UTF-8).');

    const multibyte = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('senha-74'),
      senha: 'é'.repeat(37), // 37 × 2 bytes = 74 bytes
    });
    assert.equal(multibyte.status, 400);
    const bodyMultibyte = (await multibyte.json()) as ErroResponse;
    const erroMultibyte = bodyMultibyte.erros.find((e) => e.campo === 'senha');
    assert.ok(erroMultibyte, 'esperava erro de campo=senha multibyte');
    assert.equal(erroMultibyte!.mensagem, 'A senha excede o limite de 72 bytes (UTF-8).');
  });
});

// --- 32. register: senha de exatamente 72 bytes (UTF-8) é aceita ---

test('register: 201 para senha de exatamente 72 bytes', async () => {
  await comServidor(async (servidor) => {
    const ascii = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('senha-72'),
      senha: 'a'.repeat(72),
    });
    assert.equal(ascii.status, 201);

    const multibyte = await postJson(servidor.baseUrl, '/api/auth/register', {
      apelido: apelidoUnico('jogador'),
      email: emailUnico('senha-72mb'),
      senha: 'é'.repeat(36), // 36 × 2 bytes = 72 bytes
    });
    assert.equal(multibyte.status, 201);
  });
});

// --- 33. respostas não expõem X-Powered-By (medida OWASP G5) ---

test('respostas não expõem X-Powered-By', async () => {
  await comServidor(async (servidor) => {
    // Resposta de sucesso conhecida.
    const health = await getAuth(servidor.baseUrl, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-powered-by'), null);

    // Resposta 404 gerada pelo handler default do Express — o vetor do
    // vazamento observado em produção (issue #413).
    const inexistente = await getAuth(servidor.baseUrl, '/api/nao-existe');
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.headers.get('x-powered-by'), null);
  });
});
