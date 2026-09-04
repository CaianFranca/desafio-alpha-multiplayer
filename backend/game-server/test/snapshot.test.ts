// Teste unitário da projeção engine→wire do snapshot (ST-14 + término #179 +
// contagem da Caixa e objetivos #145).
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

test('paraSnapshotWire deriva terminada e projeta o resultado vitoria sem motivo', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'vitoria' } },
    roster(),
    'em_andamento',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'vitoria');
  // A vitória não tem motivo no domínio — a projeção normaliza para null.
  assert.equal(snapshot.motivo, null);
});

test('paraSnapshotWire projeta o motivo da derrota no snapshot (#145-exp)', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'derrota', motivo: 'equipe_amedrontada' } },
    roster(),
    'em_andamento',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'derrota');
  assert.equal(snapshot.motivo, 'equipe_amedrontada');
});

test('paraSnapshotWire deriva terminada mesmo com estado wire preparada repassado', () => {
  const snapshot = paraSnapshotWire(
    { ...estadoDaPartida(), resultado: { tipo: 'derrota', motivo: 'caixa_esgotada' } },
    roster(),
    'preparada',
  );
  assert.equal(snapshot.estado, 'terminada');
  assert.equal(snapshot.resultado, 'derrota');
  assert.equal(snapshot.motivo, 'caixa_esgotada');
});

// Contagem da Caixa e contadores de objetivo no snapshot (issue #145).
test('paraSnapshotWire projeta contagem da Caixa e objetivos zerados no estado inicial', () => {
  const estado = estadoDaPartida();
  const snapshot = paraSnapshotWire(estado, roster(), 'em_andamento');
  // Espelho do comprimento da Caixa no domínio (83 peças: ST-12/#144 + ST-15/#169).
  assert.equal(snapshot.tabuleiro.pecasRestantesNaCaixa, estado.tabuleiro.caixa.length);
  assert.ok(snapshot.tabuleiro.pecasRestantesNaCaixa > 0);
  assert.deepEqual(snapshot.geradoresLigados, []);
  assert.equal(snapshot.cartaoDeAcessoObtido, false);
});

test('paraSnapshotWire espelha geradores ligados por pecaId e cartão obtido', () => {
  const snapshot = paraSnapshotWire(
    {
      ...estadoDaPartida(),
      geradoresLigados: ['gerador-1', 'gerador-2'],
      cartaoDeAcessoObtido: true,
    },
    roster(),
    'em_andamento',
  );
  // O wire é o espelho exato do engine: readonly string[] de pecaIds, sem
  // deriva de contagem no servidor — a deduplicação/monotonicidade vivem no
  // engine e o cliente apenas projeta.
  assert.deepEqual(snapshot.geradoresLigados, ['gerador-1', 'gerador-2']);
  assert.equal(snapshot.cartaoDeAcessoObtido, true);
});

test('paraSnapshotWire normaliza estados Redis antigos sem os campos de objetivo', () => {
  // Simula JSON persistido por binário anterior à #145/#176: os campos
  // simplesmente não existem no objeto parseado (mesmo acesso `as
  // EstadoDaPartida` de partidas/estado.ts, que não valida o shape).
  const estado = estadoDaPartida();
  const bruto = JSON.stringify({
    ...estado,
    tabuleiro: { ...estado.tabuleiro, caixa: undefined },
    geradoresLigados: undefined,
    cartaoDeAcessoObtido: undefined,
  });
  const antigo = JSON.parse(bruto) as EstadoDaPartida;
  const snapshot = paraSnapshotWire(antigo, roster(), 'em_andamento');
  assert.equal(snapshot.tabuleiro.pecasRestantesNaCaixa, 0);
  assert.deepEqual(snapshot.geradoresLigados, []);
  assert.equal(snapshot.cartaoDeAcessoObtido, false);
});
