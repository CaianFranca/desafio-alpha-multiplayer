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
import { chaveDaPartida, chaveDoChatDaPartida, chaveDoEstadoDaPartida } from '../src/partidas/chaves.ts';
import {
  adicionarMensagemAoHistorico,
  normalizarTetoDoHistorico,
  obterHistoricoDoChat,
} from '../src/partidas/historico-chat.ts';
import { cancelarPartidaSeNaoIniciada } from '../src/partidas/partidas.ts';

// SERVER_ID por processo (follow-up #398/F3): duas instâncias da suíte no
// mesmo Redis (paralelo local ou `tsx --test` com outros arquivos) não podem
// partilhar identidade — partidaIds já são uuid, mas o serverId compõe URLs,
// JWT de bot e chaves de registro; o sufixo elimina a classe inteira.
const SERVER_ID = `game-server-teste-historico-chat-${process.pid}`;
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

test('normalizarTetoDoHistorico valida 1..200 com warn no fallback', async () => {
  assert.equal(normalizarTetoDoHistorico(undefined), 50);
  assert.equal(normalizarTetoDoHistorico(1), 1);
  assert.equal(normalizarTetoDoHistorico(2), 2);
  assert.equal(normalizarTetoDoHistorico(200), 200);
  const warns: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warns.push(args); };
  try {
    assert.equal(normalizarTetoDoHistorico(0), 50);
    assert.equal(normalizarTetoDoHistorico(201), 50);
    assert.equal(normalizarTetoDoHistorico(Number.NaN), 50);
    assert.ok(warns.length >= 3, `esperado warn no fallback, viram ${warns.length}`);
  } finally {
    console.warn = original;
  }
});

test('teto custom 1/2 respeitado com aparo no topo', async () => {
  const partidaId = `teto-custom-${crypto.randomUUID()}`;
  const chavePartida = chaveDaPartida(partidaId);
  const chaveChat = chaveDoChatDaPartida(partidaId);
  try {
    await redis.set(chavePartida, JSON.stringify({ partidaId, estado: 'em_andamento' }), 'EX', 600);
    // Teto 2: 3 escritas → ficam as 2 mais novas.
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(1), 2);
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(2), 2);
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(3), 2);
    assert.equal(await redis.llen(chaveChat), 2);
    const historico2 = await obterHistoricoDoChat(redis, partidaId);
    assert.deepEqual(historico2.map((m) => m.conteudo), ['msg-2', 'msg-3']);
    // Teto 1: próxima escrita apara para 1.
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(4), 1);
    assert.equal(await redis.llen(chaveChat), 1);
    const historico1 = await obterHistoricoDoChat(redis, partidaId);
    assert.deepEqual(historico1.map((m) => m.conteudo), ['msg-4']);
  } finally {
    await redis.del(chaveChat);
    await redis.del(chavePartida);
  }
});

test('TTL espelhado: EXPIRE na preparada e PERSIST em andamento', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());
    try {
      // Preparada tem EXPIRE: escrita espelha TTL>0.
      await adicionarMensagemAoHistorico(redis, aceite.partidaId, mensagemFake(1));
      const ttlPreparada = await redis.ttl(chaveDaPartida(aceite.partidaId));
      const ttlChatPreparada = await redis.ttl(chaveDoChatDaPartida(aceite.partidaId));
      assert.ok(ttlPreparada > 0, `TTL da preparada inválido: ${ttlPreparada}`);
      assert.ok(ttlChatPreparada > 0 && ttlChatPreparada <= ttlPreparada + 1, `TTL do chat na preparada inválido: ${ttlChatPreparada} vs ${ttlPreparada}`);

      // Vira em_andamento (PERSIST, TTL -1): escrita espelha PERSIST.
      const j1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
      const j2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
        (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
      ]);
      await j2.esperas[0];
      try {
        assert.equal(await redis.ttl(chaveDaPartida(aceite.partidaId)), -1);
        await adicionarMensagemAoHistorico(redis, aceite.partidaId, mensagemFake(2));
        assert.equal(await redis.ttl(chaveDoChatDaPartida(aceite.partidaId)), -1);
      } finally {
        j1.ws.close();
        j2.ws.close();
      }
    } finally {
      await deletePartida(servidor.baseUrl, aceite.partidaId);
    }
  } finally {
    await servidor.fechar();
  }
});

test('ttl==0 vira DEL, nunca PERSIST', async () => {
  const partidaId = `ttl-zero-${crypto.randomUUID()}`;
  const chavePartida = chaveDaPartida(partidaId);
  const chaveChat = chaveDoChatDaPartida(partidaId);
  try {
    await redis.set(chavePartida, JSON.stringify({ partidaId, estado: 'preparada' }));
    // PTTL <1s faz TTL (em segundos) retornar 0 — partida expirando.
    await redis.pexpire(chavePartida, 500);
    const ttlAntes = await redis.ttl(chavePartida);
    assert.ok(ttlAntes === 0 || ttlAntes === 1, `pré-condição TTL 0/1, veio ${ttlAntes}`);
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(1));
    // Nunca órfão sem TTL: ou DEL imediato (ttl 0) ou EXPIRE espelhado (ttl 1).
    // Nos dois casos, jamais PERSIST (-1).
    const ttlChat = await redis.ttl(chaveChat);
    assert.notEqual(ttlChat, -1, 'chat jamais persiste com partida expirando');
    if (ttlAntes === 0) {
      assert.equal(await redis.exists(chaveChat), 0, 'ttl==0 deve dar DEL no chat');
    }
  } finally {
    await redis.del(chaveChat);
    await redis.del(chavePartida);
  }
});

test('frame corrompido ignorado com warn e contador', async () => {
  const partidaId = `corrompido-${crypto.randomUUID()}`;
  const chavePartida = chaveDaPartida(partidaId);
  const chaveChat = chaveDoChatDaPartida(partidaId);
  try {
    await redis.set(chavePartida, JSON.stringify({ partidaId, estado: 'em_andamento' }), 'EX', 600);
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(1));
    await redis.rpush(chaveChat, 'não-é-json{{{');
    await adicionarMensagemAoHistorico(redis, partidaId, mensagemFake(2));
    // Reordena para o corrompido ficar no meio: reescreve a lista com 3
    // entradas onde a do meio é inválida.
    await redis.del(chaveChat);
    await redis.rpush(chaveChat, JSON.stringify(mensagemFake(1)), 'não-é-json{{{', JSON.stringify(mensagemFake(2)));
    await redis.expire(chaveChat, 600);
    const warns: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args); };
    let historico;
    try {
      historico = await obterHistoricoDoChat(redis, partidaId);
    } finally {
      console.warn = original;
    }
    assert.equal(historico.length, 2);
    assert.deepEqual(historico.map((m) => m.conteudo), ['msg-1', 'msg-2']);
    assert.equal(warns.length, 1, 'esperado 1 warn com contador');
    const detalhe = warns[0]?.[1] as { corrompidas?: number; total?: number } | undefined;
    assert.equal(detalhe?.corrompidas, 1);
    assert.equal(detalhe?.total, 3);
  } finally {
    await redis.del(chaveChat);
    await redis.del(chavePartida);
  }
});

test('falha de persistência não recusa o live; falha de leitura degrada snapshot para []', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());
    const humano = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const outro = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await outro.esperas[0];
    try {
      // Falha só no EVAL do histórico (contém RPUSH): live deve seguir.
      const redisQualquer = redis as unknown as Record<string, unknown>;
      const evalOriginal = redis.eval.bind(redis);
      redisQualquer['eval'] = async (...args: unknown[]) => {
        const script = String(args[0] ?? '');
        if (script.includes('RPUSH') && script.includes('LTRIM')) {
          throw new Error('boom no histórico');
        }
        return (evalOriginal as (...a: unknown[]) => Promise<unknown>)(...args);
      };
      try {
        // Duas rápidas: com consumo só após persistir, nenhuma consome
        // crédito — ambas chegam live (sem LIMITE_DE_MENSAGENS).
        const live1 = esperarEvento(outro.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
        enviar(humano.ws, comandoDeChat('jogador-1', 'live-apesar-do-boom-1'));
        const recebida1 = await live1;
        assert.equal(recebida1.conteudo, 'live-apesar-do-boom-1');
        const live2 = esperarEvento(outro.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
        enviar(humano.ws, comandoDeChat('jogador-1', 'live-apesar-do-boom-2'));
        const recebida2 = await live2;
        assert.equal(recebida2.conteudo, 'live-apesar-do-boom-2');
      } finally {
        redisQualquer['eval'] = evalOriginal;
      }

      // Falha só no LRANGE do chat: snapshot degrada para [] sem negar.
      const lrangeOriginal = redis.lrange.bind(redis);
      redisQualquer['lrange'] = async () => {
        throw new Error('boom no lrange');
      };
      try {
        const { PartidaBroadcaster: BroadcasterLocal } = await import('../src/partidas/broadcast.ts');
        const { PartidaHandlers: HandlersLocal } = await import('../src/partidas/handlers.ts');
        const handlers = new HandlersLocal({ redis, broadcaster: new BroadcasterLocal() });
        const snapshot = await handlers.lerSnapshotAtomico(aceite.partidaId);
        assert.ok(snapshot !== null);
        assert.deepEqual(snapshot?.historico, []);
      } finally {
        redisQualquer['lrange'] = lrangeOriginal;
      }
    } finally {
      humano.ws.close();
      outro.ws.close();
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rajada durante snapshot atômico: prefixo ordenado sem duplicadas e sem replay extra', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaComBot());
    const humano = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const bot = await conectarBotPartida(servidor, aceite.partidaId, 'bot-1', 'Bot Camareiro');
    await esperarEvento(humano.ws, 'PARTIDA_INICIADA');
    try {
      enviar(humano.ws, comandoDeChat('jogador-1', 'base-humana'));
      await esperarEvento(humano.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');

      // Volta com rajada DURANTE o snapshot: abre ws2 e dispara 20 do bot
      // sem esperar o ESTADO_DA_PARTIDA — a cadeia serial ordena snapshot e
      // escritas no mesmo instante intra-processo.
      humano.ws.close();
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      const token = await tokenParaJogador('jogador-1', 'Jogador 1');
      const ws2 = new WebSocket(servidor.wsUrl(aceite.partidaId, token));
      // Listeners ANTES do open (padrão dos testes do canal): evita perder
      // ADMISSAO_ACEITA/ESTADO_DA_PARTIDA quando a admissão é rápida.
      const aceitaPromise = esperarEvento(ws2, 'ADMISSAO_ACEITA');
      const snapshotPromise = esperarEvento(ws2, 'ESTADO_DA_PARTIDA');
      await new Promise<void>((resolve, reject) => {
        ws2.once('open', () => resolve());
        ws2.once('error', reject);
      });
      const rajada = 20;
      for (let i = 1; i <= rajada; i += 1) {
        enviar(bot, comandoDeChat('bot-1', `durante-${i}`));
      }
      const aceita = await aceitaPromise;
      assert.equal(aceita.jogadorId, 'jogador-1');
      const envelope = await snapshotPromise;
      const snapshot = envelope.snapshot as { historicoDeChat?: MensagemDeChatDaPartidaEvento[] };
      assert.ok(Array.isArray(snapshot.historicoDeChat));
      const conteudos = snapshot.historicoDeChat?.map((m) => m.conteudo) ?? [];
      // Sem duplicadas e ordenado como prefixo do final.
      assert.deepEqual([...new Set(conteudos)].length, conteudos.length, 'snapshot sem duplicadas');
      assert.ok(conteudos.length >= 1 && conteudos.length <= 1 + rajada, `snapshot é prefixo atômico, veio ${conteudos.length}`);
      assert.equal(conteudos[0], 'base-humana');
      // Espera a rajada assentar por poll (robusto sob carga) e confere que
      // o snapshot é prefixo do final.
      let final: MensagemDeChatDaPartidaEvento[] = [];
      for (let tentativa = 0; tentativa < 50; tentativa += 1) {
        final = await obterHistoricoDoChat(redis, aceite.partidaId);
        if (final.length === 1 + rajada) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      const finais = final.map((m) => m.conteudo);
      assert.equal(finais.length, 1 + rajada);
      assert.deepEqual(finais.slice(0, conteudos.length), conteudos, 'snapshot é prefixo ordenado do LRANGE final');
      // Sem replay separado após o snapshot.
      await esperarSilencioDeTipo(ws2, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 500);
      ws2.close();
    } finally {
      try { humano.ws.close(); } catch {}
      try { bot.close(); } catch {}
    }
    await deletePartida(servidor.baseUrl, aceite.partidaId);
    assert.equal(await redis.exists(chaveDoChatDaPartida(aceite.partidaId)), 0);
    assert.equal(await redis.exists(chaveDaPartida(aceite.partidaId)), 0);
    assert.equal(await redis.exists(chaveDoEstadoDaPartida(aceite.partidaId)), 0);
  } finally {
    await servidor.fechar();
  }
});
