import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calcularAlcance,
  estadoInicialDoTabuleiro,
  resolverAtaques,
  resolverAtaquesCentradoNoAtuante,
  type EstadoDoTabuleiro,
  type JogadorAlvoDoAtaque,
  type Orientacao,
  type PecaPosicionada,
  type TipoDaPeca,
} from '../src/index.ts';

// Peças no alcance do ataque resolvido (issue #384): cada atacante carrega
// `pecasNoAlcance` — os pecaIds do Alcance na ordem canônica de
// calcularAlcance (por direção norte, leste, sul, oeste e distância
// crescente). Campo observacional para a coreografia do ataque (#385): sem
// efeito em regra de Alcance/Ataque/Proteção/penalidade, ordem do lote,
// snapshot ou julgamento. Fonte única da ordem: o calcularAlcance já
// computado na resolução — estes testes afirmam a igualdade contra ele além
// dos valores literais.

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

const JOGADORES: readonly JogadorAlvoDoAtaque[] = [
  { jogadorId: 'ana', peaoId: 'peao-branco', protegido: false },
];

test('pecasNoAlcance: ordem por direção e distância crescente (issue #384)', () => {
  // Vulto em (3,3): norte com cadeia de 2 (reta-n1, reta-n2), leste com 1
  // (reta-e1), sul com 1 (reta-s1), oeste bloqueado por célula vazia. Reta 0
  // abre N/S, reta 90 abre L/O — vizinhas voltadas ao Vulto conectam; além
  // das cadeias as células estão vazias e encerram os raios (sem wrap aqui).
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 3, 3),
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('reta-n2', 'reta', 0, 1, 3),
      peca('reta-e1', 'reta', 90, 3, 4),
      peca('reta-s1', 'reta', 0, 4, 3),
      peca('reta-fora', 'reta', 0, 6, 6),
    ],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n2' }],
  );
  const ordemEsperada = ['reta-n1', 'reta-n2', 'reta-e1', 'reta-s1'];
  assert.deepEqual(
    calcularAlcance(tab, 'vulto-x').map((item) => item.pecaId),
    ordemEsperada,
  );
  // Entrada: de peça fora do alcance para dentro (reta-n1).
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'reta-n1', JOGADORES);
  assert.ok(r.evento, 'a entrada deveria disparar');
  assert.equal(r.evento!.atacantes.length, 1);
  assert.deepEqual(r.evento!.atacantes[0]!.pecasNoAlcance, ordemEsperada);
});

test('pecasNoAlcance: wrap toroidal alcança peças além da borda (issue #384)', () => {
  // Vulto em (3,3) com a coluna 3 tomada por cruzes (quatro bordas abertas):
  // o raio norte dá a volta na grade toroidal (issue #260/ADR-0012) e
  // alcança cruz-6 e cruz-0 além da borda — mesma topologia de
  // toroidal.test.ts, agora via o evento de ataque.
  const coluna: PecaPosicionada[] = [];
  for (let linha = 0; linha < 7; linha++) {
    if (linha === 3) continue;
    coluna.push(peca(`cruz-${linha}`, 'cruz', 0, linha, 3));
  }
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), ...coluna],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'cruz-6' }],
  );
  const canonica = calcularAlcance(tab, 'vulto-x').map((item) => item.pecaId);
  assert.ok(canonica.includes('cruz-6'), 'o wrap alcança além da borda norte');
  assert.ok(canonica.includes('cruz-0'), 'o wrap alcança além da borda norte');
  // Primeiro Turno (início null ≡ fora) posicionando em peça do alcance.
  const r = resolverAtaquesCentradoNoAtuante(tab, null, 'cruz-6', JOGADORES);
  assert.ok(r.evento, 'a entrada deveria disparar');
  assert.deepEqual(r.evento!.atacantes[0]!.pecasNoAlcance, canonica);
});

test('pecasNoAlcance: guarda anti-ciclo do Vulto nunca inclui a origem (issue #384)', () => {
  // O anel toroidal acima voltaria à origem — o visitados por raio encerra
  // o ciclo: o ataque resolve (termina) sem a origem na lista.
  const coluna: PecaPosicionada[] = [];
  for (let linha = 0; linha < 7; linha++) {
    if (linha === 3) continue;
    coluna.push(peca(`cruz-${linha}`, 'cruz', 0, linha, 3));
  }
  const tab = mkTab(
    [peca('vulto-x', 'vulto', 0, 3, 3), ...coluna],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'cruz-2' }],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, null, 'cruz-2', JOGADORES);
  assert.ok(r.evento, 'a entrada deveria disparar (o cálculo termina)');
  const pecas = r.evento!.atacantes[0]!.pecasNoAlcance;
  assert.ok(!pecas.includes('vulto-x'), 'a origem nunca entra na lista');
  assert.deepEqual(pecas, calcularAlcance(tab, 'vulto-x').map((item) => item.pecaId));
});

test('pecasNoAlcance: espectro isolado expõe lista vazia no legado (issue #384)', () => {
  // Espectro em (5,5) sem vizinhas conectadas: calcularAlcance é []. No
  // centrado ele nunca é envolvido (envolvimento exige peça no alcance), então
  // a forma vazia é exercida pelo legado @deprecated com snapshot anterior
  // obsoleto — o delta dispara com ambas as listas vazias.
  const tab = mkTab(
    [peca('espectro-x', 'espectro', 0, 5, 5)],
    [],
  );
  assert.deepEqual(calcularAlcance(tab, 'espectro-x'), []);
  const r = resolverAtaques(tab, { 'espectro-x': ['peao-branco'] }, JOGADORES);
  assert.ok(r.evento, 'o delta do legado deveria disparar');
  assert.deepEqual(r.evento!.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: [], pecasNoAlcance: [] },
  ]);
});

test('pecasNoAlcance: múltiplos atacantes carregam listas independentes (issue #384)', () => {
  // cruz-b (2,3, quatro bordas abertas) está ao sul do vulto-x (1,3) e a
  // oeste do espectro-y (2,4): a entrada nela envolve AMBOS, cada um com a
  // própria lista — independentes mesmo sobre a mesma peça.
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 1, 3),
      peca('cruz-b', 'cruz', 0, 2, 3),
      peca('espectro-y', 'espectro', 0, 2, 4),
      peca('reta-fora', 'reta', 0, 6, 6),
    ],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'cruz-b' }],
  );
  const r = resolverAtaquesCentradoNoAtuante(tab, 'reta-fora', 'cruz-b', JOGADORES);
  assert.ok(r.evento, 'a entrada deveria disparar ambos');
  assert.deepEqual(
    r.evento!.atacantes.map((atacante) => atacante.pecaId),
    ['vulto-x', 'espectro-y'],
  );
  assert.deepEqual(r.evento!.atacantes[0]!.pecasNoAlcance, ['cruz-b']);
  assert.deepEqual(r.evento!.atacantes[1]!.pecasNoAlcance, ['cruz-b']);
  assert.deepEqual(
    r.evento!.atacantes[0]!.pecasNoAlcance,
    calcularAlcance(tab, 'vulto-x').map((item) => item.pecaId),
  );
  assert.deepEqual(
    r.evento!.atacantes[1]!.pecasNoAlcance,
    calcularAlcance(tab, 'espectro-y').map((item) => item.pecaId),
  );
});

test('pecasNoAlcance: legado preenche na ordem canônica sem comportamento novo (issue #384)', () => {
  // Forma mínima no resolverAtaques @deprecated: o mesmo calcularAlcance já
  // computado, sem animação ou semântica nova por ele.
  const tab = mkTab(
    [
      peca('vulto-x', 'vulto', 0, 3, 3),
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('reta-n2', 'reta', 0, 1, 3),
    ],
    [{ peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-n1' }],
  );
  const r = resolverAtaques(tab, {}, JOGADORES);
  assert.ok(r.evento, 'o delta do legado deveria disparar');
  assert.deepEqual(r.evento!.atacantes, [
    {
      pecaId: 'vulto-x',
      tipo: 'vulto',
      peoesNoAlcance: ['peao-branco'],
      pecasNoAlcance: ['reta-n1', 'reta-n2'],
    },
  ]);
  assert.deepEqual(
    r.evento!.atacantes[0]!.pecasNoAlcance,
    calcularAlcance(tab, 'vulto-x').map((item) => item.pecaId),
  );
});
