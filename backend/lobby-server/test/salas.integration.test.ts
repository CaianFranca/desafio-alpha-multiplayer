// Testes de integração das Salas no lobby-server (issue #36, ST-06).
// Cobre o contrato WS de Sala (CRIAR_SALA, ENTRAR_NA_SALA, SAIR_DA_SALA),
// a persistência em PG (write-model, ADR-0002) e a projeção quente em
// Redis. Estilo: node:test + assert/strict; espelha
// `ws-auth.integration.test.ts`.
//
// Pré-condições: Postgres e Redis acessíveis via `getConfig()` (profile
// `backend` do compose). TRUNCATE+FLUSHDB entre testes, com cuidado
// para `salas_historico` que é referenciada por FKs (DELETE em vez de
// TRUNCATE para não cascatear em tabelas não pertinentes).
//
// Os cenários cobrem o quadro do plano. Casos fora do escopo (comandos
// `ALTERNAR_PRONTIDAO`, `ENVIAR_MENSAGEM_DE_CHAT`, etc.) são respondidos
// com `ERRO_DA_SALA { codigo: 'DADOS_INVALIDOS' }` — não há teste
// dedicado porque o handler é uma só ramificação `default` do switch.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import type {
  CodigoDeErroDaSala,
  ErroDaSalaEvento,
  MembroDaSala,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { redisClient } from '../src/config/redis.ts';
import {
  criarContextoDasSalas,
  SalasRepo,
  type CriarContextoOpcoes,
} from '../src/salas/index.ts';

interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
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

interface EsperaDeMensagem {
  readonly resolver: (raw: string) => void;
  readonly rejeitar: (erro: Error) => void;
}

interface CaixaDeMensagens {
  readonly mensagens: string[];
  readonly esperas: EsperaDeMensagem[];
}

const redis = criarClienteRedis();
const caixasDeMensagens = new WeakMap<WebSocket, CaixaDeMensagens>();
let appServidor: ReturnType<typeof createApp> | null = null;
let contador = 0;

async function subirServidor(opcoesDeSalas: CriarContextoOpcoes = {}): Promise<ServidorEfemero> {
  if (appServidor === null) {
    appServidor = createApp();
  }
  const app = appServidor;
  const server = http.createServer(app);
  const contexto = criarContextoDasSalas(opcoesDeSalas);
  await contexto.estado.carregar(contexto.repo, contexto.projecao);
  createWebSocketServer(server, { contextoSalas: contexto });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    wsUrl: `ws://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function comServidor<T>(
  executar: (servidor: ServidorEfemero) => Promise<T>,
  opcoesDeSalas: CriarContextoOpcoes = {},
): Promise<T> {
  const servidor = await subirServidor(opcoesDeSalas);
  try {
    return await executar(servidor);
  } finally {
    await servidor.fechar();
  }
}

class RepositorioComFalhaNaSaida extends SalasRepo {
  override async sairMembroAtomico(
    ..._args: Parameters<SalasRepo['sairMembroAtomico']>
  ): Promise<void> {
    throw new Error('falha simulada na persistência de saída');
  }
}

class RepositorioComCriacaoPausada extends SalasRepo {
  private pausarPrimeiraCriacao = true;
  private liberarCriacaoInterna: (() => void) | null = null;
  private sinalizarPrimeiraCriacao!: () => void;
  readonly primeiraCriacaoIniciada = new Promise<void>((resolve) => {
    this.sinalizarPrimeiraCriacao = resolve;
  });

  liberarCriacao(): void {
    this.liberarCriacaoInterna?.();
  }

  override async criarSalaAtomica(
    ...args: Parameters<SalasRepo['criarSalaAtomica']>
  ): Promise<void> {
    if (this.pausarPrimeiraCriacao) {
      this.pausarPrimeiraCriacao = false;
      this.sinalizarPrimeiraCriacao();
      await new Promise<void>((resolve) => {
        this.liberarCriacaoInterna = resolve;
      });
    }
    await super.criarSalaAtomica(...args);
  }
}

function sufixo(): string {
  contador += 1;
  return `${contador}`;
}

function apelidoUnico(prefixo: string): string {
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

function postJson(
  baseUrl: string,
  path: string,
  corpo: unknown,
  cookies?: Cookies,
): Promise<Response> {
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

function cadastroValido(): {
  apelido: string;
  email: string;
  senha: string;
} {
  return {
    apelido: apelidoUnico('jogador'),
    email: emailUnico('jogador'),
    senha: 'senha_dev_123',
  };
}

async function registrarJogador(baseUrl: string): Promise<{ id: string; cookies: Cookies; apelido: string }> {
  const corpo = cadastroValido();
  const res = await postJson(baseUrl, '/api/auth/register', corpo);
  // Lê o corpo uma única vez; `fetch` em Node 24 não permite ler duas vezes.
  const texto = await res.text();
  assert.equal(res.status, 201, `register falhou: ${texto}`);
  const jogador = JSON.parse(texto) as JogadorResponse;
  return { id: jogador.id, cookies: extrairCookies(res), apelido: jogador.apelido };
}

function conectarWs(wsUrl: string, cookies?: Cookies): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const cookieHeader = headerDeCookies(cookies ?? {});
    if (cookieHeader.length > 0) {
      headers.Cookie = cookieHeader;
    }
    const ws = new WebSocket(wsUrl, { headers } as never);
    const caixa: CaixaDeMensagens = { mensagens: [], esperas: [] };
    caixasDeMensagens.set(ws, caixa);
    ws.on('message', (data) => {
      const raw = data.toString();
      const espera = caixa.esperas.shift();
      if (espera !== undefined) {
        espera.resolver(raw);
      } else {
        caixa.mensagens.push(raw);
      }
    });
    ws.on('error', (erro) => {
      for (const espera of caixa.esperas.splice(0)) {
        espera.rejeitar(erro);
      }
    });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout ao conectar WS'));
    }, 3000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.once('close', (code) => {
      clearTimeout(timeout);
      reject(new Error(`close prematuro code=${code}`));
    });
  });
}

function esperarClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout ao esperar close'));
    }, timeoutMs);
    ws.once('close', (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function esperarMensagem(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const caixa = caixasDeMensagens.get(ws);
    assert.ok(caixa, 'socket sem caixa de mensagens');
    const mensagem = caixa.mensagens.shift();
    if (mensagem !== undefined) {
      resolve(mensagem);
      return;
    }

    const espera: EsperaDeMensagem = {
      resolver: (raw) => {
        clearTimeout(timeout);
        resolve(raw);
      },
      rejeitar: (erro) => {
        clearTimeout(timeout);
        reject(erro);
      },
    };
    const timeout = setTimeout(() => {
      const indice = caixa.esperas.indexOf(espera);
      if (indice >= 0) {
        caixa.esperas.splice(indice, 1);
      }
      reject(new Error('timeout mensagem'));
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}

function esperarSilencio(ws: WebSocket, timeoutMs = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const caixa = caixasDeMensagens.get(ws);
    assert.ok(caixa, 'socket sem caixa de mensagens');
    const mensagem = caixa.mensagens.shift();
    if (mensagem !== undefined) {
      reject(new Error(`evento inesperado: ${mensagem}`));
      return;
    }

    const espera: EsperaDeMensagem = {
      resolver: (raw) => {
        clearTimeout(timeout);
        reject(new Error(`evento inesperado: ${raw}`));
      },
      rejeitar: (erro) => {
        clearTimeout(timeout);
        reject(erro);
      },
    };
    const timeout = setTimeout(() => {
      const indice = caixa.esperas.indexOf(espera);
      if (indice >= 0) {
        caixa.esperas.splice(indice, 1);
      }
      resolve();
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}

function enviar(ws: WebSocket, comando: object): void {
  ws.send(JSON.stringify(comando));
}

async function esperarSalaAtualizada(ws: WebSocket, timeoutMs = 2000): Promise<SalaAtualizadaEvento> {
  const raw = await esperarMensagem(ws, timeoutMs);
  const evento = JSON.parse(raw) as SalaEventoDoServidor;
  assert.equal(evento.type, 'SALA_ATUALIZADA', `esperava SALA_ATUALIZADA, recebeu ${evento.type}`);
  return evento as SalaAtualizadaEvento;
}

async function esperarErro(ws: WebSocket, codigoEsperado: CodigoDeErroDaSala, timeoutMs = 2000): Promise<ErroDaSalaEvento> {
  const raw = await esperarMensagem(ws, timeoutMs);
  const evento = JSON.parse(raw) as ErroDaSalaEvento;
  assert.equal(evento.type, 'ERRO_DA_SALA', `esperava ERRO_DA_SALA, recebeu ${evento.type}`);
  assert.equal(evento.codigo, codigoEsperado, `esperava codigo=${codigoEsperado}, recebeu ${evento.codigo}`);
  return evento;
}

async function coletarEventos(ws: WebSocket, n: number, timeoutMs = 3000): Promise<SalaEventoDoServidor[]> {
  const eventos: SalaEventoDoServidor[] = [];
  for (let i = 0; i < n; i++) {
    const raw = await esperarMensagem(ws, timeoutMs);
    eventos.push(JSON.parse(raw) as SalaEventoDoServidor);
  }
  return eventos;
}

function membroDaSala(sala: Sala, jogadorId: string): MembroDaSala {
  const membro = sala.membros.find((m) => m.jogadorId === jogadorId);
  assert.ok(membro, `jogadorId ${jogadorId} não está em membros`);
  return membro;
}

before(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(`Postgres indisponível para testes de salas: ${(error as Error).message}`);
  }
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para testes de salas: ${(error as Error).message}`);
  }
});

after(async () => {
  try {
    await redis.quit().catch(() => {
      try {
        redis.disconnect();
      } catch {}
    });
  } catch {
    try {
      redis.disconnect();
    } catch {}
  }
  try {
    await redisClient.quit().catch(() => {
      try {
        redisClient.disconnect();
      } catch {}
    });
  } catch {
    try {
      redisClient.disconnect();
    } catch {}
  }
  await pool.end().catch(() => undefined);
});

beforeEach(async () => {
  // TRUNCATE em uma única declaração é atômico e respeita FKs via
  // CASCADE — substitui o DELETE sequencial anterior que sofria race
  // condition entre workers paralelos de `--test`. Sem o CASCADE, o
  // `DELETE FROM usuarios` falhava com FK violation quando outro
  // worker ainda tinha uma `salas_historico` apontando para o usuário.
  await pool.query(
    `TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

// --- 1. CRIAR_SALA por jogador A → SALA_ATUALIZADA com A em ordem 1 ---

test('CRIAR_SALA: A cria sala, recebe SALA_ATUALIZADA com A em ordem 1 e anfitrião', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const evento = await esperarSalaAtualizada(wsA);

    assert.match(evento.sala.codigoDeSala, /^[A-Z0-9]{6}$/);
    assert.equal(evento.sala.estado, 'aberta');
    assert.equal(evento.sala.membros.length, 1);
    const membroA = membroDaSala(evento.sala, a.id);
    assert.equal(membroA.ordemDeEntrada, 1);
    assert.equal(membroA.jogadorId, a.id);
    assert.equal(evento.sala.anfitriaoId, membroA.id);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

test('CRIAR_SALA revalida a Sessão no Redis antes de criar vínculo', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    const logout = await postJson(servidor.baseUrl, '/api/auth/logout', {}, a.cookies);
    assert.equal(logout.status, 204);

    const close = esperarClose(wsA);
    enviar(wsA, { type: 'CRIAR_SALA' });
    assert.equal((await close).code, 4401);
  });
});

test('CRIAR_SALA repete Código de Sala após colisão e monta Convite público', async () => {
  const codigos = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const salaA = await esperarSalaAtualizada(wsA);
    assert.equal(salaA.sala.codigoDeSala, 'AAAAAA');

    enviar(wsB, { type: 'CRIAR_SALA' });
    const salaB = await esperarSalaAtualizada(wsB);
    assert.equal(salaB.sala.codigoDeSala, 'BBBBBB');
    assert.equal(salaB.sala.convite.link, 'https://lobby.exemplo.test/convite/BBBBBB');

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  }, {
    gerarCodigo: () => codigos.shift() ?? 'CCCCCC',
    linkBase: 'https://lobby.exemplo.test/convite',
  });
});

test('CRIAR_SALA revalida a Sessão depois de aguardar uma mutação anterior', async () => {
  const repo = new RepositorioComCriacaoPausada();
  let jogadorRevogado: string | null = null;
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    await repo.primeiraCriacaoIniciada;

    enviar(wsB, { type: 'CRIAR_SALA' });
    jogadorRevogado = b.id;
    const closeB = esperarClose(wsB);
    repo.liberarCriacao();

    await esperarSalaAtualizada(wsA);
    assert.equal((await closeB).code, 4401);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  }, {
    repo,
    revalidarSessao: async (_sessaoId, jogadorId) => jogadorId !== jogadorRevogado,
  });
});

// --- 2. A entra com próprio codigoDeSala → idempotente ---

test('CRIAR_SALA + ENTRAR_NA_SALA pelo próprio A é idempotente', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // O engine trata ENTRAR_NA_SALA por jogador já ativo como no-op
    // (sucesso sem eventos). Sem broadcast no socket de A.
    enviar(wsA, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsA);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

// --- 3. B entra com codigoDeSala → MEMBRO_ENTROU + SALA_ATUALIZADA, ordem=2 ---

test('ENTRAR_NA_SALA: B entra na sala de A → MEMBRO_ENTROU + SALA_ATUALIZADA com ordem=2', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    // B recebe MEMBRO_ENTROU e SALA_ATUALIZADA (2 eventos).
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    const membroB = membroDaSala((eventosB[1] as SalaAtualizadaEvento).sala, b.id);
    assert.equal(membroB.ordemDeEntrada, 2);

    // A recebe MEMBRO_ENTROU e SALA_ATUALIZADA.
    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');
    assert.equal((eventosA[1] as SalaAtualizadaEvento).sala.membros.length, 2);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

test('ENTRAR_NA_SALA revalida a Sessão no Redis antes de adicionar vínculo', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);

    const logout = await postJson(servidor.baseUrl, '/api/auth/logout', {}, b.cookies);
    assert.equal(logout.status, 204);

    const close = esperarClose(wsB);
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    assert.equal((await close).code, 4401);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

// --- 4. C, D entram com codigoDeSala → ordens 3 e 4 ---

test('ENTRAR_NA_SALA: C e D entram em sequência, ordens 3 e 4', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaC, c.id).ordemDeEntrada, 3);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    enviar(wsD, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosD = await coletarEventos(wsD, 2);
    const salaD = (eventosD[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaD, d.id).ordemDeEntrada, 4);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);
    await coletarEventos(wsC, 2);

    wsA.close();
    wsB.close();
    wsC.close();
    wsD.close();
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
    ]);
  });
});

// --- 5. E entra com codigoDeSala → ERRO_DA_SALA { codigo: 'SALA_CHEIA' } ---

test('ENTRAR_NA_SALA: 5º jogador recebe ERRO_DA_SALA SALA_CHEIA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const e = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);
    const wsE = await conectarWs(servidor.wsUrl, e.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    for (const ws of [wsB, wsC, wsD]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
      await coletarEventos(ws, 2);
    }
    // Drena broadcasts de A.
    await coletarEventos(wsA, 6);
    await coletarEventos(wsB, 4);
    await coletarEventos(wsC, 2);

    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsE, 'SALA_CHEIA');

    for (const ws of [wsA, wsB, wsC, wsD, wsE]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
      esperarClose(wsE).catch(() => undefined),
    ]);
  });
});

// --- 6. Concorrência: 4 sockets em paralelo, 1 entra, 3 recebem SALA_CHEIA ---

test('ENTRAR_NA_SALA: 4 sockets em paralelo, exatamente 1 entra e 3 recebem SALA_CHEIA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const concorrentes = [
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
      await registrarJogador(servidor.baseUrl),
    ];
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsConcorrentes = await Promise.all(
      concorrentes.map((j) => conectarWs(servidor.wsUrl, j.cookies)),
    );

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    for (const ws of [wsB, wsC]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    }
    await Promise.all([
      coletarEventos(wsB, 2),
      coletarEventos(wsC, 2),
    ]);
    await coletarEventos(wsA, 4);

    // Dispara 4 ENTRAR_NA_SALA em paralelo — apenas 1 deve entrar.
    for (const ws of wsConcorrentes) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    }

    // Cada socket recebe OU (MEMBRO_ENTROU + SALA_ATUALIZADA) OU ERRO_DA_SALA.
    const resultados = await Promise.all(
      wsConcorrentes.map(async (ws) => {
        const raw = await esperarMensagem(ws, 2000);
        return JSON.parse(raw) as SalaEventoDoServidor;
      }),
    );

    const sucessos = resultados.filter((e) => e.type === 'MEMBRO_ENTROU');
    const erros = resultados.filter((e) => e.type === 'ERRO_DA_SALA');
    assert.equal(sucessos.length, 1, `esperava 1 MEMBRO_ENTROU, recebi ${sucessos.length}`);
    assert.equal(erros.length, 3, `esperava 3 ERRO_DA_SALA, recebi ${erros.length}`);
    for (const erro of erros) {
      assert.equal((erro as ErroDaSalaEvento).codigo, 'SALA_CHEIA');
    }

    for (const ws of [wsA, wsB, wsC, ...wsConcorrentes]) {
      ws.close();
    }
    await Promise.all(
      [wsA, wsB, wsC, ...wsConcorrentes].map((ws) =>
        esperarClose(ws).catch(() => undefined),
      ),
    );
  });
});

// --- 7. B reenvia ENTRAR_NA_SALA → idempotente (sem evento broadcast) ---

test('ENTRAR_NA_SALA: reenvio pelo próprio B é idempotente (sem broadcast)', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // B reenvia — engine trata como no-op (membro já ativo). Sem broadcast.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsB);

    // A também não recebe nada.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarSilencio(wsA);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 8. C em sala ativa tenta entrar em outra → ERRO_DA_SALA { codigo: 'JOGADOR_JA_ASSOCIADO' } ---

test('ENTRAR_NA_SALA: jogador já associado a outra sala recebe JOGADOR_JA_ASSOCIADO', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const salaA = await esperarSalaAtualizada(wsA);
    const codigoA = salaA.sala.codigoDeSala;

    enviar(wsB, { type: 'CRIAR_SALA' });
    const salaB = await esperarSalaAtualizada(wsB);
    const codigoB = salaB.sala.codigoDeSala;

    // C entra na sala de B.
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoB });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsB, 2);

    // C tenta entrar na sala de A — engine rejeita.
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoA });
    await esperarErro(wsC, 'JOGADOR_JA_ASSOCIADO');

    // Garante que A não recebeu broadcast da tentativa de C.
    enviar(wsD, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigoA });
    await coletarEventos(wsD, 2);
    await coletarEventos(wsA, 2);

    for (const ws of [wsA, wsB, wsC, wsD]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
    ]);
  });
});

// --- 9. B envia SAIR_DA_SALA → MEMBRO_SAIU + SALA_ATUALIZADA ---

test('SAIR_DA_SALA: B sai, A, C, D recebem MEMBRO_SAIU + SALA_ATUALIZADA, vaga liberada', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const d = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    for (const ws of [wsB, wsC, wsD]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
      await coletarEventos(ws, 2);
    }
    await coletarEventos(wsA, 6);
    await coletarEventos(wsB, 4);
    await coletarEventos(wsC, 2);

    // B sai.
    enviar(wsB, { type: 'SAIR_DA_SALA' });
    // B recebe MEMBRO_SAIU + SALA_ATUALIZADA.
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    // A, C, D também recebem os 2 eventos.
    for (const ws of [wsA, wsC, wsD]) {
      const eventos = await coletarEventos(ws, 2);
      assert.equal(eventos[0]?.type, 'MEMBRO_SAIU');
      assert.equal(eventos[1]?.type, 'SALA_ATUALIZADA');
    }
    // B não está mais nos membros da sala atualizada.
    const salaAtualizada = (eventosB[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaAtualizada.membros.length, 3);
    assert.equal(salaAtualizada.membros.find((m) => m.jogadorId === b.id), undefined);

    // Vaga liberada: novo jogador E entra com sucesso.
    const e = await registrarJogador(servidor.baseUrl);
    const wsE = await conectarWs(servidor.wsUrl, e.cookies);
    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosE = await coletarEventos(wsE, 2);
    const salaE = (eventosE[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaE.membros.length, 4);
    assert.equal(membroDaSala(salaE, e.id).ordemDeEntrada, 5);

    for (const ws of [wsA, wsB, wsC, wsD, wsE]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
      esperarClose(wsD).catch(() => undefined),
      esperarClose(wsE).catch(() => undefined),
    ]);
  });
});

// --- 10. Última saída anuncia a Sala encerrada ---

test('SAIR_DA_SALA: última saída anuncia SALA_ATUALIZADA encerrada e sem Membros', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsA, { type: 'SAIR_DA_SALA' });
    const eventosDeA = await coletarEventos(wsA, 2);
    const salaFinal = eventosDeA[1] as SalaAtualizadaEvento;
    assert.equal(salaFinal.type, 'SALA_ATUALIZADA');
    assert.equal(salaFinal.sala.estado, 'encerrada');
    assert.deepEqual(salaFinal.sala.membros, []);

    for (const ws of [wsA, wsB]) {
      ws.close();
    }
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
    ]);
  });
});

test('SAIR_DA_SALA não altera a Sala em memória quando a transação falha', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    await esperarErro(wsB, 'DADOS_INVALIDOS');

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: criacao.sala.codigoDeSala });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.ok(
      salaC.membros.some((membro) => membro.jogadorId === b.id),
      'B deve permanecer na Sala depois de rollback da saída',
    );

    for (const ws of [wsA, wsB, wsC]) {
      ws.close();
    }
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { repo: new RepositorioComFalhaNaSaida() });
});

// --- 11. Todos recebem SALA_ATUALIZADA em todas as mutações ---

test('Broadcast: cada mutação emite SALA_ATUALIZADA para todos os membros', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // B entra → A recebe MEMBRO_ENTROU + SALA_ATUALIZADA, B idem.
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const evB1 = await coletarEventos(wsB, 2);
    assert.equal(evB1[1]?.type, 'SALA_ATUALIZADA');
    const evA1 = await coletarEventos(wsA, 2);
    assert.equal(evA1[1]?.type, 'SALA_ATUALIZADA');

    // B sai → ambos recebem MEMBRO_SAIU + SALA_ATUALIZADA.
    enviar(wsB, { type: 'SAIR_DA_SALA' });
    const evB2 = await coletarEventos(wsB, 2);
    assert.equal(evB2[1]?.type, 'SALA_ATUALIZADA');
    const evA2 = await coletarEventos(wsA, 2);
    assert.equal(evA2[1]?.type, 'SALA_ATUALIZADA');

    for (const ws of [wsA, wsB]) {
      ws.close();
    }
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 12. Geração: 30 Salas produzem Códigos válidos e distintos ---

test('Geração: 30 salas geradas produzem Códigos válidos e únicos', async () => {
  await comServidor(async (servidor) => {
    const N = 30;
    const jogadores = await Promise.all(
      Array.from({ length: N }, () => registrarJogador(servidor.baseUrl)),
    );
    const sockets = await Promise.all(
      jogadores.map((j) => conectarWs(servidor.wsUrl, j.cookies)),
    );

    const eventos = await Promise.all(
      sockets.map(async (ws) => {
        enviar(ws, { type: 'CRIAR_SALA' });
        const ev = await esperarSalaAtualizada(ws);
        assert.match(ev.sala.codigoDeSala, /^[A-Z0-9]{6}$/);
        return ev;
      }),
    );
    const unicos = new Set(eventos.map((evento) => evento.sala.codigoDeSala));
    assert.equal(unicos.size, N, `esperava ${N} codigos únicos, encontrei ${unicos.size}`);

    for (const ws of sockets) {
      ws.close();
    }
    await Promise.all(sockets.map((ws) => esperarClose(ws).catch(() => undefined)));
  });
});
