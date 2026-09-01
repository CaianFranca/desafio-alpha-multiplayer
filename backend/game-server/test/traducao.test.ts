import assert from 'node:assert/strict';
import { test } from 'node:test';
import { traduzirEventos } from '../src/partidas/traducao.ts';

test('traduzirEventos mapeia celulas_iluminadas para CELULAS_ILUMINADAS', () => {
  const celulas = [
    { linha: 2, coluna: 3 },
    { linha: 3, coluna: 3 },
  ] as const;
  const eventos = [{ tipo: 'celulas_iluminadas', celulas }] as const;
  const saida = traduzirEventos(eventos as any);
  assert.equal(saida.length, 1);
  assert.equal(saida[0]!.type, 'CELULAS_ILUMINADAS');
  assert.deepEqual((saida[0] as any).celulas, celulas);
});

test('traduzirEventos mapeia limpeza_aplicada para LIMPEZA_APLICADA', () => {
  const eventos = [{ tipo: 'limpeza_aplicada', pecasRemovidas: ['reta-2'] }] as const;
  const saida = traduzirEventos(eventos as any);
  assert.equal(saida.length, 1);
  assert.equal(saida[0]!.type, 'LIMPEZA_APLICADA');
  assert.deepEqual((saida[0] as any).pecasRemovidas, ['reta-2']);
});

test('traduzirEventos preserva ordem e cobre ambos no mesmo batch', () => {
  const eventos = [
    { tipo: 'celulas_iluminadas', celulas: [{ linha: 0, coluna: 0 }] },
    { tipo: 'limpeza_aplicada', pecasRemovidas: ['reta-1', 'reta-2'] },
    { tipo: 'turno_iniciado', jogadorId: 'jogador-1', rodada: 1 },
  ] as const;
  const saida = traduzirEventos(eventos as any);
  assert.equal(saida.length, 3);
  assert.equal(saida[0]!.type, 'CELULAS_ILUMINADAS');
  assert.equal(saida[1]!.type, 'LIMPEZA_APLICADA');
  assert.equal(saida[2]!.type, 'TURNO_INICIADO');
});
