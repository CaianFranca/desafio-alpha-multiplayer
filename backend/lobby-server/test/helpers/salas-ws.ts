// Harness de integração das Salas no lobby-server (issue #36 + #34).
//
// Extraído de `salas.integration.test.ts` para ser compartilhado sem
// duplicação por `salas.integration.test.ts` (issue #36) e
// `chat.integration.test.ts` (issue #34). Contém TODO o scaffolding de
// infraestrutura WS: subir/derrubar servidor efêmero, registrar jogador,
// conectar socket, enviar/com esperar mensagens, e os hooks
// `before`/`after`/`beforeEach` que validam Postgres+Redis e fazem
// TRUNCATE+FLUSHDB entre testes.
//
// Estilo: node:test + assert/strict; espelha `ws-auth.integration.test.ts`.

import assert from 'node:assert/strict';
import { after, before, beforeEach } from 'node:test';
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
import { createApp } from '../../src/app.ts';
import { createWebSocketServer } from '../../src/ws/ws.ts';
import { pool } from '../../src/config/pg.ts';
import { redisClient } from '../../src/config/redis.ts';
import {
  criarContextoDasSalas,
  SalasRepo,
  type CriarContextoOpcoes,
} from '../../src/salas/index.ts';
import { chaveJogadorSala, chaveSalaCodigo } from '../../src/salas/projecao.ts';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from '../teardown.ts';

// Registra este arquivo de teste no teardown único (fecha redisClient+pool
// quando o último arquivo que importa o helper terminar). Chamado uma vez no
// topo do módulo, independente de quantos arquivos de teste o importam.
registrarArquivoDeTeste();

export interface ServidorEfemero {
  baseUrl: string;
  wsUrl: string;
  fechar(): Promise<void>;
}

export interface Cookies {
  access_token?: string;
  refresh_token?: string;
}

export interface JogadorResponse {
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

/** Cliente Redis dedicado ao harness (connect/ping no `before`). */
export const redis = criarClienteRedis();
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
  return `${prefixo}-${sufixo()}@bot.teste`;
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

/**
 * Registra os hooks de infraestrutura (node:test) para o arquivo de teste
 * que o invocar. Valida Postgres+Redis no `before`, fecha os clientes no
 * `after` e faz TRUNCATE+FLUSHDB no `beforeEach`. Deve ser chamado no topo
 * do arquivo de teste (escopo de avaliação do módulo).
 */
function configurarHooks(): void {
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
    // redisClient (singleton) e pool são encerrados UMA vez via teardown único,
    // quando o último arquivo de teste que importa o helper terminar.
    await finalizarArquivoDeTeste();
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
}

export {
  subirServidor,
  comServidor,
  RepositorioComFalhaNaSaida,
  RepositorioComCriacaoPausada,
  sufixo,
  apelidoUnico,
  emailUnico,
  extrairCookies,
  headerDeCookies,
  postJson,
  cadastroValido,
  registrarJogador,
  conectarWs,
  esperarClose,
  esperarMensagem,
  esperarSilencio,
  enviar,
  esperarSalaAtualizada,
  esperarErro,
  coletarEventos,
  membroDaSala,
  configurarHooks,
  // Re-exporta chaves de projeção e clientes para os testes.
  chaveJogadorSala,
  chaveSalaCodigo,
  redisClient,
  pool,
};
