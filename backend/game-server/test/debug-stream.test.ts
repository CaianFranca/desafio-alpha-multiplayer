// Testes unitários do stream de debug do game-server (issue #340,
// "Modo Desenvolvedor"). Padrão de traducao.test.ts: chamada direta da
// classe com sockets falsos — a Partida nasce escopada no upgrade, então
// o registro é direto por partidaId.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { DebugStreamDaPartida, tipoDeComandoDeDebug } from '../src/ws/debug-stream.ts';

function socketFalso(): WebSocket {
  const falso = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  (falso as unknown as { OPEN: number }).OPEN = WebSocket.OPEN;
  (falso as unknown as { recebidos: unknown[] }).recebidos = [];
  (falso as unknown as { send: (payload: string) => void }).send = (payload: string) => {
    (falso as unknown as { recebidos: unknown[] }).recebidos.push(JSON.parse(payload) as unknown);
  };
  return falso;
}

function recebidos(socket: WebSocket): Array<{ type: string; nivel?: string; contexto?: string; mensagem?: string }> {
  return (socket as unknown as { recebidos: unknown[] }).recebidos as never;
}

test('ATIVAR_DEBUG registra no escopo da Partida e envia ack', () => {
  const stream = new DebugStreamDaPartida();
  const socket = socketFalso();

  stream.receberComando(socket, 'partida-1', 'ATIVAR_DEBUG');

  assert.equal(stream.totalDeAtivos, 1);
  assert.equal(recebidos(socket).length, 1);
  assert.equal(recebidos(socket)[0]?.type, 'DEBUG_LOG');
  assert.match(recebidos(socket)[0]?.mensagem ?? '', /partida-1/);
  assert.equal(recebidos(socket)[0]?.contexto, 'partida');
});

test('emitir: julgamento de Ação chega só aos ativos daquela Partida', () => {
  const stream = new DebugStreamDaPartida();
  const dentro = socketFalso();
  const fora = socketFalso();
  stream.receberComando(dentro, 'partida-1', 'ATIVAR_DEBUG');
  stream.receberComando(fora, 'partida-2', 'ATIVAR_DEBUG');
  recebidos(dentro).length = 0;
  recebidos(fora).length = 0;

  stream.emitir('partida-1', 'info', 'Ação selecionar_peca de jogador-1 julgada');

  assert.equal(recebidos(dentro).length, 1);
  assert.equal(recebidos(dentro)[0]?.mensagem, 'Ação selecionar_peca de jogador-1 julgada');
  assert.equal(recebidos(fora).length, 0);
});

test('DESATIVAR_DEBUG envia ack e encerra o stream', () => {
  const stream = new DebugStreamDaPartida();
  const socket = socketFalso();
  stream.receberComando(socket, 'partida-1', 'ATIVAR_DEBUG');

  stream.receberComando(socket, 'partida-1', 'DESATIVAR_DEBUG');

  assert.equal(stream.totalDeAtivos, 0);
  assert.ok(recebidos(socket).some((e) => e.mensagem?.includes('encerrado')));

  stream.emitir('partida-1', 'info', 'depois de desativar');
  assert.equal(recebidos(socket).filter((e) => e.mensagem?.includes('depois de desativar')).length, 0);
});

test('desconectar (close) encerra o stream', () => {
  const stream = new DebugStreamDaPartida();
  const socket = socketFalso();
  stream.receberComando(socket, 'partida-1', 'ATIVAR_DEBUG');

  stream.desconectar(socket);
  stream.emitir('partida-1', 'error', 'depois do close');

  assert.equal(stream.totalDeAtivos, 0);
  assert.equal(recebidos(socket).filter((e) => e.mensagem?.includes('depois do close')).length, 0);
});

test('emitirParaSocket: erro do originador só se ele for ativo', () => {
  const stream = new DebugStreamDaPartida();
  const ativo = socketFalso();
  const comum = socketFalso();
  stream.receberComando(ativo, 'partida-1', 'ATIVAR_DEBUG');

  stream.emitirParaSocket(ativo, 'error', 'Ação girar_peca recusada: FORA_DA_VEZ');
  stream.emitirParaSocket(comum, 'error', 'não deveria sair');

  assert.equal(recebidos(ativo).filter((e) => e.nivel === 'error').length, 1);
  assert.equal(recebidos(comum).length, 0);
});
