// Histórico do chat de Partida com ciclo da Partida e leitura atômica (issue #388).
//
// Lista Redis própria por Partida (`game-server:partida-chat:<id>`), capped em
// ~50 (humanas + bot somadas) com aparo no topo, fora do blob de estado, com
// mesmo ciclo/TTL das chaves da Partida e leitura atômica no snapshot de
// Reconexão, sem replay separado.
//
// Cobre:
// - cap 50 somadas com aparo no topo + fora do blob (deepEqual do estado)
// - limpa em cancelamento/não-início e viva no término (TTL de retenção)
// - preparada sem mensagens não tem lista (lista nasce no primeiro RPUSH)
// - reconexão recebe tabuleiro+chat do mesmo instante sob rajada de bot, sem
//   duplicadas e sem MENSAGEM_DE_CHAT_DA_PARTIDA extra.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis, assinarBotToken } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  MensagemDeChatDaPartidaEvento,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { obterEstadoDaPartida } from '../src/partidas/estado.ts';
import { chaveDoChatDaPartida } from '../src/partidas/chaves.ts';
import {
  adicionarMensagemAoHistorico,
  obterHistoricoDoChat,
} from '../src/partidas/historico-chat.ts';
import { cancelarPartidaSeNaoIniciada } from '../src/partidas/partidas.ts';

const SERVER_ID = 'game-server-teste-historico-chat';
const JWT_SECRET = 'test_secret_para_historico_chat';
const HISTORICO_MAXIMO = 50;

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
  readonly wsUrl: (partidaId: string, token: string) => string;
  readonly fechar: () => Promise<void>;
}

async function subirServidor(
  ttlSegundos: number,
  partidaTerminadaTtlSegundos = 3600,
): Promise<ServidorEfemero> {
  const contexto = {
    redis,
    serverId: SERVER_ID,
    jwtSecret: JWT_SECRET,
    partidaPreparadaTtlSegundos: ttlSegundos,
    partidaTerminadaTtlSegundos,
    lobbyRetornoCallbackUrl: 'http://localhost:3001/api/retorno',
  };
  const app = createApp(contexto);
  const server = http.createServer(app);

  const broadcaster = new PartidaBroadcaster();
  const handlers = new PartidaHandlers({ redis, broadcaster, partidaTerminadaTtlSegundos });
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

async function tokenParaJogador(jogadorId: string, apelido: string): Promise<string> {
  const sessaoId = crypto.randomUUID();
  await criarSessaoNoRedis(sessaoId, jogadorId);
  return criarJwt(jogadorId, apelido, sessaoId);
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

function ofertaDeDois(): OfertaDeEncaminhamento {
  return {
    salaId: 'sala-historico',
    codigoDeSala: 'HIST01',
    roster: [membro(1), membro(2)] as OfertaDeEncaminhamento['roster'],
  };
}

function ofertaComBot(): OfertaDeEncaminhamento {
  const bot: MembroDaSala = {
    id: 'membro-bot',
    jogadorId: 'bot-1',
    apelido: 'Bot Camareiro',
    ordemDeEntrada: 2,
    presenca: 'conectado',
    prontidao: true,
    ehBot: true,
  };
  return {
    salaId: 'sala-historico-bot',
    codigoDeSala: 'HIST02',
    roster: [membro(1), bot] as OfertaDeEncaminhamento['roster'],
  };
}

async function criarPartidaViaPost(baseUrl: string, oferta: OfertaDeEncaminhamento): Promise<AceiteDoEncaminhamento> {
  const resposta = await fetch(`${baseUrl}/api/encaminhamento`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(oferta),
  });
  assert.equal(resposta.status, 200);
  return (await resposta.json()) as AceiteDoEncaminhamento;
}

function deletePartida(baseUrl: string, partidaId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/encaminhamento/${partidaId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de histórico' }),
  });
}

async function conectarPartida(
  servidor: ServidorEfemero,
  partidaId: string,
  jogadorId: string,
  apelido: string,
  preEsperas: Array<(ws: WebSocket) => Promise<Record<string, unknown>>> = [],
): Promise<{ ws: WebSocket; esperas: Promise<Record<string, unknown>>[] }> {
  const token = await tokenParaJogador(jogadorId, apelido);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const aceita = esperarEvento(ws, 'ADMISSAO_ACEITA');
  const esperas = preEsperas.map((criar) => criar(ws));

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  try {
    const mensagem = await aceita;
    assert.equal(mensagem.jogadorId, jogadorId);
    return { ws, esperas };
  } catch (erro) {
    ws.close();
    throw erro;
  }
}

async function conectarBotPartida(
  servidor: ServidorEfemero,
  partidaId: string,
  botId: string,
  apelido: string,
): Promise<WebSocket> {
  const token = assinarBotToken({ jogadorId: botId, apelido, partidaId }, JWT_SECRET);
  const ws = new WebSocket(servidor.wsUrl(partidaId, token));
  const aceita = esperarEvento(ws, 'ADMISSAO_ACEITA');

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  try {
    const mensagem = await aceita;
    assert.equal(mensagem.jogadorId, botId);
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

function coletarEventos(
  ws: WebSocket,
  tipo: string,
  quantidade: number,
  timeoutMs = 15000,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const coletadas: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      ws.removeListener('message', onMensagem);
      reject(new Error(`timeout coletando '${tipo}': ${coletadas.length}/${quantidade}`));
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
        coletadas.push(parsed as Record<string, unknown>);
        if (coletadas.length === quantidade) {
          clearTimeout(timer);
          ws.removeListener('message', onMensagem);
          resolve(coletadas);
        }
      }
    }
    ws.on('message', onMensagem);
  });
}

async function esperarSilencio(ws: WebSocket, ms: number): Promise<void> {
  const tiposRecebidos: string[] = [];
  const listener = (data: unknown): void => {
    try {
      const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
      if (typeof parsed.type === 'string') tiposRecebidos.push(parsed.type);
    } catch {
      // frame não-parseável não conta
    }
  };
  ws.on('message', listener);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  ws.off('message', listener);
  assert.deepEqual(
    tiposRecebidos,
    [],
    `esperado silêncio, chegaram: ${tiposRecebidos.join(', ')}`,
  );
}

async function esperarSilencioDeTipo(ws: WebSocket, tipo: string, ms: number): Promise<void> {
  const recebidos: Record<string, unknown>[] = [];
  const listener = (data: unknown): void => {
    try {
      const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
      if (parsed.type === tipo) recebidos.push(parsed as Record<string, unknown>);
    } catch {
      // ignora
    }
  };
  ws.on('message', listener);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  ws.off('message', listener);
  assert.deepEqual(recebidos, [], `esperado nenhum '${tipo}' extra, chegaram ${recebidos.length}`);
}

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

function comandoDeChat(jogadorId: string, conteudo: string): unknown {
  return { type: 'ENVIAR_MENSAGEM_DE_CHAT', jogadorId, conteudo };
}

function mensagemFake(n: number, jogadorId = 'jogador-1'): MensagemDeChatDaPartidaEvento {
  return {
    type: 'MENSAGEM_DE_CHAT_DA_PARTIDA',
    jogadorId,
    apelido: jogadorId,
    conteudo: `msg-${n}`,
    enviadoEm: new Date(Date.now() + n).toISOString(),
  };
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

test('cap 50 somadas (humanas+bot) com aparo no topo, fora do blob de estado', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaComBot());

    const humano = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const bot = await conectarBotPartida(servidor, aceite.partidaId, 'bot-1', 'Bot Camareiro');
    await esperarEvento(humano.ws, 'PARTIDA_INICIADA');

    const estadoAntes = await obterEstadoDaPartida(redis, aceite.partidaId);
    assert.ok(estadoAntes !== null);
    const estadoAntesJson = JSON.stringify(estadoAntes);

    try {
      // 1 humana + 59 do bot = 60 somadas; o bot fura o rate-limit e permite a
      // rajada rápida pela mesma cadeia serial do julgamento.
      enviar(humano.ws, comandoDeChat('jogador-1', 'humana-0'));
      await esperarEvento(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');

      const totalBot = 59;
      const framesHumano = coletarEventos(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', totalBot);
      const framesBot = coletarEventos(bot, 'MENSAGEM_DE_CHAT_DA_PARTIDA', totalBot + 1);
      for (let i = 1; i <= totalBot; i += 1) {
        enviar(bot, comandoDeChat('bot-1', `bot-${i}`));
      }
      const recebidasHumano = await framesHumano;
      const recebidasBot = await framesBot;
      assert.equal(recebidasHumano.length, totalBot);
      assert.equal(recebidasBot.length, totalBot + 1);

      // Cap: LLEN<=50 e LRANGE ordenado com as 50 mais novas.
      const chaveChat = chaveDoChatDaPartida(aceite.partidaId);
      const llen = await redis.llen(chaveChat);
      assert.equal(llen, HISTORICO_MAXIMO);
      const historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historico.length, HISTORICO_MAXIMO);
      const conteudos = historico.map((m) => m.conteudo);
      // 60 somadas (humana-0 + bot-1..bot-59), aparo no topo: caem as 10 mais
      // antigas (humana-0 + bot-1..bot-9), ficam bot-10..bot-59.
      assert.deepEqual(
        conteudos,
        Array.from({ length: 50 }, (_, i) => `bot-${i + 10}`),
      );
      // Ordem oldest→newest preservada e sem duplicadas.
      assert.deepEqual([...new Set(conteudos)].length, HISTORICO_MAXIMO);
      for (const msg of historico) {
        assert.equal(msg.type, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
        assert.ok(Number.isFinite(new Date(msg.enviadoEm).getTime()));
      }

      // Fora do blob: o estado do engine não mudou com o chat.
      const estadoDepois = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estadoDepois !== null);
      assert.deepEqual(estadoDepois, JSON.parse(estadoAntesJson));
    } finally {
      humano.ws.close();
      bot.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
    // Cancelamento limpa o histórico junto.
    assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);
  } finally {
    await servidor.fechar();
  }
});

test('recusas nunca escrevem no histórico', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    try {
      enviar(jogador1.ws, comandoDeChat('jogador-1', '   '));
      const vazia = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(vazia.codigo, 'MENSAGEM_VAZIA');

      enviar(jogador1.ws, comandoDeChat('jogador-1', 'x'.repeat(301)));
      const longa = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(longa.codigo, 'MENSAGEM_LONGA_DEMAIS');

      const historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.deepEqual(historico, []);
      assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('preparada sem mensagens não tem lista; cancelamento condicional limpa o chat', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    // Só um admite: segue preparada — lista vazia não existe no Redis.
    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    try {
      assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);

      // Chat na preparada é recusado e não cria lista.
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Cheguei primeiro.'));
      const erro = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'DADOS_INVALIDOS');
      assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);

      // Simula a corrida admissão-vs-escrita: histórico gravado direto na
      // preparada, então o DEL condicional do não-início o remove junto.
      await adicionarMensagemAoHistorico(redis, aceite.partidaId, mensagemFake(1));
      assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 1);
      const cancelada = await cancelarPartidaSeNaoIniciada(redis, aceite.partidaId);
      assert.equal(cancelada, true);
      assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);
    } finally {
      jogador1.ws.close();
    }
  } finally {
    await servidor.fechar();
  }
});

test('término mantém o histórico com TTL de retenção', async () => {
  const ttlTerminada = 30;
  const servidor = await subirServidor(600, ttlTerminada);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    try {
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Antes do fim 1.'));
      await esperarEvento(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      // Segunda do mesmo autor exigiria 2s — usa o outro membro para a 2ª.
      enviar(jogador2.ws, comandoDeChat('jogador-2', 'Antes do fim 2.'));
      await esperarEvento(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');

      let historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historico.length, 2);

      // Desistência 2→1 termina em derrota (quórum mínimo, ADR-0013).
      const terminada = esperarEvento(jogador1.ws, 'PARTIDA_TERMINADA');
      enviar(jogador2.ws, { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-2' });
      await terminada;

      // Viva no término: histórico preservado com TTL de retenção.
      historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historico.length, 2);
      assert.deepEqual(historico.map((m) => m.conteudo), ['Antes do fim 1.', 'Antes do fim 2.']);

      const { chaveDaPartida } = await import('../src/partidas/chaves.ts');
      const { chaveDoEstadoDaPartida } = await import('../src/partidas/chaves.ts');
      const ttlPartida = await redis.ttl(chaveDaPartida(aceite.partidaId));
      const ttlEstado = await redis.ttl(chaveDoEstadoDaPartida(aceite.partidaId));
      const ttlChat = await redis.ttl(chaveDoChatDaPartida(aceite.partidaId));
      assert.ok(ttlPartida > 0 && ttlPartida <= ttlTerminada, `TTL da partida inválido: ${ttlPartida}`);
      assert.ok(ttlEstado > 0 && ttlEstado <= ttlTerminada, `TTL do estado inválido: ${ttlEstado}`);
      assert.ok(ttlChat > 0 && ttlChat <= ttlTerminada, `TTL do chat inválido: ${ttlChat}`);

      // Pós-Resultado o chat segue persistindo na mesma lista de retenção.
      // Rate-limit de 2s por Jogador (issue #390): a última aprovada de
      // jogador-1 foi "Antes do fim 1." — aguarda o intervalo antes de falar.
      await new Promise<void>((resolve) => setTimeout(resolve, 2100));
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Depois do fim.'));
      await esperarEvento(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historico.length, 3);
      assert.equal(historico[2]?.conteudo, 'Depois do fim.');
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);
  } finally {
    await servidor.fechar();
  }
});

test('reconexão recebe tabuleiro+chat do mesmo instante sob rajada de bot, sem replay', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaComBot());

    const humano = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const bot = await conectarBotPartida(servidor, aceite.partidaId, 'bot-1', 'Bot Camareiro');
    await esperarEvento(humano.ws, 'PARTIDA_INICIADA');

    try {
      // Baseline: 1 humana + 2 do bot.
      enviar(humano.ws, comandoDeChat('jogador-1', 'base-humana'));
      await esperarEvento(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      enviar(bot, comandoDeChat('bot-1', 'base-bot-1'));
      enviar(bot, comandoDeChat('bot-1', 'base-bot-2'));
      await coletarEventos(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 2);

      // Rajada do bot antes da volta: 20 rápidas pela mesma cadeia serial.
      const rajada = 20;
      const framesRajada = coletarEventos(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', rajada);
      for (let i = 1; i <= rajada; i += 1) {
        enviar(bot, comandoDeChat('bot-1', `rajada-${i}`));
      }
      await framesRajada;

      const historicoAntes = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historicoAntes.length, 3 + rajada);

      // Volta: fecha e reconecta o humano; o snapshot chega em único
      // ESTADO_DA_PARTIDA com tabuleiro+chat do mesmo instante.
      humano.ws.close();
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const token = await tokenParaJogador('jogador-1', 'Jogador 1');
      const ws2 = new WebSocket(servidor.wsUrl(aceite.partidaId, token));
      const snapshotPromise = esperarEvento(ws2, 'ESTADO_DA_PARTIDA');
      await new Promise<void>((resolve, reject) => {
        ws2.once('open', () => resolve());
        ws2.once('error', reject);
      });
      const aceita = await esperarEvento(ws2, 'ADMISSAO_ACEITA');
      assert.equal(aceita.jogadorId, 'jogador-1');
      const envelope = await snapshotPromise;
      const snapshot = envelope.snapshot as {
        tabuleiro: unknown;
        jogadorAtivoId: unknown;
        historicoDeChat?: MensagemDeChatDaPartidaEvento[];
      };
      assert.ok(snapshot.tabuleiro !== undefined);
      assert.ok(snapshot.jogadorAtivoId !== undefined);
      assert.ok(Array.isArray(snapshot.historicoDeChat));
      assert.equal(snapshot.historicoDeChat?.length, 3 + rajada);
      assert.deepEqual(
        snapshot.historicoDeChat?.map((m) => m.conteudo),
        ['base-humana', 'base-bot-1', 'base-bot-2', ...Array.from({ length: rajada }, (_, i) => `rajada-${i + 1}`)],
      );
      // Idêntico ao LRANGE do mesmo instante e sem duplicadas.
      const historicoDepois = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.deepEqual(snapshot.historicoDeChat, historicoDepois);

      // Sem replay separado: nenhum MENSAGEM_DE_CHAT_DA_PARTIDA extra após o
      // snapshot (só TURNO_INICIADO/CELULAS_ILUMINADAS do anunciarTurnoAtual).
      await esperarSilencioDeTipo(ws2, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 500);

      ws2.close();
    } finally {
      try { humano.ws.close(); } catch {}
      try { bot.close(); } catch {}
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
