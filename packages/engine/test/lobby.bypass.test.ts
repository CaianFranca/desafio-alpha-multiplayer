import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alternarProntidao,
  aplicarComando,
  criarSala,
  encaminharSala,
  entrarNaSala,
  estadoDoLobbyVazio,
  sairDaSala,
  sairDaSalaEncaminhadaNaoIniciada,
  type Comando,
  type EstadoDoLobby,
} from '../src/index.ts';

const criar = (salaId = 'sala-1', jogadorId = 'jogador-1', membroId = 'membro-1') =>
  ({
    tipo: 'criar_sala',
    salaId,
    codigo: salaId === 'sala-1' ? 'ABC123' : salaId.toUpperCase(),
    jogadorId,
    membroId,
  } as const);

const entrar = (jogadorId: string, membroId: string, salaId = 'sala-1') =>
  ({ tipo: 'entrar_na_sala', salaId, jogadorId, membroId } as const);

const alternar = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'alternar_prontidao', salaId, jogadorId } as const);

const encaminhar = (anfitriaoMembroId = 'membro-1', salaId = 'sala-1') =>
  ({ tipo: 'encaminhar_sala', salaId, anfitriaoMembroId } as const);

const aceitar = (salaId = 'sala-1', rosterOfertado: readonly string[] = ['jogador-1', 'jogador-2', 'jogador-3']) =>
  ({ tipo: 'aceitar_encaminhamento', salaId, rosterOfertado } as const);

const sair = (jogadorId: string, salaId = 'sala-1') =>
  ({ tipo: 'sair_da_sala', salaId, jogadorId } as const);

function aplicar(estado: EstadoDoLobby, comando: Comando): EstadoDoLobby {
  const resultado = aplicarComando(estado, comando);
  if (!resultado.sucesso) {
    throw new Error(resultado.erro.mensagem);
  }
  return resultado.estado;
}

// Sai via bypass e substitui o estado em sucesso (o `sair_da_sala` canônico é
// recusado em `encaminhada`, então o encadeamento usa o bypass).
function aplicarBypass(estado: EstadoDoLobby, jogadorId: string, salaId = 'sala-1'): EstadoDoLobby {
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair(jogadorId, salaId));
  if (!resultado.sucesso) {
    throw new Error(resultado.erro.mensagem);
  }
  return resultado.estado;
}

function salaEncaminhada(quantidade: number): EstadoDoLobby {
  let estado = aplicar(estadoDoLobbyVazio(), criar());
  for (let i = 2; i <= quantidade; i++) {
    estado = aplicar(estado, entrar(`jogador-${i}`, `membro-${i}`));
  }
  for (let i = 1; i <= quantidade; i++) {
    estado = aplicar(estado, alternar(`jogador-${i}`));
  }
  // A oferta não congela; o aceite da game-server é o que fixa o estado em
  // `encaminhada` (CONTEXT.md — Encaminhamento).
  estado = aplicar(estado, encaminhar());
  const roster = Array.from({ length: quantidade }, (_, i) => `jogador-${i + 1}`);
  return aplicar(estado, aceitar('sala-1', roster));
}

test('bypass: libera membro ativo de sala encaminhada com partida nao iniciada', () => {
  const estado = salaEncaminhada(3);
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-3'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const tipos = resultado.eventos.map((e) => e.tipo);
  assert.deepEqual(tipos, ['membro_saiu']);
  const sala = resultado.estado.salas[0];
  assert.equal(sala.estado, 'encaminhada');
  const membro = sala.membros.find((m) => m.jogadorId === 'jogador-3');
  assert.equal(membro?.estado, 'encerrado');
  assert.equal(membro?.motivoEncerramento, 'saida');
});

test('bypass: anfitriao que sai sucede o anfitriao e preserva a sala encaminhada', () => {
  const estado = salaEncaminhada(2);
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const tipos = resultado.eventos.map((e) => e.tipo);
  assert.deepEqual(tipos, ['membro_saiu', 'anfitriao_sucedido']);
  const sala = resultado.estado.salas[0];
  assert.equal(sala.estado, 'encaminhada');
  assert.equal(sala.anfitriaoId, 'membro-2');
});

test('bypass: saida do ultimo membro encerra a sala', () => {
  let estado = salaEncaminhada(2);
  estado = aplicarBypass(estado, 'jogador-2');
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-1'));

  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  const tipos = resultado.eventos.map((e) => e.tipo);
  assert.deepEqual(tipos, ['membro_saiu', 'sala_encerrada']);
  assert.equal(resultado.estado.salas[0].estado, 'encerrada');
});

test('bypass: rejeita sala que nao esta encaminhada', () => {
  const estado = aplicar(estadoDoLobbyVazio(), criar());
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-1'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_NAO_ENCAMINHADA');
});

test('bypass: rejeita membro inexistente com MEMBRO_NAO_ENCONTRADO', () => {
  const estado = salaEncaminhada(2);
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-9'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'MEMBRO_NAO_ENCONTRADO');
});

test('bypass: rejeita membro com vinculo encerrado com MEMBRO_NAO_ATIVO', () => {
  let estado = salaEncaminhada(2);
  estado = aplicarBypass(estado, 'jogador-2');
  const resultado = sairDaSalaEncaminhadaNaoIniciada(estado, sair('jogador-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'MEMBRO_NAO_ATIVO');
});

test('sairDaSala canonico continua recusando sala encaminhada', () => {
  const estado = salaEncaminhada(2);
  const resultado = sairDaSala(estado, sair('jogador-2'));

  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  assert.equal(resultado.erro.codigo, 'SALA_ENCAMINHADA');
});
