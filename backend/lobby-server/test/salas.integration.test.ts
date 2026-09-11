// Testes de integração das Salas no lobby-server (issues #36 e #39).
// Cobre o contrato WS de Sala (CRIAR_SALA, ENTRAR_NA_SALA, SAIR_DA_SALA,
// EXPULSAR_MEMBRO, DESBLOQUEAR_JOGADOR), a persistência em PG (write-model,
// ADR-0002) e a projeção quente em Redis. Estilo: node:test + assert/strict;
// espelha `ws-auth.integration.test.ts`.
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
//
// O harness (servidor efêmero, registro de jogador, conexão WS, esperas e
// hooks de infra) vive em `./helpers/salas-ws.ts` para ser reutilizado por
// `chat.integration.test.ts` (issue #34) sem duplicação.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AnfitriaoSubstituidoEvento,
  CodigoDeErroDaSala,
  ErroDaSalaEvento,
  MembroDaSala,
  MembroExpulsoEvento,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
} from '@flicker/shared';
import {
  configurarHooks,
  redisClient,
  pool,
} from './helpers/salas-ws.ts';

configurarHooks();
import {
  criarContextoDasSalas,
  SalasRepo,
  type CriarContextoOpcoes,
} from '../src/salas/index.ts';
import { chaveJogadorSala, chaveSalaCodigo } from '../src/salas/projecao.ts';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
  contexto: ReturnType<typeof criarContextoDasSalas>;
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
  // Espelha o boot de produção (`index.ts`): rearmar timers a partir do TTL
  // do Redis e confirmar a consistência das Salas reconstruídas — sem isso,
  // testes cross-restart ficariam com Salas inconsistentes para sempre.
  await contexto.handlers.rearmarAposRestart();
  const wss = createWebSocketServer(server, { contextoSalas: contexto });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${endereco.port}`,
    wsUrl: `ws://127.0.0.1:${endereco.port}`,
    contexto,
    fechar: async () => {
      try {
        await contexto.handlers.aguardarMutacoesPendentes();
      } catch {}
      try {
        contexto.handlers.limparTodosTimers();
      } catch {}
      // Fechar WSS primeiro para encerrar sockets WebSocket antes de fechar
      // o HTTP server — sem isso, `server.close()` fica aguardando as
      // conexões de upgrade que nunca fecham sozinhas.
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      // Os closes forçados acima podem enfileirar handleFechamento depois da
      // primeira limpeza; drenar a cadeia e remover timers novamente evita que
      // um timer de servidor fechado dispare após o teardown e expire vínculos
      // no PG sob o teste seguinte.
      try {
        await contexto.handlers.aguardarMutacoesPendentes();
      } catch {}
      try {
        contexto.handlers.limparTodosTimers();
      } catch {}
    },
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

// --- 13. Projeção Redis expira → fallback ao write-model com cura de cache ---

test('ENTRAR_NA_SALA recorre ao PostgreSQL quando a chave do Código expira', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    // Simula a expiração do TTL da projeção quente (ADR-0002: reconstruível).
    assert.equal(await redisClient.del(chaveSalaCodigo(codigo)), 1);

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    const salaB = (eventosB[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaB, b.id).ordemDeEntrada, 2);

    // Cura: a chave de código volta a existir após o fallback.
    const salaIdCurado = await redisClient.get(chaveSalaCodigo(codigo));
    assert.ok(typeof salaIdCurado === 'string' && salaIdCurado.length > 0);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

test('SAIR_DA_SALA recorre ao PostgreSQL quando a associação do Jogador expira', async () => {
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

    // Expira a associação jogador→sala; o vínculo ativo segue no PG.
    assert.equal(await redisClient.del(chaveJogadorSala(b.id)), 1);

    enviar(wsB, { type: 'SAIR_DA_SALA' });
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');

    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');

    // A associação é curada pelo fallback e então removida pela saída.
    const associacaoPosSaida = await redisClient.get(chaveJogadorSala(b.id));
    assert.equal(associacaoPosSaida, null);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 14. Sucessão do Anfitrião sobrevive ao reinício via write-model ---

test('Sucessão do Anfitrião é persistida e restaurada na reconstrução', async () => {
  const codigo = { valor: '' };
  let cookiesB: Cookies | undefined;
  let jogadorIdB = '';

  {
    const servidor = await subirServidor();
    try {
      const a = await registrarJogador(servidor.baseUrl);
      const b = await registrarJogador(servidor.baseUrl);
      cookiesB = b.cookies;
      jogadorIdB = b.id;
      const wsA = await conectarWs(servidor.wsUrl, a.cookies);
      const wsB = await conectarWs(servidor.wsUrl, b.cookies);

      enviar(wsA, { type: 'CRIAR_SALA' });
      const criacao = await esperarSalaAtualizada(wsA);
      codigo.valor = criacao.sala.codigoDeSala;

      enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
      await coletarEventos(wsB, 2);
      await coletarEventos(wsA, 2);

      // A (Anfitrião) sai: sucessão circular escolhe B (ordem seguinte).
      enviar(wsA, { type: 'SAIR_DA_SALA' });
      // MEMBRO_SAIU + SALA_ATUALIZADA + ANFITRIAO_SUBSTITUIDO + SALA_ATUALIZADA.
      await coletarEventos(wsA, 4);
      await coletarEventos(wsB, 4);

      // Contrato novo: o write-model reflete a sucessão no mesmo commit.
      const linha = await pool.query<{ anfitriaoId: string }>(
        `SELECT anfitriao_id AS "anfitriaoId"
         FROM salas_historico
         WHERE codigo_sala = $1 AND status = 'aberta'`,
        [codigo.valor],
      );
      assert.equal(linha.rows[0]?.anfitriaoId, b.id);

      wsA.close();
      wsB.close();
      await Promise.all([
        esperarClose(wsA).catch(() => undefined),
        esperarClose(wsB).catch(() => undefined),
      ]);
    } finally {
      await servidor.fechar();
    }
  }

  // Nova instância reconstrói do PostgreSQL: B permanece Anfitrião.
  // (o boot — carregar + rearmarAposRestart — já confirma a consistência)
  await comServidor(async (servidor) => {
    assert.ok(cookiesB !== undefined, 'cookies de B ausentes');
    const c = await registrarJogador(servidor.baseUrl);
    const wsB = await conectarWs(servidor.wsUrl, cookiesB!);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaC.membros.length, 2);
    assert.equal(salaC.anfitriaoId, membroDaSala(salaC, jogadorIdB).id);

    wsB.close();
    wsC.close();
    await Promise.all([
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
    ]);
  });
});

// --- 15. Saída do Anfitrião anuncia a sucessão no broadcast ---

test('SAIR_DA_SALA do Anfitrião anuncia ANFITRIAO_SUBSTITUIDO com o sucessor', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const membroAnfitriaoOriginal = criacao.sala.membros[0]?.id ?? '';
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // A (Anfitrião) sai: sucessão circular escolhe B (ordem seguinte).
    enviar(wsA, { type: 'SAIR_DA_SALA' });

    const eventosB = await coletarEventos(wsB, 4);
    assert.equal(eventosB[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');
    assert.equal(eventosB[2]?.type, 'ANFITRIAO_SUBSTITUIDO');
    assert.equal(eventosB[3]?.type, 'SALA_ATUALIZADA');

    const sucessao = eventosB[2] as AnfitriaoSubstituidoEvento;
    assert.equal(sucessao.anfitriaoAnteriorId, membroAnfitriaoOriginal);
    const salaFinal = (eventosB[3] as SalaAtualizadaEvento).sala;
    assert.equal(salaFinal.anfitriaoId, membroDaSala(salaFinal, b.id).id);

    // A e C recebem os mesmos 4 eventos.
    await coletarEventos(wsC, 4);
    const eventosA = await coletarEventos(wsA, 4);
    assert.equal(eventosA[2]?.type, 'ANFITRIAO_SUBSTITUIDO');

    for (const ws of [wsA, wsB, wsC]) {
      ws.close();
    }
    await Promise.all(
      [wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)),
    );
  });
});

// --- 16. Código inexistente é recusado sem tocar o write-model ---

test('ENTRAR_NA_SALA com Código inexistente recebe SALA_NAO_ENCONTRADA', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'ENTRAR_NA_SALA', codigoDeSala: 'ZZZZZZ' });
    const erro = await esperarErro(wsA, 'SALA_NAO_ENCONTRADA');
    assert.ok(erro.mensagem.length > 0);

    wsA.close();
    await esperarClose(wsA).catch(() => undefined);
  });
});

// --- 17. Anfitrião expulsa Membro → MEMBRO_EXPULSO + SALA_ATUALIZADA ---

test('EXPULSAR_MEMBRO: Anfitrião expulsa B → todos recebem MEMBRO_EXPULSO + SALA_ATUALIZADA', async () => {
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
    const eventosAEntrada = await coletarEventos(wsA, 2);

    // Extrair membroId de B do evento SALA_ATUALIZADA (o engine gera UUIDs, não determinísticos).
    const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
    const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

    // Anfitrião (A) expulsa B.
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });

    // A recebe MEMBRO_EXPULSO + SALA_ATUALIZADA.
    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_EXPULSO');
    const expulso = eventosA[0] as MembroExpulsoEvento;
    assert.equal(expulso.membroId, membroIdB);
    assert.equal(expulso.jogadorId, b.id);
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');

    // B também recebe MEMBRO_EXPULSO + SALA_ATUALIZADA.
    const eventosB = await coletarEventos(wsB, 2);
    assert.equal(eventosB[0]?.type, 'MEMBRO_EXPULSO');
    assert.equal(eventosB[1]?.type, 'SALA_ATUALIZADA');

    // B não está mais nos membros da sala.
    const salaFinal = (eventosA[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaFinal.membros.length, 1);
    assert.equal(salaFinal.membros.find((m) => m.jogadorId === b.id), undefined);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 18. Jogador expulso impedido de reentrar ---

test('ENTRAR_NA_SALA: jogador expulso recebe JOGADOR_EXPULSO ao tentar reentrar', async () => {
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
    const eventosAEntrada = await coletarEventos(wsA, 2);

    const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
    const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

    // A expulsa B.
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // B fecha e tenta reentrar.
    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
    const wsB2 = await conectarWs(servidor.wsUrl, b.cookies);
    enviar(wsB2, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsB2, 'JOGADOR_EXPULSO');

    wsA.close();
    wsB2.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB2).catch(() => undefined)]);
  });
});

// --- 19. Desbloqueio permite reentrada ---

test('DESBLOQUEAR_JOGADOR + reentrada: desbloqueio permite que B volte à Sala', async () => {
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
    const eventosAEntrada = await coletarEventos(wsA, 2);

    const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
    const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

    // A expulsa B.
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // B tenta reentrar — bloqueado.
    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
    const wsB2 = await conectarWs(servidor.wsUrl, b.cookies);
    enviar(wsB2, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsB2, 'JOGADOR_EXPULSO');
    wsB2.close();
    await esperarClose(wsB2).catch(() => undefined);

    // A desbloqueia B.
    enviar(wsA, { type: 'DESBLOQUEAR_JOGADOR', jogadorId: b.id });
    const eventosDesbloqueio = await coletarEventos(wsA, 1);
    assert.equal(eventosDesbloqueio[0]?.type, 'SALA_ATUALIZADA');

    // B reentra com sucesso — nova ordem de entrada.
    const wsB3 = await conectarWs(servidor.wsUrl, b.cookies);
    enviar(wsB3, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosReentrada = await coletarEventos(wsB3, 2);
    assert.equal(eventosReentrada[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosReentrada[1]?.type, 'SALA_ATUALIZADA');
    const salaReentrada = (eventosReentrada[1] as SalaAtualizadaEvento).sala;
    const membroBReentrada = membroDaSala(salaReentrada, b.id);
    assert.ok(membroBReentrada.ordemDeEntrada > 2, 'ordem deve ser > 2 após reentrada');

    wsA.close();
    wsB3.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB3).catch(() => undefined)]);
  });
});

// --- 20. Não-Anfitrião tenta expulsar → APENAS_ANFITRIAO ---

test('EXPULSAR_MEMBRO: membro comum recebe APENAS_ANFITRIAO ao tentar expulsar', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const membroIdA = criacao.sala.membros[0]?.id ?? '';

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // B (não-Anfitrião) tenta expulsar A.
    enviar(wsB, { type: 'EXPULSAR_MEMBRO', membroId: membroIdA });
    await esperarErro(wsB, 'APENAS_ANFITRIAO');

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 21. Anfitrião tenta expulsar a si mesmo → APENAS_ANFITRIAO ---

test('EXPULSAR_MEMBRO: anfitrião recebe APENAS_ANFITRIAO ao tentar expulsar a si mesmo', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const membroIdA = criacao.sala.membros[0]?.id ?? '';

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // A (Anfitrião) tenta expulsar a si mesmo.
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdA });
    await esperarErro(wsA, 'APENAS_ANFITRIAO');

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 22. Sucessão circular via SAIR_DA_SALA do Anfitrião (3 membros) ---

test('Sucessão circular: A (Anfitrião) sai, B herda o Anfitriato', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const membroAnfitriaoOriginal = criacao.sala.membros[0]?.id ?? '';
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // A (Anfitrião) sai: sucessão circular → B herda.
    enviar(wsA, { type: 'SAIR_DA_SALA' });

    // A recebe: MEMBRO_SAIU + SALA_ATUALIZADA + ANFITRIAO_SUBSTITUIDO + SALA_ATUALIZADA.
    const eventosA = await coletarEventos(wsA, 4);
    assert.equal(eventosA[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');
    assert.equal(eventosA[2]?.type, 'ANFITRIAO_SUBSTITUIDO');
    assert.equal(eventosA[3]?.type, 'SALA_ATUALIZADA');

    const substituicao = eventosA[2] as AnfitriaoSubstituidoEvento;
    assert.equal(substituicao.anfitriaoAnteriorId, membroAnfitriaoOriginal);
    const salaFinal = (eventosA[3] as SalaAtualizadaEvento).sala;
    assert.equal(salaFinal.anfitriaoId, membroDaSala(salaFinal, b.id).id);

    // B e C também recebem os 4 eventos.
    const eventosB = await coletarEventos(wsB, 4);
    assert.equal(eventosB[2]?.type, 'ANFITRIAO_SUBSTITUIDO');
    const eventosC = await coletarEventos(wsC, 4);
    assert.equal(eventosC[2]?.type, 'ANFITRIAO_SUBSTITUIDO');

    for (const ws of [wsA, wsB, wsC]) {
      ws.close();
    }
    await Promise.all(
      [wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)),
    );
  });
});

// --- 23. Expulsão seguida de saída do último membro → sala encerrada ---

test('EXPULSAR_MEMBRO: expulsão seguida de saída do último membro → sala encerrada', async () => {
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
    const eventosAEntrada = await coletarEventos(wsA, 2);

    const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
    const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

    // A expulsa B — B é o único outro membro, mas A ainda está.
    // A Sala não deve encerrar (A continua ativa).
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });
    const eventosAposExpulsao = await coletarEventos(wsA, 2);
    assert.equal(eventosAposExpulsao[0]?.type, 'MEMBRO_EXPULSO');
    const salaAposExpulsao = (eventosAposExpulsao[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaAposExpulsao.estado, 'aberta');
    assert.equal(salaAposExpulsao.membros.length, 1);

    // Agora A sai — Sala ficou sem membros → encerrada.
    enviar(wsA, { type: 'SAIR_DA_SALA' });
    const eventosSaida = await coletarEventos(wsA, 2);
    const salaEncerrada = (eventosSaida[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaEncerrada.estado, 'encerrada');
    assert.deepEqual(salaEncerrada.membros, []);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 24. Desbloquear jogador não bloqueado → JOGADOR_NAO_BLOQUEADO ---

test('DESBLOQUEAR_JOGADOR: desbloquear membro não bloqueado recebe JOGADOR_NAO_BLOQUEADO', async () => {
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

    // A tenta desbloquear B que não foi expulso.
    enviar(wsA, { type: 'DESBLOQUEAR_JOGADOR', jogadorId: b.id });
    await esperarErro(wsA, 'JOGADOR_NAO_BLOQUEADO');

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 25. Expulsão sobrevive ao restart (reconstrução com jogadoresBloqueados) ---

test('Expulsão sobrevive ao restart: reconstrução hidrata jogadoresBloqueados', async () => {
  const codigo = { valor: '' };
  let jogadorA: { id: string; cookies: Cookies } = { id: '', cookies: {} };
  let jogadorB: { id: string; cookies: Cookies } = { id: '', cookies: {} };

  {
    const servidor = await subirServidor();
    try {
      const a = await registrarJogador(servidor.baseUrl);
      const b = await registrarJogador(servidor.baseUrl);
      jogadorA = { id: a.id, cookies: a.cookies };
      jogadorB = { id: b.id, cookies: b.cookies };
      const wsA = await conectarWs(servidor.wsUrl, a.cookies);
      const wsB = await conectarWs(servidor.wsUrl, b.cookies);

      enviar(wsA, { type: 'CRIAR_SALA' });
      const criacao = await esperarSalaAtualizada(wsA);
      codigo.valor = criacao.sala.codigoDeSala;

      enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
      await coletarEventos(wsB, 2);
      const eventosAEntrada = await coletarEventos(wsA, 2);

      const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
      const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

      // A expulsa B.
      enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });
      await coletarEventos(wsA, 2);
      await coletarEventos(wsB, 2);

      // Verificar que B está bloqueado no PG.
      const salaIdRes = await pool.query<{ id: string }>(
        `SELECT id FROM salas_historico WHERE codigo_sala = $1 AND status = 'aberta'`,
        [codigo.valor],
      );
      const salaId = salaIdRes.rows[0]?.id;
      assert.ok(salaId, 'salaId não encontrado');
      const bloqueado = await pool.query<{ bloqueado: boolean }>(
        `SELECT bloqueado FROM membros WHERE sala_id = $1 AND usuario_id = $2`,
        [salaId, b.id],
      );
      assert.equal(bloqueado.rows[0]?.bloqueado, true, 'B deve estar bloqueado no PG');

      wsA.close();
      wsB.close();
      await Promise.all([
        esperarClose(wsA).catch(() => undefined),
        esperarClose(wsB).catch(() => undefined),
      ]);
    } finally {
      await servidor.fechar();
    }
  }

  // Nova instância reconstrói: B não deve aparecer como membro ativo.
  // (o boot — carregar + rearmarAposRestart — já confirma a consistência)
  await comServidor(async (servidor) => {
    const c = await registrarJogador(servidor.baseUrl);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo.valor });
    const eventosC = await coletarEventos(wsC, 2);
    const salaC = (eventosC[1] as SalaAtualizadaEvento).sala;
    // A (host original) + C = 2 membros ativos; B (expulso/bloqueado) não deve aparecer.
    assert.equal(salaC.membros.length, 2, 'A e C devem estar ativos; B não');
    const jogadoresAtivos = salaC.membros.map((m) => m.jogadorId);
    assert.ok(jogadoresAtivos.includes(jogadorA.id), 'A deve estar presente');
    assert.ok(jogadoresAtivos.includes(c.id), 'C deve estar presente');
    assert.ok(!jogadoresAtivos.includes(jogadorB.id), 'B (expulso) não deve estar na lista');

    // B (expulso) retém a ordem 2 no PG. O contador de ordem é monotônico
    // no engine e nunca reutiliza ordens; no boot ele não pode regredir,
    // então C recebe a ordem 3 (não 2).
    assert.equal(membroDaSala(salaC, c.id).ordemDeEntrada, 3);

    wsC.close();
    await esperarClose(wsC).catch(() => undefined);
  });
});

// --- 26. Projeção Redis é atualizada após EXPULSAR_MEMBRO (R2) ---

test('EXPULSAR_MEMBRO atualiza a projeção Redis: expulso some do estado e perde a associação', async () => {
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
    const eventosAEntrada = await coletarEventos(wsA, 2);
    const salaAposEntrada = (eventosAEntrada[1] as SalaAtualizadaEvento).sala;
    const membroIdB = membroDaSala(salaAposEntrada, b.id).id;

    const salaIdRes = await pool.query<{ id: string }>(
      `SELECT id FROM salas_historico WHERE codigo_sala = $1 AND status = 'aberta'`,
      [codigo],
    );
    const salaId = salaIdRes.rows[0]?.id;
    assert.ok(salaId, 'salaId não encontrado');

    const chaveEstado = `lobby:sala:${salaId}:estado`;
    const antes = JSON.parse(
      (await redisClient.get(chaveEstado)) ?? '',
    ) as { membros: Array<{ jogadorId: string }> };
    assert.ok(
      antes.membros.some((m) => m.jogadorId === b.id),
      'B deve estar na projeção antes da expulsão',
    );

    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdB });
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    const depois = JSON.parse(
      (await redisClient.get(chaveEstado)) ?? '',
    ) as { membros: Array<{ jogadorId: string }> };
    assert.equal(depois.membros.length, 1, 'projeção deve listar apenas A após a expulsão');
    assert.ok(
      !depois.membros.some((m) => m.jogadorId === b.id),
      'B não deve constar na projeção pós-expulsão',
    );
    assert.equal(
      await redisClient.get(chaveJogadorSala(b.id)),
      null,
      'a associação jogador→sala de B deve ser removida',
    );

    wsA.close();
    wsB.close();
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
    ]);
  });
});

// --- 27. Autorização: apenas o Anfitrião substituto e desbloqueia ---

test('EXPULSAR_MEMBRO: membro comum recebe APENAS_ANFITRIAO ao tentar expulsar outro membro', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    const eventosBEntradaC = await coletarEventos(wsB, 2);
    const salaCompleta = (eventosBEntradaC[1] as SalaAtualizadaEvento).sala;
    const membroIdC = membroDaSala(salaCompleta, c.id).id;

    // B (não-Anfitrião) tenta expulsar C — rejeitado sem efeito colateral.
    enviar(wsB, { type: 'EXPULSAR_MEMBRO', membroId: membroIdC });
    await esperarErro(wsB, 'APENAS_ANFITRIAO');

    const salaIdRes = await pool.query<{ id: string }>(
      `SELECT id FROM salas_historico WHERE codigo_sala = $1 AND status = 'aberta'`,
      [codigo],
    );
    const salaId = salaIdRes.rows[0]?.id;
    assert.ok(salaId, 'salaId não encontrado');
    const linhas = await pool.query<{ bloqueado: boolean }>(
      `SELECT bloqueado FROM membros WHERE sala_id = $1`,
      [salaId],
    );
    assert.equal(linhas.rows.length, 3, 'A, B e C continuam vínculos');
    assert.deepEqual(
      linhas.rows.map((r) => r.bloqueado),
      [false, false, false],
      'nenhum membro deve ficar bloqueado',
    );

    wsA.close();
    wsB.close();
    wsC.close();
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
    ]);
  });
});

test('DESBLOQUEAR_JOGADOR: membro comum recebe APENAS_ANFITRIAO ao tentar desbloquear', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const c = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    const eventosBEntradaC = await coletarEventos(wsB, 2);
    const salaCompleta = (eventosBEntradaC[1] as SalaAtualizadaEvento).sala;
    const membroIdC = membroDaSala(salaCompleta, c.id).id;

    // A (Anfitrião) expulsa C — C fica bloqueado.
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroIdC });
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);
    await coletarEventos(wsC, 2);

    // B (não-Anfitrião) tenta desbloquear C — rejeitado.
    enviar(wsB, { type: 'DESBLOQUEAR_JOGADOR', jogadorId: c.id });
    await esperarErro(wsB, 'APENAS_ANFITRIAO');

    const salaIdRes = await pool.query<{ id: string }>(
      `SELECT id FROM salas_historico WHERE codigo_sala = $1 AND status = 'aberta'`,
      [codigo],
    );
    const salaId = salaIdRes.rows[0]?.id;
    assert.ok(salaId, 'salaId não encontrado');
    const linhaC = await pool.query<{ bloqueado: boolean }>(
      `SELECT bloqueado FROM membros WHERE sala_id = $1 AND usuario_id = $2`,
      [salaId, c.id],
    );
    assert.equal(linhaC.rows[0]?.bloqueado, true, 'C deve seguir bloqueado no PG');

    wsA.close();
    wsB.close();
    wsC.close();
    await Promise.all([
      esperarClose(wsA).catch(() => undefined),
      esperarClose(wsB).catch(() => undefined),
      esperarClose(wsC).catch(() => undefined),
    ]);
  });
});
