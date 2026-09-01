import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventoDaPartida } from '@flicker/engine';
import { traduzirEventos } from '../src/partidas/traducao.ts';

test('traduzirEventos mapeia celulas_iluminadas para CELULAS_ILUMINADAS', () => {
  const celulas = [
    { linha: 2, coluna: 3 },
    { linha: 3, coluna: 3 },
  ] as const;
  const eventos = [{ tipo: 'celulas_iluminadas', celulas }] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.equal(saida[0]!.type, 'CELULAS_ILUMINADAS');
  assert.deepEqual((saida[0] as { celulas: unknown }).celulas, celulas);
});

test('traduzirEventos mapeia limpeza_aplicada para LIMPEZA_APLICADA', () => {
  const eventos = [{ tipo: 'limpeza_aplicada', pecasRemovidas: ['reta-2'] }] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.equal(saida[0]!.type, 'LIMPEZA_APLICADA');
  assert.deepEqual((saida[0] as { pecasRemovidas: unknown }).pecasRemovidas, ['reta-2']);
});

test('traduzirEventos preserva ordem e cobre ambos no mesmo batch', () => {
  const eventos = [
    { tipo: 'celulas_iluminadas', celulas: [{ linha: 0, coluna: 0 }] },
    { tipo: 'limpeza_aplicada', pecasRemovidas: ['reta-1', 'reta-2'] },
    { tipo: 'turno_iniciado', jogadorId: 'jogador-1', rodada: 1 },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 3);
  assert.equal(saida[0]!.type, 'CELULAS_ILUMINADAS');
  assert.equal(saida[1]!.type, 'LIMPEZA_APLICADA');
  assert.equal(saida[2]!.type, 'TURNO_INICIADO');
});

test('traduzirEventos mapeia partida_terminada com vitoria para PARTIDA_TERMINADA', () => {
  const eventos = [
    { tipo: 'partida_terminada', desfecho: { tipo: 'vitoria' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], { type: 'PARTIDA_TERMINADA', resultado: 'vitoria' });
});

test('traduzirEventos mapeia partida_terminada com derrota para PARTIDA_TERMINADA sem o motivo', () => {
  // O motivo da derrota (caixa_esgotada/equipe_amedrontada) é interno ao
  // domínio: o contrato wire expõe apenas o par vitória/derrota (#179).
  const eventos = [
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'caixa_esgotada' } },
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'equipe_amedrontada' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 2);
  assert.deepEqual(saida[0], { type: 'PARTIDA_TERMINADA', resultado: 'derrota' });
  assert.deepEqual(saida[1], { type: 'PARTIDA_TERMINADA', resultado: 'derrota' });
});

test('traduzirEventos emite PARTIDA_TERMINADA como último evento do lote da Ação consumadora', () => {
  const eventos = [
    { tipo: 'posicao_confirmada', jogadorId: 'jogador-1', peaoId: 'peao-branco', pecaId: 'gerador-1' },
    { tipo: 'turno_iniciado', jogadorId: 'jogador-2', rodada: 3 },
    { tipo: 'partida_terminada', desfecho: { tipo: 'vitoria' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 3);
  assert.equal(saida[saida.length - 1]!.type, 'PARTIDA_TERMINADA');
});
