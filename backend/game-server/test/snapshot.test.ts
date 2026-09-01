// Teste unitário da projeção engine→wire do snapshot (ST-14 + término #179).
//
// Padrão de traducao.test.ts: chamada direta da função pura, sem servidor
// nem Redis. Cobre a derivação do estado `terminada` e a projeção do
// Resultado a partir do estado do engine.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estadoInicialDaPartida, type EstadoDaPartida } from '@flicker/engine';
import type { MembroDaSala } from '@flicker/shared';
import { paraSnapshotWire } from '../src/partidas/snapshot.ts';

function roster(): readonly MembroDaSala[] {
  return [1, 2, 3, 4].map((n) => ({
    id: `membro-${n}`,
    jogadorId: `jogador-${n}`,
    apelido: `Jogador ${n}`,
    ordemDeEntrada: n,
    presenca: 'conectado',
    prontidao: true,
  }));
}

function estadoDaPartida(): EstadoDaPartida {
  const inicial = estadoInicialDaPartida(['jogador-1', 'jogador-2', 'jogador-3', 'jogador-4']);
  assert.ok(inicial.sucesso, 'estado inicial do engine deve ser válido');
  return inicial.estado;
}

test('paraSnapshotWire projeta o estado wire repassado e resultado nulo sem término', () => {
  const snapshot = paraSnapshotWire(estadoDaPartida(), roster(), 'em_andamento');
  assert.equal(snapshot.estado, 'em_andamento');
  assert.equal(snapshot.resultado, null);
});

test('paraSnapshotWire preserva preparada sem término', () => {
  const snapshot = paraSnapshotWire(estadoDaPartida(), roster(), 'preparada');
  assert.equal(snapshot.estado, 'preparada');
  assert.equal(snapshot.resultado, null);
});

test('paraSnapshotWire deriva terminada e projeta o resultado vitoria', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'vitoria' } },
    roster(),
    'em_andamento',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'vitoria');
});

test('paraSnapshotWire deriva terminada e projeta o resultado derrota sem o motivo', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'derrota', motivo: 'equipe_amedrontada' } },
    roster(),
    'em_andamento',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'derrota');
});

test('paraSnapshotWire deriva terminada mesmo com estado wire preparada repassado', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'derrota', motivo: 'caixa_esgotada' } },
    roster(),
    'preparada',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'derrota');
});
