import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { SalasBroadcaster } from '../src/salas/broadcast.ts';
import type { SalaServerMessage } from '@flicker/shared';

// Abre readyState no fake sem tocar a classe (o `enviar` consulta OPEN).
function socketFalso(): WebSocket {
  const falso = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  (falso as unknown as { OPEN: number }).OPEN = WebSocket.OPEN;
  return falso;
}

function recebidos(socket: WebSocket): unknown[] {
  const lista = (socket as unknown as { recebidos?: unknown[] }).recebidos ?? [];
  return lista;
}

// Fake de send que registra payloads para as asserções de fan-out.
function comEnvio(socket: WebSocket): WebSocket {
  (socket as unknown as { recebidos: unknown[] }).recebidos = [];
  (socket as unknown as { send: (payload: string) => void }).send = (payload: string) => {
    recebidos(socket).push(JSON.parse(payload) as unknown);
  };
  return socket;
}

function evento(): SalaServerMessage {
  return { type: 'SALA_ATUALIZADA', sala: { id: 'sala-1', codigo: 'ABC123' } } as unknown as SalaServerMessage;
}

test('removerSocketPorJogadorId: remove todos os sockets do jogador e só deles', () => {
  const broadcaster = new SalasBroadcaster();
  const a1 = comEnvio(socketFalso());
  const a2 = comEnvio(socketFalso());
  const b = comEnvio(socketFalso());
  broadcaster.registrarSocket('jogador-a', 'sala-1', a1);
  broadcaster.registrarSocket('jogador-a', 'sala-1', a2);
  broadcaster.registrarSocket('jogador-b', 'sala-1', b);

  const removidos = broadcaster.removerSocketPorJogadorId('jogador-a');
  assert.equal(removidos, 2, 'remove as duas conexões do jogador-a');

  broadcaster.enviar('sala-1', evento());
  assert.equal(recebidos(a1).length, 0, 'socket 1 do jogador-a não recebe mais');
  assert.equal(recebidos(a2).length, 0, 'socket 2 do jogador-a não recebe mais');
  assert.equal(recebidos(b).length, 1, 'socket do jogador-b continua no fan-out');
});

test('removerSocketPorJogadorId: idempotente — segunda chamada devolve 0', () => {
  const broadcaster = new SalasBroadcaster();
  const socket = comEnvio(socketFalso());
  broadcaster.registrarSocket('jogador-a', 'sala-1', socket);

  assert.equal(broadcaster.removerSocketPorJogadorId('jogador-a'), 1);
  assert.equal(broadcaster.removerSocketPorJogadorId('jogador-a'), 0);
});

test('removerSocketPorJogadorId: jogador sem sala associada é removido sem erro', () => {
  const broadcaster = new SalasBroadcaster();
  const socket = comEnvio(socketFalso());
  broadcaster.registrarSocket('jogador-a', 'sala-1', socket);
  broadcaster.removerSocket(socket);
  assert.equal(broadcaster.removerSocketPorJogadorId('jogador-a'), 0);
});
