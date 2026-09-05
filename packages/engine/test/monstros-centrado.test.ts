import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calcularAlcance,
  estadoInicialDoTabuleiro,
  resolverAtaquesCentradoNoAtuante,
  type EstadoDoTabuleiro,
  type Orientacao,
  type PecaPosicionada,
  type TipoDaPeca,
} from '../src/index.ts';

// Fixture idêntico a monstros.test.ts — peça avulsa para montar topologia à mão.
const peca = (
  pecaId: string,
  tipo: TipoDaPeca,
  orientacao: Orientacao,
  linha: number,
  coluna: number,
): PecaPosicionada => ({
  pecaId,
  tipo,
  orientacao,
  celula: { linha, coluna },
});

function mkTab(posicionadas: PecaPosicionada[], peoes: EstadoDoTabuleiro['peoes']): EstadoDoTabuleiro {
  return {
    ...estadoInicialDoTabuleiro(),
    posicionadas,
    peoes,
  };
}

// Alcance Vulto 3,3→norte reta 2,3 é conectado (reta 0 N/S). Reta fora 6,6 nunca alcança.
test('centrado: fora→fora silencioso em todos os monstros (issue #237)', () => {
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), peca('reta-n1', 'reta', 0, 2, 3), peca('reta-fora', 'reta', 0, 6, 6)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-fora' }],
  );
  // Sanidade: vulto alcança apenas reta-n1
  assert.deepEqual(
    calcularAlcance(tab, 'vulto-x').map((p) => p.pecaId),
    ['reta-n1'],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'reta-fora', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.equal(r.evento, null);
  assert.deepEqual(r.protegidosConsumidos, []);
  assert.deepEqual(r.peoesNoAlcance, { 'vulto-x': [] });
});

test('centrado: entrar dispara só envolvidos, fora permanece ileso (issue #237)', () => {
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 3, 3),
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('espectro-y', 'espectro', 0, 0, 0),
      peca('reta-b', 'reta', 90, 0, 1),
      peca('reta-fora', 'reta', 0, 6, 6),
    ],
    [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-b' },
    ],
  );
  // fora (6,6) → dentro do vulto (2,3): só vulto ataca, espectro fora não entra
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'reta-n1', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: false },
  ]);
  assert.ok(r.evento, 'deveria disparar entrada');
  assert.deepEqual(
    r.evento!.atacantes.map((a) => a.pecaId),
    ['vulto-x'],
  );
  assert.deepEqual(r.evento!.peoesAtingidos, ['peao-branco']);
  assert.deepEqual(r.peoesNoAlcance, { 'vulto-x': ['peao-branco'], 'espectro-y': ['peao-vermelho'] });
});

test('centrado: permanecer dentro dispara, fora permanece silencioso', () => {
  const tabDentro = mkTab(
    [peca('espectro-x', 'espectro', 0, 3, 3), peca('reta-a', 'reta', 90, 3, 4)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-a' }],
  );
  const r1 = resolverAtaquesCentradoNoAtuante(tabDentro, 'reta-a', 'reta-a', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.ok(r1.evento, 'permanecer dentro deveria disparar');

  const tabFora = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), peca('reta-n1', 'reta', 0, 2, 3), peca('reta-fora', 'reta', 0, 6, 6)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-fora' }],
  );
  const r2 = resolverAtaquesCentradoNoAtuante(tabFora, 'reta-fora', 'reta-fora', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.equal(r2.evento, null, 'permanecer fora deveria ser silêncio');
});

test('centrado: sair ataca sem atingir quem saiu e atingindo quem permanece (issue #237)', () => {
  // Vulto 0,3→reta 1,3; vermelho sai para 1,4 fora, branco permanece
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 0, 3), peca('reta-a', 'reta', 0, 1, 3), peca('reta-b', 'reta', 0, 1, 4)],
    [
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-b' },
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-a' },
    ],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-a', 'reta-b', [
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: false },
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.ok(r.evento, 'saída deveria disparar');
  assert.deepEqual(r.evento!.atacantes.map((a) => a.pecaId), ['vulto-x']);
  assert.ok(!r.evento!.peoesAtingidos.includes('peao-vermelho'), 'quem saiu não é atingido');
  assert.ok(r.evento!.peoesAtingidos.includes('peao-branco'), 'quem ficou é atingido');
});

test('centrado: sair com ninguém restante ainda dispara (mesmo que ninguém)', () => {
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 0, 3), peca('reta-a', 'reta', 0, 1, 3), peca('reta-b', 'reta', 0, 1, 4)],
    [{ peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-b' }],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-a', 'reta-b', [
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: false },
  ]);
  assert.ok(r.evento, 'saída vazia ainda dispara');
  assert.deepEqual(r.evento!.atacantes[0].peoesNoAlcance, []);
  assert.deepEqual(r.evento!.peoesAtingidos, []);
});

test('centrado: só monstros envolvidos atacam — dois monstros, atuante toca só um', () => {
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 3, 3),
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('espectro-y', 'espectro', 0, 0, 0),
      peca('reta-b', 'reta', 90, 0, 1),
      peca('reta-fora', 'reta', 0, 6, 6),
    ],
    [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-b' },
    ],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'reta-n1', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: false },
  ]);
  assert.ok(r.evento);
  assert.equal(r.evento!.atacantes.length, 1);
  assert.equal(r.evento!.atacantes[0].pecaId, 'vulto-x');
  assert.ok(!r.evento!.peoesAtingidos.includes('peao-vermelho'), 'peão de outro monstro fora do envolvido não é atingido');
});

test('centrado: voltar atrás antes de decidir não livra — permanecer dispara', () => {
  const tab = mkTab(
    [peca('espectro-x', 'espectro', 0, 3, 3), peca('reta-a', 'reta', 90, 3, 4)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-a' }],
  );
  // Movimentações intermediárias não confirmadas são ignoradas: início e decidida mesma peça dentro
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-a', 'reta-a', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.ok(r.evento, 'voltar atrás ainda deve disparar permanecer');
});

test('centrado: Primeiro Turno null→dentro é entrada, null→fora é silêncio', () => {
  const tabDentro = mkTab(
    [peca('espectro-x', 'espectro', 0, 3, 3), peca('reta-a', 'reta', 90, 3, 4)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-a' }],
  );
  const r1 = resolverAtaquesCentradoNoAtuante(tabDentro, null, 'reta-a', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.ok(r1.evento, 'Primeiro Turno dentro deveria ser entrada');

  const tabFora = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), peca('reta-n1', 'reta', 0, 2, 3), peca('reta-fora', 'reta', 0, 6, 6)],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-fora' }],
  );
  const r2 = resolverAtaquesCentradoNoAtuante(tabFora, null, 'reta-fora', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
  ]);
  assert.equal(r2.evento, null, 'Primeiro Turno fora→fora silêncio');
});

test('centrado: Proteção consome 1x só para envolvidos e nega vítimas (issue #237)', () => {
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), peca('reta-n1', 'reta', 0, 2, 3), peca('reta-fora', 'reta', 0, 6, 6)],
    [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-fora' },
    ],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'reta-n1', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: true },
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: true },
  ]);
  assert.ok(r.evento);
  assert.deepEqual(r.evento!.protegidos, ['ana'], 'só quem está no alcance consome');
  assert.deepEqual(r.evento!.peoesAtingidos, [], 'protegido não é atingido');
  assert.deepEqual(r.protegidosConsumidos, ['ana']);
});

test('centrado: snapshot peoesNoAlcance reflete estado atual de todos os monstros', () => {
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 3, 3),
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('espectro-y', 'espectro', 0, 0, 0),
      peca('reta-b', 'reta', 90, 0, 1),
    ],
    [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-b' },
    ],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-n1', 'reta-n1', [
    { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: false },
  ]);
  // Ambos os monstros têm snapshot, mas só vulto está envolvido (permanecer)
  assert.deepEqual(r.peoesNoAlcance['vulto-x'], ['peao-branco']);
  assert.deepEqual(r.peoesNoAlcance['espectro-y'], ['peao-vermelho']);
  assert.equal(r.evento!.atacantes.length, 1);
});
