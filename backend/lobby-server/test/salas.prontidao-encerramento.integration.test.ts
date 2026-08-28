// Testes de integração — Prontidão e encerramento no lobby-server (issue #31).
// Cobre o seam WS com PG+Redis reais do compose, verificando apenas
// comportamento externo (protocolo WS). Critérios de #31:
// 1) pronto alterna individualmente; entrada de novo Membro não limpa prontidão
// 2) mudanças de prontidão são broadcast aos Membros
// 3) encerrar por não-Anfitrião é recusado
// 4) Anfitrião encerra explicitamente Sala aberta com Membros presentes (só SALA_ATUALIZADA)
// 5) integração real

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
  ProntidaoAtualizadaEvento,
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { redisClient } from '../src/config/redis.ts';
import { criarContextoDasSalas, type CriarContextoOpcoes } from '../src/salas/index.ts';

interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
  fechar(): Promise<void>;
}
interface Cookies { access_token?: string; refresh_token?: string; }
interface JogadorResponse { id: string; apelido: string; email: string; }
interface EsperaDeMensagem { readonly resolver: (raw: string) => void; readonly rejeitar: (erro: Error) => void; }
interface CaixaDeMensagens { readonly mensagens: string[]; readonly esperas: EsperaDeMensagem[]; }

const redis = criarClienteRedis();
const caixasDeMensagens = new WeakMap<WebSocket, CaixaDeMensagens>();
let appServidor: ReturnType<typeof createApp> | null = null;
let contador = 0;

async function subirServidor(opcoesDeSalas: CriarContextoOpcoes = {}): Promise<ServidorEfemero> {
  if (appServidor === null) appServidor = createApp();
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
    fechar: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
async function comServidor<T>(executar: (servidor: ServidorEfemero) => Promise<T>, opcoes: CriarContextoOpcoes = {}): Promise<T> {
  const servidor = await subirServidor(opcoes);
  try { return await executar(servidor); } finally { await servidor.fechar(); }
}
function sufixo(): string { contador += 1; return `${contador}`; }
function apelidoUnico(prefixo: string): string { return `${prefixo}-${sufixo()}`; }
function emailUnico(prefixo: string): string { return `${prefixo}-${sufixo()}@exemplo.local`; }
function extrairCookies(res: Response): Cookies {
  const setCookies = res.headers.getSetCookie();
  const cookies: Cookies = {};
  for (const raw of setCookies) {
    const [par] = raw.split(';'); if (!par) continue;
    const eq = par.indexOf('='); if (eq === -1) continue;
    const nome = par.slice(0, eq).trim(); const valor = par.slice(eq + 1).trim();
    if (nome === 'access_token' || nome === 'refresh_token') cookies[nome as keyof Cookies] = valor;
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
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(corpo) });
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
      if (espera !== undefined) espera.resolver(raw); else caixa.mensagens.push(raw);
    });
    ws.on('error', (erro) => { for (const espera of caixa.esperas.splice(0)) espera.rejeitar(erro); });
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('timeout ao conectar WS')); }, 3000);
    ws.once('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.once('error', (err) => { clearTimeout(timeout); reject(err); });
    ws.once('close', (code) => { clearTimeout(timeout); reject(new Error(`close prematuro code=${code}`)); });
  });
}
function esperarClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('timeout ao esperar close')); }, timeoutMs);
    ws.once('close', (code: number, reason: Buffer) => { clearTimeout(timeout); resolve({ code, reason: reason.toString() }); });
    ws.once('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}
function esperarMensagem(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const caixa = caixasDeMensagens.get(ws)!;
    assert.ok(caixa, 'socket sem caixa');
    const mensagem = caixa.mensagens.shift();
    if (mensagem !== undefined) { resolve(mensagem); return; }
    const espera: EsperaDeMensagem = {
      resolver: (raw) => { clearTimeout(timeout); resolve(raw); },
      rejeitar: (erro) => { clearTimeout(timeout); reject(erro); },
    };
    const timeout = setTimeout(() => {
      const indice = caixa.esperas.indexOf(espera);
      if (indice >= 0) caixa.esperas.splice(indice, 1);
      reject(new Error('timeout mensagem'));
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}
function esperarSilencio(ws: WebSocket, timeoutMs = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const caixa = caixasDeMensagens.get(ws)!;
    const mensagem = caixa.mensagens.shift();
    if (mensagem !== undefined) { reject(new Error(`evento inesperado: ${mensagem}`)); return; }
    const espera: EsperaDeMensagem = {
      resolver: (raw) => { clearTimeout(timeout); reject(new Error(`evento inesperado: ${raw}`)); },
      rejeitar: (erro) => { clearTimeout(timeout); reject(erro); },
    };
    const timeout = setTimeout(() => {
      const i = caixa.esperas.indexOf(espera); if (i >= 0) caixa.esperas.splice(i, 1);
      resolve();
    }, timeoutMs);
    caixa.esperas.push(espera);
  });
}
function enviar(ws: WebSocket, comando: object): void { ws.send(JSON.stringify(comando)); }
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
  assert.equal(evento.codigo, codigoEsperado);
  return evento;
}
async function coletarEventos(ws: WebSocket, n: number, timeoutMs = 3000): Promise<SalaEventoDoServidor[]> {
  const eventos: SalaEventoDoServidor[] = [];
  for (let i = 0; i < n; i++) { const raw = await esperarMensagem(ws, timeoutMs); eventos.push(JSON.parse(raw) as SalaEventoDoServidor); }
  return eventos;
}
function membroDaSala(sala: Sala, jogadorId: string): MembroDaSala {
  const membro = sala.membros.find((m) => m.jogadorId === jogadorId);
  assert.ok(membro, `jogadorId ${jogadorId} não está em membros`);
  return membro;
}

before(async () => {
  try { await pool.query('SELECT 1'); } catch (e) { throw new Error(`Postgres indisponível: ${(e as Error).message}`); }
  try { await redis.connect(); await redis.ping(); } catch (e) { throw new Error(`Redis indisponível: ${(e as Error).message}`); }
});
after(async () => {
  try { await redis.quit().catch(() => { try { redis.disconnect(); } catch {} }); } catch { try { redis.disconnect(); } catch {} }
  await finalizarArquivoDeTeste();
});
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`);
  await redis.flushdb();
});

// --- Prontidão: alterna individualmente ---

test('ALTERNAR_PRONTIDAO: pronto alterna individualmente e persiste', async () => {
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

    // A marca pronto
    enviar(wsA, { type: 'ALTERNAR_PRONTIDAO' });
    const evA1 = await coletarEventos(wsA, 2);
    assert.equal(evA1[0]?.type, 'PRONTIDAO_ATUALIZADA');
    assert.equal((evA1[0] as ProntidaoAtualizadaEvento).prontidao, true);
    assert.equal((evA1[1] as SalaAtualizadaEvento).sala.membros.find((m) => m.jogadorId === a.id)?.prontidao, true);
    // B recebe broadcast
    const evB1 = await coletarEventos(wsB, 2);
    assert.equal(evB1[0]?.type, 'PRONTIDAO_ATUALIZADA');
    assert.equal((evB1[0] as ProntidaoAtualizadaEvento).membroId, (evA1[0] as ProntidaoAtualizadaEvento).membroId);

    // A desfaz
    enviar(wsA, { type: 'ALTERNAR_PRONTIDAO' });
    const evA2 = await coletarEventos(wsA, 2);
    assert.equal((evA2[0] as ProntidaoAtualizadaEvento).prontidao, false);
    const evB2 = await coletarEventos(wsB, 2);
    assert.equal((evB2[0] as ProntidaoAtualizadaEvento).prontidao, false);

    // B alterna sem afetar A
    enviar(wsB, { type: 'ALTERNAR_PRONTIDAO' });
    const evB3 = await coletarEventos(wsB, 2);
    assert.equal((evB3[0] as ProntidaoAtualizadaEvento).prontidao, true);
    const salaB3 = (evB3[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaB3.membros.find((m) => m.jogadorId === a.id)?.prontidao, false);
    assert.equal(salaB3.membros.find((m) => m.jogadorId === b.id)?.prontidao, true);
    await coletarEventos(wsA, 2);

    wsA.close(); wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

test('entrada de novo Membro não limpa a prontidão dos demais', async () => {
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

    // A fica pronto
    enviar(wsA, { type: 'ALTERNAR_PRONTIDAO' });
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // C entra
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const evC = await coletarEventos(wsC, 2);
    const salaC = (evC[1] as SalaAtualizadaEvento).sala;
    assert.equal(salaC.membros.find((m) => m.jogadorId === a.id)?.prontidao, true, 'prontidão de A preservada');
    assert.equal(salaC.membros.find((m) => m.jogadorId === b.id)?.prontidao, false);
    assert.equal(salaC.membros.find((m) => m.jogadorId === c.id)?.prontidao, false);

    // A e B receberam MEMBRO_ENTROU + SALA_ATUALIZADA com prontidão preservada
    const evA = await coletarEventos(wsA, 2);
    assert.equal((evA[1] as SalaAtualizadaEvento).sala.membros.find((m) => m.jogadorId === a.id)?.prontidao, true);
    const evB = await coletarEventos(wsB, 2);
    assert.equal((evB[1] as SalaAtualizadaEvento).sala.membros.find((m) => m.jogadorId === a.id)?.prontidao, true);

    wsA.close(); wsB.close(); wsC.close();
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));
  });
});

test('PRONTIDAO_ATUALIZADA é broadcast para todos os Membros', async () => {
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
    for (const ws of [wsB, wsC]) {
      enviar(ws, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
      await coletarEventos(ws, 2);
    }
    await coletarEventos(wsA, 4);
    await coletarEventos(wsB, 2);

    enviar(wsB, { type: 'ALTERNAR_PRONTIDAO' });
    for (const ws of [wsA, wsB, wsC]) {
      const ev = await coletarEventos(ws, 2);
      assert.equal(ev[0]?.type, 'PRONTIDAO_ATUALIZADA');
      assert.equal((ev[0] as ProntidaoAtualizadaEvento).prontidao, true);
      assert.equal(ev[1]?.type, 'SALA_ATUALIZADA');
    }

    wsA.close(); wsB.close(); wsC.close();
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));
  });
});

// --- Encerramento ---

test('ENCERRAR_SALA por não-Anfitrião é recusado', async () => {
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

    // B tenta encerrar
    enviar(wsB, { type: 'ENCERRAR_SALA' });
    await esperarErro(wsB, 'APENAS_ANFITRIAO');
    // A não recebe nada
    await esperarSilencio(wsA);

    // Sala permanece aberta; C ainda pode entrar
    const c = await registrarJogador(servidor.baseUrl);
    const wsC = await conectarWs(servidor.wsUrl, c.cookies);
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsC, 2);
    await coletarEventos(wsA, 2);
    await coletarEventos(wsB, 2);

    // Verifica no banco que status ainda é aberta
    const linha = await pool.query<{ status: string }>(`SELECT status FROM salas_historico WHERE codigo_sala = $1`, [codigo]);
    assert.equal(linha.rows[0]?.status, 'aberta');

    wsA.close(); wsB.close(); wsC.close();
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));
  });
});

test('ENCERRAR_SALA: Anfitrião encerra Sala aberta com Membros presentes — só SALA_ATUALIZADA', async () => {
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
    await coletarEventos(wsB, 2);

    // Anfitrião encerra
    enviar(wsA, { type: 'ENCERRAR_SALA' });

    // Todos recebem só SALA_ATUALIZADA { estado:'encerrada', membros:[] }
    for (const ws of [wsA, wsB, wsC]) {
      const raw = await esperarMensagem(ws, 2000);
      const ev = JSON.parse(raw) as SalaEventoDoServidor;
      assert.equal(ev.type, 'SALA_ATUALIZADA');
      const sala = (ev as SalaAtualizadaEvento).sala;
      assert.equal(sala.estado, 'encerrada');
      assert.deepEqual(sala.membros, []);
    }

    // Nenhum outro evento
    for (const ws of [wsA, wsB, wsC]) await esperarSilencio(ws);

    // PG status encerrada e histórico com motivo encerramento
    const linha = await pool.query<{ status: string }>(`SELECT status FROM salas_historico WHERE codigo_sala = $1`, [codigo]);
    assert.equal(linha.rows[0]?.status, 'encerrada');
    const historico = await pool.query<{ count: string }>(`SELECT count(*) FROM membros_historico WHERE sala_id = (SELECT id FROM salas_historico WHERE codigo_sala = $1) AND motivo_de_termino = 'encerramento'`, [codigo]);
    assert.equal(Number(historico.rows[0]?.count), 3);

    // Tentar entrar após encerramento → SALA_NAO_ENCONTRADA ou SALA_ENCERRADA (write-model retorna null)
    wsA.close(); wsB.close(); wsC.close();
    await Promise.all([wsA, wsB, wsC].map((ws) => esperarClose(ws).catch(() => undefined)));

    // Novo jogador tenta entrar com mesmo código → SALA_NAO_ENCONTRADA (fallback não acha aberta)
    const d = await registrarJogador(servidor.baseUrl);
    const wsD = await conectarWs(servidor.wsUrl, d.cookies);
    enviar(wsD, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await esperarErro(wsD, 'SALA_NAO_ENCONTRADA');
    wsD.close();
    await esperarClose(wsD).catch(() => undefined);
  });
});
