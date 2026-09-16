// Teste de integração do Chat de Partida no game-server (issue #390).
//
// Sobe app+WS efêmeros com Redis real (localhost:6379) e exercita a rota
// própria do chat: `ENVIAR_MENSAGEM_DE_CHAT` entra pelo canal da Partida e a
// mensagem aprovada chega a todo o roster vigente na MESMA ordem serial, com
// `enviadoEm` ISO do servidor; recusas (MENSAGEM_VAZIA, MENSAGEM_LONGA_DEMAIS,
// LIMITE_DE_MENSAGENS) vão SÓ ao autor, sem som (código próprio) e sem mudar
// o estado; chat vale em andamento e pós-Resultado, nunca na preparada
// (DADOS_INVALIDOS); o desistente é excluído do fan-out e recusado com
// JOGADOR_NAO_NA_PARTIDA; um Jogador NÃO-ATIVO conversa sem FORA_DA_VEZ; e o
// bot (roster com ehBot) fura o rate-limit — duas mensagens rápidas, ambas
// entregues.
//
// Roster de 2 membros: a admissão dos dois vira a partida para
// `em_andamento` (ST-14) sem precisar de nenhum comando de jogo — o chat é
// exercido puro, sem depender do loop de turnos.
//
// Cuidado com o timing da admissão (padrão dos testes do canal): os listeners
// de PARTIDA_INICIADA e dos eventos esperados são anexados ANTES do `open`
// (o broadcast de início acontece dentro da mesma virada de admissão) e os
// dois lados são anexados ANTES do comando que dispara o broadcast.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { criarClienteRedis, assinarBotToken, SESSION_ISS, SESSION_ACCESS_AUDIENCE } from '@flicker/config';
import type {
  AceiteDoEncaminhamento,
  MembroDaSala,
  OfertaDeEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { criarWebSocketServer } from '../src/ws/ws.ts';
import { PartidaBroadcaster } from '../src/partidas/broadcast.ts';
import { PartidaHandlers } from '../src/partidas/handlers.ts';
import { obterEstadoDaPartida } from '../src/partidas/estado.ts';

const SERVER_ID = 'game-server-teste-chat';
const JWT_SECRET = 'test_secret_para_chat';

const redis = criarClienteRedis();

interface ServidorEfemero {
  readonly baseUrl: string;
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
  return jwt.sign({ sub: jogadorId, apelido, sessaoId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', issuer: SESSION_ISS, audience: SESSION_ACCESS_AUDIENCE });
}

async function criarSessaoNoRedis(sessaoId: string, jogadorId: string): Promise<void> {
  await redis.set(`sessao:${sessaoId}`, JSON.stringify({ jogadorId, criadoEm: new Date().toISOString() }), 'EX', 3600);
}

/** Token de sessão (JWT + Redis) para um jogador do roster. */
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
    salaId: 'sala-chat',
    codigoDeSala: 'CHAT01',
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
    salaId: 'sala-chat-bot',
    codigoDeSala: 'CHAT02',
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
    body: JSON.stringify({ partidaId, motivo: 'limpeza do teste de chat' }),
  });
}

/**
 * Conecta um jogador do roster à partida passando pela admissão. Os
 * `preEsperas` são anexados ANTES do `open` (broadcasts da própria virada de
 * admissão não se perdem — ver cabeçalho).
 */
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

/** Conecta um bot autenticado por Service Token (sem sessão no Redis, #365). */
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

/**
 * Coleta `quantidade` mensagens WS do `tipo`, em ordem de chegada — a rajada
 * de chat chega como sequência e a ordem dos frames é a ordem do broadcast.
 */
function coletarEventos(
  ws: WebSocket,
  tipo: string,
  quantidade: number,
  timeoutMs = 10000,
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

/** Confirma que nenhuma mensagem chega ao socket na janela (recusas só ao autor). */
async function esperarSilencio(ws: WebSocket, ms: number): Promise<void> {
  const tiposRecebidos: string[] = [];
  const listener = (data: unknown): void => {
    try {
      const parsed = JSON.parse((data as Buffer).toString()) as { type?: unknown };
      if (typeof parsed.type === 'string') tiposRecebidos.push(parsed.type);
    } catch {
      // frame não-parseável não conta como tráfego de aplicação
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

function enviar(ws: WebSocket, mensagem: unknown): void {
  ws.send(JSON.stringify(mensagem));
}

function comandoDeChat(jogadorId: string, conteudo: string): unknown {
  return { type: 'ENVIAR_MENSAGEM_DE_CHAT', jogadorId, conteudo };
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

test('mensagem aprovada chega a todo o roster com enviadoEm do servidor e sem FORA_DA_VEZ para o não-ativo', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0]; // admissão completa inicia a partida (ST-14)

    try {
      // O jogador NÃO-ATIVO (jogador-2, no Primeiro Turno de jogador-1) envia:
      // o chat não é Ação de jogo — nunca responde FORA_DA_VEZ.
      enviar(jogador2.ws, comandoDeChat('jogador-2', 'Estou indo para o gerador.'));

      const recebida1 = await esperarEvento(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      const recebida2 = await esperarEvento(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');

      // Mesma mensagem para os dois: identidade da Sessão do autor, apelido
      // resolvido pelo servidor e marca de tempo ISO do servidor.
      assert.deepEqual(recebida1, recebida2);
      assert.equal(recebida1.jogadorId, 'jogador-2');
      assert.equal(recebida1.apelido, 'Jogador 2');
      assert.equal(recebida1.conteudo, 'Estou indo para o gerador.');
      assert.ok(Number.isFinite(new Date(recebida1.enviadoEm as string).getTime()));
      // Conteúdo chega normalizado a partir da emissão: o servidor é a
      // autoridade da forma.
      assert.equal(typeof recebida1.enviadoEm, 'string');

      // Estado da partida não mudou com o chat (não é Ação).
      const estado = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.ok(estado !== null);
      assert.equal(estado!.jogadorAtivoId, 'jogador-1');
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('recusas MENSAGEM_VAZIA, MENSAGEM_LONGA_DEMAIS e LIMITE_DE_MENSAGENS vão só ao autor, sem mudar o estado', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    const estadoAntes = await obterEstadoDaPartida(redis, aceite.partidaId);

    try {
      // Vazia: string só de espaços/quebras.
      enviar(jogador1.ws, comandoDeChat('jogador-1', '  \n\t  '));
      const vazia = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(vazia.codigo, 'MENSAGEM_VAZIA');
      await esperarSilencio(jogador2.ws, 400);

      // Longa demais: 301 caracteres (teto de 300 do chat de Partida).
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'x'.repeat(301)));
      const longa = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(longa.codigo, 'MENSAGEM_LONGA_DEMAIS');
      await esperarSilencio(jogador2.ws, 400);

      // Rate-limit: 2ª mensagem em menos de 2s é recusada ao autor.
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Primeira.'));
      await esperarEvento(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Segunda imediata.'));
      const limite = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(limite.codigo, 'LIMITE_DE_MENSAGENS');
      await esperarSilencio(jogador2.ws, 400);

      // Passado o intervalo desde a ÚLTIMA mensagem aprovada ("Primeira."),
      // o jogador fala de novo — a recusa do LIMITE não reinicia o relógio.
      await new Promise<void>((resolve) => setTimeout(resolve, 2100));
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Terceira, depois do intervalo.'));
      const aprovada = await esperarEvento(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      assert.equal(aprovada.conteudo, 'Terceira, depois do intervalo.');

      // Estado inalterado por nenhuma recusa (o chat nunca muta a Partida).
      const estadoDepois = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoDepois, estadoAntes);
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('chat na fase preparada é recusado com DADOS_INVALIDOS', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    // Só um membro conecta: a partida segue 'preparada' (ST-14 exige o roster
    // completo para virar em_andamento) — o chat não vale na preparada.
    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');

    try {
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Cheguei primeiro.'));
      const erro = await esperarEvento(jogador1.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(erro.codigo, 'DADOS_INVALIDOS');
      assert.equal(erro.mensagem, 'Chat disponível apenas com a Partida em andamento.');
    } finally {
      jogador1.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('pós-Resultado o chat segue broadcast e o desistente perde o acesso na hora', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    try {
      // Desistência de jogador-2: N−1 = 1 termina a partida (quórum mínimo,
      // ADR-0013). O socket do desistente segue aberto no teste — é exatamente
      // o caso de borda: jogador na tela da Partida após o Ato.
      const desistencia = esperarEvento(jogador2.ws, 'DESISTENCIA_REGISTRADA');
      const terminada = esperarEvento(jogador2.ws, 'PARTIDA_TERMINADA');
      enviar(jogador2.ws, { type: 'DESISTIR_DA_PARTIDA', jogadorId: 'jogador-2' });
      const desistiu = await desistencia;
      assert.equal(desistiu.jogadorId, 'jogador-2');
      await terminada;

      // O desistente tenta falar: recusado com JOGADOR_NAO_NA_PARTIDA.
      enviar(jogador2.ws, comandoDeChat('jogador-2', 'Voltei só para falar.'));
      const recusa = await esperarEvento(jogador2.ws, 'ERRO_DO_TABULEIRO');
      assert.equal(recusa.codigo, 'JOGADOR_NAO_NA_PARTIDA');
      await esperarSilencio(jogador1.ws, 400);

      // O restante conversa: broadcast vale após o Resultado — e o desistente
      // (socket aberto) NÃO recebe (excluído do fan-out).
      const recebida1 = esperarEvento(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Falo depois do fim, tudo bem.'));
      const aprovada = await recebida1;
      assert.equal(aprovada.jogadorId, 'jogador-1');
      assert.equal(aprovada.conteudo, 'Falo depois do fim, tudo bem.');
      await esperarSilencio(jogador2.ws, 400);
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('rajada alternada chega em sequência idêntica aos dois clientes (ordem serial)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    try {
      // Coletores anexados ANTES da rajada: os frames chegam na ordem do
      // broadcast e cada cliente deve ver a MESMA sequência serial.
      const frames1 = coletarEventos(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 4);
      const frames2 = coletarEventos(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 4);

      // Primeira leva: alternada, cada jogador dentro do próprio rate-limit.
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'um-1'));
      enviar(jogador2.ws, comandoDeChat('jogador-2', 'dois-1'));
      // Intervalo de 2s para a segunda leva do MESMO jogador (rate-limit).
      await new Promise<void>((resolve) => setTimeout(resolve, 2100));
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'um-2'));
      enviar(jogador2.ws, comandoDeChat('jogador-2', 'dois-2'));

      const recebidas1 = await frames1;
      const recebidas2 = await frames2;

      assert.deepEqual(recebidas1.map((m) => m.conteudo), ['um-1', 'dois-1', 'um-2', 'dois-2']);
      assert.deepEqual(recebidas2, recebidas1);
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('bot no roster envia duas mensagens rápidas e ambas são entregues (fura o rate-limit)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaComBot());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const bot = await conectarBotPartida(servidor, aceite.partidaId, 'bot-1', 'Bot Camareiro', );
    // A admissão do bot completa o roster e inicia a partida.
    await esperarEvento(jogador1.ws, 'PARTIDA_INICIADA');

    try {
      // Duas mensagens em sequência < 2s: o bot é isento do rate-limit.
      const framesHumano = coletarEventos(jogador1.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 2);
      const framesBot = coletarEventos(bot, 'MENSAGEM_DE_CHAT_DA_PARTIDA', 2);
      enviar(bot, comandoDeChat('bot-1', 'A luz do corredor sul piscou.'));
      enviar(bot, comandoDeChat('bot-1', 'Ouvi passos atrás de mim...'));

      const recebidasHumano = await framesHumano;
      const recebidasBot = await framesBot;
      assert.deepEqual(recebidasHumano.map((m) => m.conteudo), [
        'A luz do corredor sul piscou.',
        'Ouvi passos atrás de mim...',
      ]);
      assert.deepEqual(recebidasHumano, recebidasBot);
      for (const frame of recebidasHumano) {
        assert.equal(frame.jogadorId, 'bot-1');
        assert.equal(frame.apelido, 'Bot Camareiro');
      }
    } finally {
      jogador1.ws.close();
      bot.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});

test('histórico persiste a mensagem aprovada fora do blob (issue #388)', async () => {
  const servidor = await subirServidor(600);
  try {
    const aceite = await criarPartidaViaPost(servidor.baseUrl, ofertaDeDois());

    const jogador1 = await conectarPartida(servidor, aceite.partidaId, 'jogador-1', 'Jogador 1');
    const jogador2 = await conectarPartida(servidor, aceite.partidaId, 'jogador-2', 'Jogador 2', [
      (ws) => esperarEvento(ws, 'PARTIDA_INICIADA'),
    ]);
    await jogador2.esperas[0];

    const estadoAntes = await obterEstadoDaPartida(redis, aceite.partidaId);

    try {
      enviar(jogador1.ws, comandoDeChat('jogador-1', 'Histórico vivo.'));
      const aoVivo = await esperarEvento(jogador2.ws, 'MENSAGEM_DE_CHAT_DA_PARTIDA');
      assert.equal(aoVivo.conteudo, 'Histórico vivo.');

      const { obterHistoricoDoChat } = await import('../src/partidas/historico-chat.ts');
      const historico = await obterHistoricoDoChat(redis, aceite.partidaId);
      assert.equal(historico.length, 1);
      assert.deepEqual(historico[0], aoVivo);

      // Fora do blob: o estado do engine segue bit a bit.
      const estadoDepois = await obterEstadoDaPartida(redis, aceite.partidaId);
      assert.deepEqual(estadoDepois, estadoAntes);
    } finally {
      jogador1.ws.close();
      jogador2.ws.close();
    }

    await deletePartida(servidor.baseUrl, aceite.partidaId);
  } finally {
    await servidor.fechar();
  }
});
