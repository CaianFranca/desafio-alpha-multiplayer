// Testes unitários do stream de debug do lobby-server (issue #340,
// "Modo Desenvolvedor"). Padrão de broadcaster.test.ts: chamada direta da
// classe com sockets falsos, sem servidor nem Redis — o resolver de salaId é
// injetado determinístico.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { DebugStreamDasSalas, tipoDeComandoDeDebug } from '../src/ws/debug-stream.ts';
import type { AuthenticatedWebSocket } from '../src/ws/ws.ts';

function socketFalso(jogadorId?: string): AuthenticatedWebSocket {
  const falso = { readyState: WebSocket.OPEN, data: jogadorId === undefined ? undefined : { jogadorId } } as unknown as AuthenticatedWebSocket;
  (falso as unknown as { OPEN: number }).OPEN = WebSocket.OPEN;
  (falso as unknown as { recebidos: unknown[] }).recebidos = [];
  (falso as unknown as { send: (payload: string) => void }).send = (payload: string) => {
    (falso as unknown as { recebidos: unknown[] }).recebidos.push(JSON.parse(payload) as unknown);
  };
  return falso;
}

function recebidos(socket: AuthenticatedWebSocket): Array<{ type: string; nivel?: string; contexto?: string; mensagem?: string }> {
  return (socket as unknown as { recebidos: unknown[] }).recebidos as never;
}

function streamCom(resolucoes: Record<string, string | null>): DebugStreamDasSalas {
  return new DebugStreamDasSalas({
    resolverSalaId: async (jogadorId) => resolucoes[jogadorId] ?? null,
  });
}

test('tipoDeComandoDeDebug: reconhece apenas ATIVAR_DEBUG/DESATIVAR_DEBUG', () => {
  assert.equal(tipoDeComandoDeDebug({ type: 'ATIVAR_DEBUG' }), 'ATIVAR_DEBUG');
  assert.equal(tipoDeComandoDeDebug({ type: 'DESATIVAR_DEBUG' }), 'DESATIVAR_DEBUG');
  assert.equal(tipoDeComandoDeDebug({ type: 'CRIAR_SALA' }), null);
  assert.equal(tipoDeComandoDeDebug({ type: 'PING' }), null);
  assert.equal(tipoDeComandoDeDebug('x'), null);
  assert.equal(tipoDeComandoDeDebug(null), null);
});

test('ATIVAR_DEBUG envia ack e registra o cliente', async () => {
  const stream = streamCom({ 'jogador-a': 'sala-1' });
  const socket = socketFalso('jogador-a');

  await stream.receberComando(socket, 'ATIVAR_DEBUG');

  assert.equal(stream.totalDeAtivos, 1);
  assert.equal(recebidos(socket).length, 1);
  assert.equal(recebidos(socket)[0]?.type, 'DEBUG_LOG');
  assert.match(recebidos(socket)[0]?.mensagem ?? '', /ativado/);
});

test('emitir: entrega unicast só aos ativos escopados à Sala', async () => {
  const stream = streamCom({ 'jogador-a': 'sala-1', 'jogador-b': 'sala-2' });
  const a = socketFalso('jogador-a');
  const b = socketFalso('jogador-b');
  await stream.receberComando(a, 'ATIVAR_DEBUG');
  await stream.receberComando(b, 'ATIVAR_DEBUG');
  recebidos(a).length = 0;
  recebidos(b).length = 0;

  stream.emitir('sala-1', 'info', 'sala criada');

  assert.equal(recebidos(a).length, 1);
  assert.equal(recebidos(a)[0]?.mensagem, 'sala criada');
  assert.equal(recebidos(a)[0]?.contexto, 'lobby');
  assert.equal(recebidos(b).length, 0, 'ativo de outra Sala não recebe');
});

test('emitir: ativo sem escopo re-resolve e passa a receber as emissões', async () => {
  // Jogador ativou antes de entrar numa Sala; depois entra na sala-9.
  const resolucoes: Record<string, string | null> = { 'jogador-a': null };
  const stream = new DebugStreamDasSalas({
    resolverSalaId: async (jogadorId) => resolucoes[jogadorId] ?? null,
  });
  const a = socketFalso('jogador-a');
  await stream.receberComando(a, 'ATIVAR_DEBUG');
  assert.match(recebidos(a)[recebidos(a).length - 1]?.mensagem ?? '', /sem sala/);

  stream.emitir('sala-9', 'info', 'primeira emissão perdida');
  // A resolução é assíncrona (microtask): aguarda o próximo tick.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recebidos(a).length, 1, 'emissão anterior à resolução não é retroativa');

  resolucoes['jogador-a'] = 'sala-9';
  stream.emitir('sala-9', 'info', 'entrada na sala');
  // A resolução da segunda emissão também é assíncrona: aguarda o tick.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recebidos(a)[recebidos(a).length - 1]?.mensagem, 'entrada na sala');
});

test('DESATIVAR_DEBUG envia ack e encerra o stream', async () => {
  const stream = streamCom({ 'jogador-a': 'sala-1' });
  const socket = socketFalso('jogador-a');
  await stream.receberComando(socket, 'ATIVAR_DEBUG');

  await stream.receberComando(socket, 'DESATIVAR_DEBUG');

  assert.equal(stream.totalDeAtivos, 0);
  const acks = recebidos(socket).filter((e) => e.mensagem?.includes('encerrado'));
  assert.equal(acks.length, 1, 'ack de encerramento entregue');

  stream.emitir('sala-1', 'info', 'depois de desativar');
  assert.equal(recebidos(socket).length, 2, 'sem novas emissões após desativar');
});

test('desconectar (close) encerra o stream', async () => {
  const stream = streamCom({ 'jogador-a': 'sala-1' });
  const socket = socketFalso('jogador-a');
  await stream.receberComando(socket, 'ATIVAR_DEBUG');

  stream.desconectar(socket);
  stream.emitir('sala-1', 'warn', 'depois do close');

  assert.equal(stream.totalDeAtivos, 0);
  const depois = recebidos(socket).filter((e) => e.mensagem?.includes('depois do close'));
  assert.equal(depois.length, 0);
});

test('emitirParaSocket: erros vão só ao originador ativo', async () => {
  const stream = streamCom({ 'jogador-a': 'sala-1' });
  const ativo = socketFalso('jogador-a');
  const comum = socketFalso('jogador-comum');
  await stream.receberComando(ativo, 'ATIVAR_DEBUG');

  stream.emitirParaSocket(ativo, 'error', 'ERRO_DA_SALA DADOS_INVALIDOS: teste');
  stream.emitirParaSocket(comum, 'error', 'não deveria sair');

  const erros = recebidos(ativo).filter((e) => e.nivel === 'error');
  assert.equal(erros.length, 1);
  assert.equal(recebidos(comum).length, 0, 'socket sem debug ativo não recebe');
});
