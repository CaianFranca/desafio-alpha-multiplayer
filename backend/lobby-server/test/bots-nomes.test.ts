import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APELIDO_MAX,
  NOMES_DE_BOTS,
  apelidoComSufixo,
  escolherApelidoDeBot,
  mesclarApelidosOcupados,
  normalizarApelido,
} from '../src/bots/nomes-de-bots.ts';

// Escolha temática sem repetir nome na Sala (#352, follow-up #365): puro, sem I/O.
test('bots/nomes: lista cabe no contrato (3-20, sem duplicata)', () => {
  assert.ok(NOMES_DE_BOTS.length >= 16);
  const normalizados = new Set<string>();
  for (const nome of NOMES_DE_BOTS) {
    assert.ok(nome.length >= 3 && nome.length <= APELIDO_MAX - 3, `tamanho: ${nome}`);
    // Sem controles/espaço nas bordas (acentos são permitidos).
    assert.match(nome, /^[^\p{C}][^\p{C}]*[^\p{C}]$/u, `caracteres: ${nome}`);
    const norm = normalizarApelido(nome);
    assert.ok(!normalizados.has(norm), `duplicata: ${nome}`);
    normalizados.add(norm);
  }
});

test('bots/nomes: nomes com acento estão na lista (Irmã, Porão, Médico)', () => {
  assert.ok(NOMES_DE_BOTS.includes('Irmã do Turno'));
  assert.ok(NOMES_DE_BOTS.includes('Rato do Porão'));
  assert.ok(NOMES_DE_BOTS.includes('Médico de Plantão'));
});

test('bots/nomes: sufixo só em colisão e sempre <= 20', () => {
  assert.equal(apelidoComSufixo('Coelho Sabido', 1), 'Coelho Sabido');
  assert.equal(apelidoComSufixo('Coelho Sabido', 2), 'Coelho Sabido 2');
  assert.ok(apelidoComSufixo('Medico de Plantao', 99).length <= APELIDO_MAX);
  assert.ok(apelidoComSufixo('Enfermeira Insone', 12).length <= APELIDO_MAX);
});

test('bots/nomes: escolha exclui ocupados da Sala (case-insensitive)', () => {
  const ocupados = ['coelho sabido', '  Raposa Astuta '];
  for (let i = 0; i < 50; i++) {
    const escolhido = escolherApelidoDeBot(ocupados);
    assert.ok(!ocupados.map(normalizarApelido).includes(normalizarApelido(escolhido)));
    assert.ok(escolhido.length >= 3 && escolhido.length <= APELIDO_MAX);
  }
});

test('bots/nomes: com um livre restante, sempre o retorna', () => {
  const quaseTodos = NOMES_DE_BOTS.slice(1);
  assert.equal(escolherApelidoDeBot(quaseTodos, () => 0), NOMES_DE_BOTS[0]);
});

test('bots/nomes: pool esgotado usa sufixo livre sem exceder 20', () => {
  const todos = [...NOMES_DE_BOTS];
  const escolhido = escolherApelidoDeBot(todos, () => 0);
  assert.equal(escolhido, apelidoComSufixo(NOMES_DE_BOTS[0]!, 2));
  assert.ok(escolhido.length <= APELIDO_MAX);
});

test('bots/nomes: mescla membros + in-flight para exclusão (ordem preservada)', () => {
  assert.deepEqual(
    mesclarApelidosOcupados(['Ana', 'Beto'], ['Coelho Sabido']),
    ['Ana', 'Beto', 'Coelho Sabido'],
  );
  assert.deepEqual(mesclarApelidosOcupados([], []), []);
  assert.deepEqual(mesclarApelidosOcupados([], ['Corvo Insone']), ['Corvo Insone']);
});
