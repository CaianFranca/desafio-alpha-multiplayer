// Testes de integração do Chat da Sala no lobby-server (issue #34).
//
// Cobre o contrato WS de `ENVIAR_MENSAGEM_DE_CHAT` (broadcast para todos os
// Membros), o histórico em Redis entregue a quem entra (`membro_admitido`),
// a rejeição de mensagens vazias/longas (sem broadcast) e a destruição do
// histórico quando a Sala encerra. Reutiliza o harness de
// `./helpers/salas-ws.ts` (sem duplicação).
//
// Pré-condições: Postgres e Redis acessíveis via `getConfig()` (profile
// `backend` do compose). TRUNCATE+FLUSHDB entre testes (via `configurarHooks`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MensagemDeChatEvento } from '@flicker/shared';
import { redisClient } from '../src/config/redis.ts';
import { chaveSalaChat } from '../src/salas/projecao.ts';
import {
  comServidor,
  registrarJogador,
  conectarWs,
  enviar,
  esperarMensagem,
  esperarSalaAtualizada,
  coletarEventos,
  esperarErro,
  esperarSilencio,
  esperarClose,
  configurarHooks,
  membroDaSala,
} from './helpers/salas-ws.ts';

configurarHooks();

// --- 1. Mensagem <=500 entregue a todos os Membros ---

test('ENVIAR_MENSAGEM_DE_CHAT: mensagem <=500 é entregue a todos os Membros', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const membroAId = membroDaSala(criacao.sala, a.id).id;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'oi' });

    const rawA = await esperarMensagem(wsA);
    const msgA = JSON.parse(rawA) as MensagemDeChatEvento;
    assert.equal(msgA.type, 'MENSAGEM_DE_CHAT');
    assert.equal(msgA.conteudo, 'oi');
    assert.equal(msgA.apelido, a.apelido);
    assert.equal(msgA.membroId, membroAId);
    assert.equal(typeof msgA.enviadoEm, 'string');
    assert.ok(!Number.isNaN(Date.parse(msgA.enviadoEm)));

    const rawB = await esperarMensagem(wsB);
    const msgB = JSON.parse(rawB) as MensagemDeChatEvento;
    assert.equal(msgB.type, 'MENSAGEM_DE_CHAT');
    assert.equal(msgB.conteudo, 'oi');
    assert.equal(msgB.apelido, a.apelido);
    assert.equal(msgB.membroId, membroAId);
    assert.equal(msgB.enviadoEm, msgA.enviadoEm);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 2. Quem entra recebe o histórico ---

test('ENTRAR_NA_SALA: Membro que entra recebe o histórico de chat (replay)', async () => {
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

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'msg1' });
    await esperarMensagem(wsA);
    await esperarMensagem(wsB);

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'msg2' });
    await esperarMensagem(wsA);
    await esperarMensagem(wsB);

    // C entra: MEMBRO_ENTROU + SALA_ATUALIZADA + 2 mensagens de replay.
    enviar(wsC, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    const eventosC = await coletarEventos(wsC, 4);
    assert.equal(eventosC[0]?.type, 'MEMBRO_ENTROU');
    assert.equal(eventosC[1]?.type, 'SALA_ATUALIZADA');
    assert.equal(eventosC[2]?.type, 'MENSAGEM_DE_CHAT');
    assert.equal(eventosC[3]?.type, 'MENSAGEM_DE_CHAT');
    assert.equal((eventosC[2] as MensagemDeChatEvento).conteudo, 'msg1');
    assert.equal((eventosC[3] as MensagemDeChatEvento).conteudo, 'msg2');

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

// --- 3. Mensagem vazia recusada (sem broadcast) ---

test('ENVIAR_MENSAGEM_DE_CHAT: mensagem vazia é recusada sem broadcast', async () => {
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

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: '' });
    await esperarErro(wsA, 'DADOS_INVALIDOS');
    await esperarSilencio(wsB);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 4. Mensagem com 501 caracteres recusada (sem broadcast) ---

test('ENVIAR_MENSAGEM_DE_CHAT: mensagem com 501 caracteres é recusada sem broadcast', async () => {
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

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'x'.repeat(501) });
    await esperarErro(wsA, 'DADOS_INVALIDOS');
    await esperarSilencio(wsB);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});

// --- 5. Histórico some ao encerrar a Sala ---

test('ENVIAR_MENSAGEM_DE_CHAT: histórico é destruído quando a Sala encerra', async () => {
  await comServidor(async (servidor) => {
    const a = await registrarJogador(servidor.baseUrl);
    const b = await registrarJogador(servidor.baseUrl);
    const wsA = await conectarWs(servidor.wsUrl, a.cookies);
    const wsB = await conectarWs(servidor.wsUrl, b.cookies);

    enviar(wsA, { type: 'CRIAR_SALA' });
    const criacao = await esperarSalaAtualizada(wsA);
    const codigo = criacao.sala.codigoDeSala;
    const salaId = criacao.sala.id;

    enviar(wsB, { type: 'ENTRAR_NA_SALA', codigoDeSala: codigo });
    await coletarEventos(wsB, 2);
    await coletarEventos(wsA, 2);

    enviar(wsA, { type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'histórico' });
    await esperarMensagem(wsA);
    await esperarMensagem(wsB);

    // Histórico existe no Redis antes do encerramento (a chave é uma LISTA).
    const existeAntes = await redisClient.exists(chaveSalaChat(salaId));
    assert.equal(existeAntes, 1, 'histórico deveria existir antes do encerramento');
    const historicoAntes = await redisClient.lrange(chaveSalaChat(salaId), 0, -1);
    assert.equal(historicoAntes.length, 1);

    // A (anfitrião) sai -> sucessão para B, sala continua aberta.
    // A saída emite 4 eventos (MEMBRO_SAIU, SALA_ATUALIZADA,
    // ANFITRIAO_SUBSTITUIDO, SALA_ATUALIZADA) — drenamos todos para não
    // deixar eventos em buffer atrapalhando a leitura do encerramento.
    enviar(wsA, { type: 'SAIR_DA_SALA' });
    await coletarEventos(wsA, 4);
    await coletarEventos(wsB, 4);

    // B sai -> última saída encerra a Sala (MEMBRO_SAIU + SALA_ATUALIZADA
    // encerrada). O `limparSala` (que apaga o chat) é aguardado pelo
    // handler ANTES do broadcast, então ao recebermos estes eventos a
    // chave de chat já foi removida.
    enviar(wsB, { type: 'SAIR_DA_SALA' });
    await coletarEventos(wsB, 2);

    // Após o encerramento, a chave de chat deve ter sido removida.
    const existeDepois = await redisClient.exists(chaveSalaChat(salaId));
    assert.equal(existeDepois, 0);

    wsA.close();
    wsB.close();
    await Promise.all([esperarClose(wsA).catch(() => undefined), esperarClose(wsB).catch(() => undefined)]);
  });
});
