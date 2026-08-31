// Teste de integração de Iluminação e Limpeza via wire (issue #150).
//
// Verifica que os eventos CELULAS_ILUMINADAS e LIMPEZA_APLICADA chegam ao
// cliente quando o motor emite celulas_iluminadas / limpeza_aplicada. Segue o
// padrão de turnos.test.ts: app+WS efêmeros com Redis real.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';

const SERVER_ID = 'game-server-teste-iluminacao';
const JWT_SECRET = 'test_secret_para_iluminacao';

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
  readonly port: number;
  readonly wsUrl: (partidaId: string, token: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(ttlSegundos: number): Promise<ServidorEfemero> {
  const contexto = { redis, serverId: SERVER_ID, jwtSecret: JWT_SECRET, partidaPreparadaTtlSegundos: ttlSegundos };
  const app = createApp(contexto);
  const server = http.createServer(app);

  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({ redis, broadcaster });
  const wss = criarWebSocketServer(server, contexto, {
    partida: { broadcaster, handlers },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const endereco = server.address() as AddressInfo;
  const port = endereco.port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    wsUrl: (partidaId: string, token: string) =>
      `ws://127.0.0.1:${port}/ws/game/${SERVER_ID}?partida-id=${partidaId}&token=${token}`,
    fechar: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
    },
  };
}

function criarJwt(jogadorId: string, apelido: string, sessaoId: string): string {
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function criarSessaoNoRedis(sessaoId: string, jogadorId: string): Promise<void> {
  await redis.set(`sessao:${sessaoId}`, JSON.stringify({ jogadorId, criadoEm: new Date().toISOString() }), 'EX', 3600);
}

async function tokenParaJogador(n: number): Promise<string> {
  const jogadorId = `jogador-${n}`;
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return criarJwt(jogadorId, `Jogador ${n}`, sessaoId);
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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de iluminação' }),
  });
}

async function criarPartidaViaPost(baseUrl: string): Promise<AceiteDoEncaminhamento> {
  const resposta = await postOferta(baseUrl, ofertaValida());
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

async function conectarPartida(servidor: ServidorEfemero, partidaId: string, jogador = 1): Promise<WebSocket> {
  const token = await tokenParaJogador(jogador);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const aceita = esperarEvento(ws, 'ADMISSAO_ACEITA');

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  try {
    const mensagem = await aceita;
    assert.equal(mensagem.jogadorId, `jogador-${jogador}`);
    return ws;
  } catch (erro) {
    ws.close();
    throw erro;
  }
}

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

/**
 * Aguarda o TURNO_INICIADO de um Jogador/rodada específicos, descartando os
 * demais frames do tipo — em especial o TURNO_INICIADO que a admissão anuncia
 * ao socket recém-conectado.
 */
async function esperarTurnoIniciado(
  ws: WebSocket,
  jogadorId: string,
  rodada: number,
): Promise<Record<string, unknown>> {
  for (;;) {
    const frame = await esperarEvento(ws, 'TURNO_INICIADO');
    if (frame.jogadorId === jogadorId && frame.rodada === rodada) {
      return frame;
    }
  }
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

test('fluxo feliz: CELULAS_ILUMINADAS é recebido ao posicionar Peão no Primeiro Turno', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Selecionar Peça Inicial
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
      await esperarEvento(ws, 'PECA_SELECIONADA');

      // Posicionar Peça em célula interior
      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      // Selecionar Peão
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      // Posicionar Peão — deve emitir CELULAS_ILUMINADAS junto com PEAO_POSICIONADO
      const iluminadasEspera = esperarEvento(ws, 'CELULAS_ILUMINADAS');
      const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
      const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });

      await peaoPosicionadoEspera;
      await recebimentoEspera;
      const iluminadas = await iluminadasEspera;

      // Peão em (3,3) ilumina: (2,3),(3,2),(3,3),(3,4),(4,3)
      const celulas = iluminadas.celulas as Array<{ linha: number; coluna: number }>;
      assert.equal(celulas.length, 5);
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 2 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 4 && c.coluna === 3));
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 2));
      assert.ok(celulas.some((c) => c.linha === 3 && c.coluna === 4));
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('fluxo feliz: LIMPEZA_APLICADA é recebido quando peça fica fora da iluminação ao confirmar posição no rodada 2', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId, 1);
    const ws2 = await conectarPartida(servidor, aceite.partidaId, 2);

    try {
      // ── Primeiro Turno de jogador-1 ──────────────────────────────
      // Posicionar inicial-1 em (3,3) e peao-branco em (3,3).
      // Iluminação de (3,3): (2,3),(3,2),(3,3),(3,4),(4,3).
      enviar(ws, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1' });
      await esperarEvento(ws, 'PECA_SELECIONADA');

      enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } });
      await esperarEvento(ws, 'PECA_POSICIONADA');

      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      const recebimentoEspera = esperarEvento(ws, 'RECEBIMENTO_GERADO');
      const peaoPosicionadoEspera = esperarEvento(ws, 'PEAO_POSICIONADO');
      enviar(ws, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } });
      await peaoPosicionadoEspera;
      const recebimento = await recebimentoEspera;
      const recebidas = recebimento.recebidas as Array<Record<string, unknown>>;
      assert.equal(recebidas.length, 2);

      // Resolver recebidas: colocar a primeira em norte → (2,3) e a segunda em leste → (3,4).
      for (let i = 0; i < recebidas.length; i++) {
        const r = recebidas[i]!;
        const recebidaId = r.recebidaId as string;
        const pecaId = r.pecaId as string;
        const borda = i === 0 ? 'norte' : 'leste';

        enviar(ws, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId: 'jogador-1', recebidaId, borda });
        await esperarEvento(ws, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');

        // Calcular célula-alvo a partir da borda e da posição da peça geradora (3,3).
        const celulaAlvo = borda === 'norte'
          ? { linha: 2, coluna: 3 }
          : { linha: 3, coluna: 4 };
        enviar(ws, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-1', pecaId, celula: celulaAlvo });
        await esperarEvento(ws, 'PECA_POSICIONADA');
      }

      // Encerrar turno → avança para jogador-2.
      const encerradoEspera = esperarEvento(ws, 'TURNO_ENCERRADO');
      const iniciadoEspera = esperarTurnoIniciado(ws, 'jogador-2', 1);
      enviar(ws, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-1' });
      await encerradoEspera;
      await iniciadoEspera;

      // ── Primeiro Turno de jogador-2 ──────────────────────────────
      // Posicionar inicial-2 em (0,0) e peao-vermelho em (0,0).
      enviar(ws2, { type: 'SELECIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2' });
      await esperarEvento(ws2, 'PECA_SELECIONADA');

      enviar(ws2, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-2', pecaId: 'inicial-2', celula: { linha: 0, coluna: 0 } });
      await esperarEvento(ws2, 'PECA_POSICIONADA');

      enviar(ws2, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' });
      await esperarEvento(ws2, 'PEAO_SELECIONADO');

      const recebimento2Espera = esperarEvento(ws2, 'RECEBIMENTO_GERADO');
      const peaoPosicionado2Espera = esperarEvento(ws2, 'PEAO_POSICIONADO');
      enviar(ws2, { type: 'POSICIONAR_PEAO', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', celula: { linha: 0, coluna: 0 } });
      await peaoPosicionado2Espera;
      const recebimento2 = await recebimento2Espera;
      const recebidas2 = recebimento2.recebidas as Array<Record<string, unknown>>;
      assert.equal(recebidas2.length, 2);

      for (let i = 0; i < recebidas2.length; i++) {
        const r = recebidas2[i]!;
        const recebidaId = r.recebidaId as string;
        const pecaId = r.pecaId as string;
        // Inicial em (0,0) com bordas sul/leste.
        const borda = i === 0 ? 'sul' : 'leste';

        enviar(ws2, { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', jogadorId: 'jogador-2', recebidaId, borda });
        await esperarEvento(ws2, 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO');

        const celulaAlvo = borda === 'sul'
          ? { linha: 1, coluna: 0 }
          : { linha: 0, coluna: 1 };
        enviar(ws2, { type: 'POSICIONAR_PECA', jogadorId: 'jogador-2', pecaId, celula: celulaAlvo });
        await esperarEvento(ws2, 'PECA_POSICIONADA');
      }

      // Encerrar turno → avança para jogador-1, rodada 2.
      const encerrado2Espera = esperarEvento(ws2, 'TURNO_ENCERRADO');
      const iniciado2Espera = esperarTurnoIniciado(ws, 'jogador-1', 2);
      enviar(ws2, { type: 'ENCERRAR_TURNO', jogadorId: 'jogador-2' });
      await encerrado2Espera;
      await iniciado2Espera;

      // ── Rodada 2 de jogador-1 ────────────────────────────────────
      // Selecionar peao-branco e movê-lo para (3,2) — onde está a reta
      // posicionada. A nova iluminação de (3,2): (2,2),(3,1),(3,2),(3,3),(4,2).
      // A peça em (3,4) fica FORA → limpeza deve removê-la.
      enviar(ws, { type: 'SELECIONAR_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await esperarEvento(ws, 'PEAO_SELECIONADO');

      enviar(ws, { type: 'MOVER_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco', celula: { linha: 3, coluna: 2 } });
      await esperarEvento(ws, 'PEAO_MOVIDO');

      // Confirmar posição → dispara limpeza.
      const limpezaEspera = esperarEvento(ws, 'LIMPEZA_APLICADA');
      const posicaoConfirmadaEspera = esperarEvento(ws, 'POSICAO_CONFIRMADA');
      enviar(ws, { type: 'CONFIRMAR_POSICAO_DO_PEAO', jogadorId: 'jogador-1', peaoId: 'peao-branco' });
      await posicaoConfirmadaEspera;

      const limpeza = await limpezaEspera;
      assert.equal(limpeza.type, 'LIMPEZA_APLICADA');
      const pecasRemovidas = limpeza.pecasRemovidas as string[];
      assert.ok(pecasRemovidas.length > 0, 'esperava ao menos uma peça removida pela limpeza');
    } finally {
      ws.close();
      ws2.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
test('rejeição: payload de tipo de mensagem inexistente como comando é rejeitado com ERRO_DO_TABULEIRO', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl);
    const ws = await conectarPartida(servidor, aceite.partidaId);

    try {
      // Enviar tipo que não existe como comando — o servidor deve rejeitar
      enviar(ws, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] });
      const erro = await esperarEvento(ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.type, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'DADOS_INVALIDOS');
    } finally {
      ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
