// Presença e reconexão — janela 60s (issue #38).
// Testes de integração via seam WS com PG/Redis reais, espelhando
// `salas.integration.test.ts`. Cada critério da issue #38 tem teste dedicado.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';

registrarArquivoDeTeste();

import type {
  CodigoDeErroDaSala,
  ErroDaSalaEvento,
  MembroDaSala,
  MembroDesconectadoEvento,
  MembroReconectadoEvento,
  MembroSaiuEvento,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
  AnfitriaoSubstituidoEvento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { redisClient } from '../src/config/redis.ts';
import {
  criarContextoDasSalas,
  type CriarContextoOpcoes,
} from '../src/salas/index.ts';
import { chaveReconexao } from '../src/salas/reconexao.ts';
import { chaveJogadorSala } from '../src/salas/projecao.ts';
import { serializarSala } from '../src/salas/projecao.ts';

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
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
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
  if (typeof cookies.access_token === 'string') partes.push(`access_token=${cookies.access_token}`);
  if (typeof cookies.refresh_token === 'string') partes.push(`refresh_token=${cookies.refresh_token}`);
  return partes.join('; ');
}
function postJson(baseUrl: string, path: string, corpo: unknown, cookies?: Cookies): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const cookieHeader = headerDeCookies(cookies ?? {});
  if (cookieHeader.length > 0) headers.cookie = cookieHeader;
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}
function cadastroValido(): { apelido: string; email: string; senha: string } {
  return { apelido: apelidoUnico('jogador'), email: emailUnico('jogador'), senha: 'senha_dev_123' };
}
async function registrarJogador(baseUrl: string): Promise<{ id: string; cookies: Cookies; apelido: string }> {
  const corpo = cadastroValido();
  const res = await postJson(baseUrl, '/api/auth/register', corpo);
  const texto = await res.text();
  assert.equal(res.status, 201, `register falhou: ${texto}`);
  const jogador = JSON.parse(texto) as JogadorResponse;
  return { id: jogador.id, cookies: extrairCookies(res), apelido: jogador.apelido };
}
function conectarWs(wsUrl: string, cookies?: Cookies): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const cookieHeader = headerDeCookies(cookies ?? {});
    if (cookieHeader.length > 0) headers.Cookie = cookieHeader;
    const ws = new WebSocket(wsUrl, { headers } as never);
    const caixa: CaixaDeMensagens = { mensagens: [], esperas: [] };
    caixasDeMensagens.set(ws, caixa);
    ws.on('message', (data) => {
      const raw = data.toString();
      const espera = caixa.esperas.shift();
      if (espera !== undefined) espera.resolver(raw);
      else caixa.mensagens.push(raw);
    });
    ws.on('error', (erro) => {
      for (const espera of caixa.esperas.splice(0)) espera.rejeitar(erro);
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
function esperarMensagem(ws: WebSocket, timeoutMs = 3000): Promise<string> {
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
      if (indice >= 0) caixa.esperas.splice(indice, 1);
      reject(new Error('timeout mensagem'));
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}
function esperarSilencio(ws: WebSocket, timeoutMs = 350): Promise<void> {
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
      if (indice >= 0) caixa.esperas.splice(indice, 1);
      resolve();
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}
function enviar(ws: WebSocket, comando: object): void {
  ws.send(JSON.stringify(comando));
}
async function esperarSalaAtualizada(ws: WebSocket, timeoutMs = 3000): Promise<SalaAtualizadaEvento> {
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
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  await finalizarArquivoDeTeste();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
});

// 1 — Desconexão preserva vínculo, vaga, ordem, prontidão e papel por 60 segundos
test('presenca: desconexao preserva vinculo e vaga por 60s (SALA_CHEIA mantida)', async () => {
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
    await coletarEventos(wsA, 6); // 3 entradas *2
    await coletarEventos(wsB, 4);
    await coletarEventos(wsC, 2);

    // Drena projeção preenchida
    // B desconecta (último socket do jogador)
    wsB.close();
    await delay(150); // aguarda handleFechamento async

    // A deve receber MEMBRO_DESCONECTADO + SALA_ATUALIZADA
    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_DESCONECTADO');
    const desconectado = eventosA[0] as MembroDesconectadoEvento;
    assert.equal(desconectado.presenca, 'em_reconexao');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');
    const salaAposDesconexao = (eventosA[1] as SalaAtualizadaEvento).sala;
    // Vínculo preservado
    assert.equal(salaAposDesconexao.membros.length, 4);
    const membroB = membroDaSala(salaAposDesconexao, b.id);
    assert.equal(membroB.presenca, 'em_reconexao');
    assert.equal(membroB.ordemDeEntrada, 2);
    assert.equal(membroB.prontidao, false, 'prontidão preservada');
    assert.equal(salaAposDesconexao.anfitriaoId, criacao.sala.anfitriaoId, 'papel Anfitrião preservado');
    // Vaga não liberada: E tenta entrar e recebe SALA_CHEIA
    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsE, 'SALA_CHEIA');

    // Verifica chave Redis de reconexão existe
    const salaId = salaAposDesconexao.id;
    const ttl = await redis.ttl(chaveReconexao(salaId, b.id));
    assert.ok(ttl > 0 && ttl <= 60, `ttl esperado 1..60, recebido ${ttl}`);

    for (const ws of [wsA, wsC, wsD, wsE]) ws.close();
    await Promise.all([wsA, wsC, wsD, wsE].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { janelaReconexaoMs: 800 });
});

// 2 — Reconexão autenticada dentro da janela reentra automaticamente
test('presenca: reconexao automatica dentro da janela restaura presenca conectado', async () => {
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

    // B desconecta
    wsB.close();
    await delay(150);
    await coletarEventos(wsA, 2); // MEMBRO_DESCONECTADO + SALA_ATUALIZADA

    const salaAntes = (await coletarEventos(wsA, 0).catch(() => [])) as unknown;
    void salaAntes;

    // B reconecta com novo WS dentro da janela
    const wsB2 = await conectarWs(servidor.wsUrl, b.cookies);
    // A deve receber MEMBRO_RECONECTADO + SALA_ATUALIZADA
    const eventosA = await coletarEventos(wsA, 2);
    assert.equal(eventosA[0]?.type, 'MEMBRO_RECONECTADO');
    assert.equal((eventosA[0] as MembroReconectadoEvento).presenca, 'conectado');
    assert.equal(eventosA[1]?.type, 'SALA_ATUALIZADA');
    const salaReconectada = (eventosA[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaReconectada, b.id).presenca, 'conectado');

    // B2 também recebe os mesmos eventos (está registrado no broadcast)
    const eventosB2 = await coletarEventos(wsB2, 2);
    assert.equal(eventosB2[0]?.type, 'MEMBRO_RECONECTADO');
    assert.equal((eventosB2[0] as MembroReconectadoEvento).presenca, 'conectado');

    wsA.close();
    wsB2.close();
    await Promise.all([wsA, wsB2].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { janelaReconexaoMs: 900 });
});

// 3 — Expiração termina vínculo, aciona sucessão e libera vaga
test('presenca: expiracao libera vaga e permite reentrada com ordem monotônica', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const e = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    const wsE = await conectarWs(servidor.wsUrl, e.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const salaId = criacao.sala.id;
    const membroIdB = criacao.sala.membros[0]?.id ?? '';
    // B entra
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    const evA1 = await coletarEventos(wsA, 2);
    const membroBId = membroDaSala((evA1[1] as SalaAtualizadaEvento).sala, b.id).id;

    // B desconecta
    wsB.close();
    await delay(150);
    await coletarEventos(wsA, 2);

    // Aguardar expiração (janela curta)
    await delay(500);
    // A deve receber MEMBRO_SAIU + SALA_ATUALIZADA
    const eventosExp = await coletarEventos(wsA, 2);
    assert.equal(eventosExp[0]?.type, 'MEMBRO_SAIU');
    assert.equal((eventosExp[0] as MembroSaiuEvento).jogadorId, b.id);
    const salaAposExpiracao = (eventosExp[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaAposExpiracao.membros.find((m) => m.jogadorId === b.id), undefined);
    assert.equal(salaAposExpiracao.membros.length, 1);

    // Verifica PG: motivo expiracao
    const hist = await pool.query<{ motivo: string }>(
      `SELECT motivo_de_termino AS motivo FROM membros_historico WHERE sala_id=$1 AND usuario_id=$2`,
      [salaId, b.id],
    );
    assert.equal(hist.rows[0]?.motivo, 'expiracao');

    // Janela Redis limpa
    assert.equal(await redis.ttl(chaveReconexao(salaId, b.id)), -2);

    // Vaga liberada: E entra
    enviar(wsE, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const evE = await coletarEventos(wsE, 2);
    assert.equal(evE[0]?.type, 'MEMBRO_ENTROU');
    const salaE = (evE[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaE, e.id).ordemDeEntrada, 3);
    // Drena broadcast em A
    await coletarEventos(wsA, 2);

    wsA.close();
    wsE.close();
    await Promise.all([wsA, wsE].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { janelaReconexaoMs: 300 });
});

test('presenca: expiracao do Anfitriao suse de sucessor', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const anfitriaoOriginal = criacao.sala.anfitriaoId!;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    // Host A desconecta
    wsA.close();
    await delay(150);
    await coletarEventos(wsB, 2);

    await delay(500);
    const eventos = await coletarEventos(wsB, 4);
    assert.equal(eventos.length, 4);
    assert.equal(eventos[0]?.type, 'MEMBRO_SAIU');
    assert.equal(eventos[1]?.type, 'SALA_ATUALIZADA');
    assert.equal(eventos[2]?.type, 'ANFITRIAO_SUBSTITUIDO');
    assert.equal(eventos[3]?.type, 'SALA_ATUALIZADA');
    const salaFinal = (eventos[3] as SalaAtualizadaEvento).sala;
    const membroB = membroDaSala(salaFinal, b.id);
    assert.equal(salaFinal.anfitriaoId, membroB.id);
    const sucessao = eventos[2] as AnfitriaoSubstituidoEvento;
    assert.equal(sucessao.anfitriaoAnteriorId, anfitriaoOriginal);

    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
  }, { janelaReconexaoMs: 300 });
});

// 4 — Expulsão funciona inclusive durante reconexão
test('presenca: expulsao durante reconexao remove vinculo e cancela timer', async () => {
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
    const evA = await coletarEventos(wsA, 2);
    const membroBId = membroDaSala((evA[1] as SalaAtualizadaEvento).sala, b.id).id;

    // B desconecta -> em_reconexao
    wsB.close();
    await delay(150);
    await coletarEventos(wsA, 2);

    // Host expulsa B durante reconexão
    enviar(wsA, { type: 'EXPULSAR_MEMBRO', membroId: membroBId });
    const expulsao = await coletarEventos(wsA, 2);
    assert.equal(expulsao[0]?.type, 'MEMBRO_EXPULSO');
    assert.equal(expulsao[1]?.type, 'SALA_ATUALIZADA');
    const salaAposExp = (expulsao[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaAposExp.membros.find((m) => m.jogadorId === b.id), undefined);

    // Timer cancelado: aguardar além da janela não deve emitir expiração adicional
    await delay(600);
    await esperarSilencio(wsA);

    // B tenta reentrar -> JOGADOR_EXPULSO
    const wsB2 = await conectarWs(servidor.wsUrl, b.cookies);
    enviar(wsB2, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsB2, 'JOGADOR_EXPULSO');

    wsA.close();
    wsB2.close();
    await Promise.all([wsA, wsB2].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { janelaReconexaoMs: 700 });
});

// 5 — Múltiplas conexões do mesmo Jogador contam como uma única presença
test('presenca: multiplas conexoes do mesmo Jogador contam como uma so presenca', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB1 = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;

    enviar(wsB1, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB1, 2);
    await coletarEventos(wsA, 2);

    // Segunda conexão do mesmo jogador B (segunda aba)
    const wsB2 = await conectarWs(servidor.wsUrl, b.cookies);
    // Deve apenas registrar, sem emitir MEMBRO_DESCONECTADO adicional
    // A já autenticou B via wsB2 com presenca conectado -> registrar silenciosamente
    await delay(100);
    await esperarSilencio(wsA);
    await esperarSilencio(wsB1);
    await esperarSilencio(wsB2);

    // Fechar uma das conexões – ainda há uma restante, não deve emitir desconexão
    wsB1.close();
    await delay(200);
    await esperarSilencio(wsA);
    await esperarSilencio(wsB2);

    // Fechar última conexão – deve emitir MEMBRO_DESCONECTADO
    wsB2.close();
    await delay(200);
    const ev = await coletarEventos(wsA, 2);
    assert.equal(ev[0]?.type, 'MEMBRO_DESCONECTADO');
    assert.equal((ev[0] as MembroDesconectadoEvento).presenca, 'em_reconexao');

    // Reconexão com nova conexão deve restaurar
    const wsB3 = await conectarWs(servidor.wsUrl, b.cookies);
    const ev2 = await coletarEventos(wsA, 2);
    assert.equal(ev2[0]?.type, 'MEMBRO_RECONECTADO');
    assert.equal((ev2[0] as MembroReconectadoEvento).presenca, 'conectado');

    wsA.close();
    wsB3.close();
    await Promise.all([wsA, wsB3].map((ws) => esperarClose(ws).catch(() => undefined)));
  }, { janelaReconexaoMs: 800 });
});

// 6 — Após reinício, membros reaparecem desconectados e não prontos, mutações bloqueadas
test('presenca: apos reinicio membros em reconexao e mutacoes bloqueadas ate consistencia', async () => {
  // Primeiro servidor: cria sala com A e B
  const baseHolder: { baseUrl: string; codigo: string; salaId: string } = { baseUrl: '', codigo: '', salaId: '' };
  let cookiesA: Cookies | undefined;
  let cookiesB: Cookies | undefined;
  let idA = '';
  let idB = '';
  {
    const servidor = await subirServidor({ janelaReconexaoMs: 60000 });
    try {
      const a = await registrarJogador(servidor.baseUrl);
      const b = await registrarJogador(servidor.baseUrl);
      cookiesA = a.cookies;
      cookiesB = b.cookies;
      idA = a.id;
      idB = b.id;
      const wsA = await conectarWs(servidor.wsUrl, a.cookies);
      const wsB = await conectarWs(servidor.wsUrl, b.cookies);

      enviar(wsA, { type: 'CRIAR_SALA' });
      const criacao = await esperarSalaAtualizada(wsA);
      baseHolder.codigo = criacao.sala.codigoDeSala;
      baseHolder.salaId = criacao.sala.id;

      enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: baseHolder.codigo });
      await coletarEventos(wsB, 2);
      await coletarEventos(wsA, 2);

      wsA.close();
      wsB.close();
      await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
      // Guardar PG: sala ainda aberta
      const linha = await pool.query<{ status: string }>(
        `SELECT status FROM salas_historico WHERE id=$1`,
        [baseHolder.salaId],
      );
      assert.equal(linha.rows[0]?.status, 'aberta');
    } finally {
      await servidor.fechar();
    }
  }

  // Segundo servidor: carrega do PG — sala inconsistente, mutações bloqueadas via wire
  const servidor2 = await subirServidor({ janelaReconexaoMs: 60000 });
  try {
    const contexto = servidor2.contexto;

    // Tentar mutação: C tenta entrar — deve receber SALA_INCONSISTENTE (wire)
    const c = await registrarJogador(servidor2.baseUrl);
    const wsC = await conectarWs(servidor2.wsUrl, c.cookies);
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: baseHolder.codigo });
    await esperarErro(wsC, 'SALA_INCONSISTENTE');
    wsC.close();
    await esperarClose(wsC).catch(() => undefined);

    // Confirmar consistência
    const res = contexto.estado.confirmarConsistenciaDaSala(baseHolder.salaId);
    assert.equal(res.sucesso, true);
    // Atualizar projeção manualmente (estado já substituiu, mas projeção precisa curar)
    const salaAtual = contexto.estado.abertas.get(baseHolder.salaId)!.sala;
    await contexto.projecao.definirEstadoSala(baseHolder.salaId, serializarSala(salaAtual));

    // Reconexão de A deve funcionar agora (wire)
    const wsA2 = await conectarWs(servidor2.wsUrl, cookiesA!);
    const eventosA2 = await coletarEventos(wsA2, 2);
    assert.equal(eventosA2[0]?.type, 'MEMBRO_RECONECTADO');
    assert.equal((eventosA2[0] as MembroReconectadoEvento).presenca, 'conectado');
    assert.equal(eventosA2[1]?.type, 'SALA_ATUALIZADA');
    const salaAposRec = (eventosA2[1] as SalaAtualizadaEvento).sala;
    assert.equal(membroDaSala(salaAposRec, idA).presenca, 'conectado');
    assert.equal(membroDaSala(salaAposRec, idA).prontidao, false, 'prontidão false após reinício');

    // Agora C pode entrar (wire)
    const wsC2 = await conectarWs(servidor2.wsUrl, c.cookies);
    enviar(wsC2, { type: 'ENTRAR_NA_SALA', codigoDeSala: baseHolder.codigo });
    const evC2 = await coletarEventos(wsC2, 2);
    assert.equal(evC2[0]?.type, 'MEMBRO_ENTROU');

    wsA2.close();
    wsC2.close();
    await Promise.all([wsA2, wsC2].map((ws) => esperarClose(ws).catch(() => undefined)));
  } finally {
    await servidor2.fechar();
  }
});

// 7 — Quando último vínculo termina por expiração, sala fica expirada
test('presenca: ultimo vinculo expirado deixa sala expirada', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const salaId = criacao.sala.id;

    // A desconecta (único membro)
    wsA.close();
    await delay(400); // timer 300ms + processamento

    // Precisa esperar expiração: como wsA fechou, o servidor emite expiração sem broadcast ativo
    // Verificar PG status expirada
    // Aguarda um pouco mais e checa
    await delay(300);
    const linha = await pool.query<{ status: string }>(
      `SELECT status FROM salas_historico WHERE id=$1`,
      [salaId],
    );
    assert.equal(linha.rows[0]?.status, 'expirada');

    // Novo jogador tenta entrar com código antigo -> SALA_NAO_ENCONTRADA
    const b = await registrarJogador(servidor.baseUrl);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);
    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsB, 'SALA_NAO_ENCONTRADA');

    wsB.close();
    await esperarClose(wsB).catch(() => undefined);
  }, { janelaReconexaoMs: 300 });
});
