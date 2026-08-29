// Teste de integração do Tabuleiro no game-server (issue #80).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita o fluxo
// feliz (selecionar → posicionar → estado persiste) e a rejeição
// (célula já ocupada → ERRO_DO_TABULEIRO com código fechado).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { TabuleiroBroadcaster } from '../src/tabuleiro/broadcast.ts';
import { TabuleiroHandlers } from '../src/tabuleiro/handlers.ts';
import { obterEstadoDoTabuleiro } from '../src/partidas/tabuleiro.ts';

const SERVER_ID = 'game-server-teste-tabuleiro';

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
  readonly wsUrl: (partidaId: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(ttlSegundos: number): Promise<ServidorEfemero> {
  const contexto = { redis, serverId: SERVER_ID, partidaPreparadaTtlSegundos: ttlSegundos };
  const app = createApp(contexto);
  const server = http.createServer(app);

  const broadcaster = new TabuleiroBroadcaster();
  const handlers = new TabuleiroHandlers({ redis, broadcaster });
  createWebSocketServer(server, { tabuleiro: { redis, broadcaster, handlers } });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const endereco = server.address() as AddressInfo;
  const port = endereco.port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: (partidaId: string) => `ws://127.0.0.1:${port}?partidaId=${partidaId}`,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
  };
}

function membro(n: number, sobrescreve: Partial<MembroDaSala> = {}): MembroDaSala {
  return {
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
    ...sobrescreve,
  };
}

function ofertaValida(): OfertaDeEncaminhamento {
  return {
    salaId: 'sala-1',
    codigoDeSala: 'ABC123',
    roster: [membro(1), membro(2), membro(3), membro(4)] as OfertaDeEncaminhamento['roster'],
  };
}

function postOferta(baseUrl: string, corpo: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

function deletePartida(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de tabuleiro' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

/** Abre um WS e resolve quando a conexão está pronta para enviar. */
function abrirWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Aguarda uma mensagem WS com o `type` esperado (timeout para não travar). */
function esperarEvento(
  ws: WebSocket,
  tipo: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMensagem);
      reject(new Error(`timeout aguardando evento WS '${tipo}'`));
    }, timeoutMs);
    function onMensagem(data: unknown): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse((data as Buffer).toString());
      } catch {
        return;
      }
      if (
        typeof parsed === 'object'
        && parsed !== null
        && (parsed as { type?: unknown }).type === tipo
      ) {
        clearTimeout(timer);
        ws.removeListener('message', onMensagem);
        resolve(parsed as Record<string, unknown>);
      }
    }
    ws.on('message', onMensagem);
  });
}

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis indisponível para os testes de integração: ${(error as Error).message}`);
  }
});

after(async () => {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
});

test('fluxo feliz: selecionar e posicionar peça persiste no Redis', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await abrirWs(servidor.wsUrl(aceite.partidaId));
    // Pequeno intervalo para o servidor validar a partida e registrar o socket.
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      enviar(ws, { type: 'SELECIONAR_PECA', pecaId: 'inicial-1' });
      const selecionada = await esperarEvento(ws, 'PECA_SELECIONADA');
      assert.equal(selecionada.pecaId, 'inicial-1');

      enviar(ws, { type: 'POSICIONAR_PECA', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      const posicionada = await esperarEvento(ws, 'PECA_POSICIONADA');
      assert.equal(posicionada.pecaId, 'inicial-1');
      assert.deepEqual(posicionada.celula, { linha: 0, coluna: 0 });

      // O estado no Redis reflete a posição: a reserva não contém mais 'inicial-1'.
      const estado = await obterEstadoDoTabuleiro(redis, aceite.partidaId);
      assert.ok(estado !== null, 'estado do tabuleiro deve existir no Redis');
      const aindaNaReserva = estado!.reserva.some((p) => p.pecaId === 'inicial-1');
      assert.equal(aindaNaReserva, false);
      const posicionadas = estado!.posicionadas.filter((p) => p.pecaId === 'inicial-1');
      assert.equal(posicionadas.length, 1);
      assert.deepEqual(posicionadas[0]!.celula, { linha: 0, coluna: 0 });
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: posicionar em célula ocupada responde ERRO_DO_TABULEIRO CELULA_JA_OCUPADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await abrirWs(servidor.wsUrl(aceite.partidaId));
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      // Posiciona 'inicial-1' em (0,0).
      enviar(ws, { type: 'SELECIONAR_PECA', pecaId: 'inicial-1' });
      await esperarEvento(ws, 'PECA_SELECIONADA');
      enviar(ws, { type: 'POSICIONAR_PECA', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      // Tenta posicionar 'inicial-2' na mesma célula ocupada.
      enviar(ws, { type: 'SELECIONAR_PECA', pecaId: 'inicial-2' });
      await esperarEvento(ws, 'PECA_SELECIONADA');
      enviar(ws, { type: 'POSICIONAR_PECA', pecaId: 'inicial-2', celula: { linha: 0, coluna: 0 } });

      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'CELULA_JA_OCUPADA');
      assert.ok(typeof erro.mensagem === 'string' && erro.mensagem.length > 0);
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rejeição: girar peça após FINALIZAR responde ERRO_DO_TABULEIRO MANIPULACAO_ENCERRADA', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);

    const ws = await abrirWs(servidor.wsUrl(aceite.partidaId));
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      enviar(ws, { type: 'SELECIONAR_PECA', pecaId: 'inicial-1' });
      await esperarEvento(ws, 'PECA_SELECIONADA');
      enviar(ws, { type: 'POSICIONAR_PECA', pecaId: 'inicial-1', celula: { linha: 0, coluna: 0 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      // Encerra a janela de Manipulação.
      enviar(ws, { type: 'FINALIZAR_MANIPULACAO' });
      await esperarEvento(ws, 'MANIPULACAO_FINALIZADA');

      // Tenta girar a peça já finalizada.
      enviar(ws, { type: 'GIRAR_PECA', pecaId: 'inicial-1', sentido: 'horario' });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'MANIPULACAO_ENCERRADA');
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
