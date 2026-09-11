import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APELIDO_MAX,
  NOMES_DE_BOTS,
  apelidoComSufixo,
  normalizarApelido,
  sortearApelidoDeBot,
} from '../src/bots/nomes-de-bots.ts';

// Sorteio temático sem repetir nome na Sala (#352, follow-up #365): puro, sem I/O.
test('bots/nomes: lista cabe no contrato (3-20, ASCII, sem duplicata)', () => {
  assert.ok(NOMES_DE_BOTS.length >= 16);
  const normalizados = new Set<string>();
  for (const nome of NOMES_DE_BOTS) {
    assert.ok(nome.length >= 3 && nome.length <= APELIDO_MAX - 3, `tamanho: ${nome}`);
    assert.match(nome, /^[\x20-\x7e]+$/, `ASCII: ${nome}`);
    const norm = normalizarApelido(nome);
    assert.ok(!normalizados.has(norm), `duplicata: ${nome}`);
    normalizados.add(norm);
  }
});

test('bots/nomes: sufixo só em colisão e sempre <= 20', () => {
  assert.equal(apelidoComSufixo('Coelho Sabido', 1), 'Coelho Sabido');
  assert.equal(apelidoComSufixo('Coelho Sabido', 2), 'Coelho Sabido 2');
  assert.ok(apelidoComSufixo('Medico de Plantao', 99).length <= APELIDO_MAX);
  assert.ok(apelidoComSufixo('Enfermeira Insone', 12).length <= APELIDO_MAX);
});

test('bots/nomes: sorteio exclui ocupados da Sala (case-insensitive)', () => {
  const ocupados = ['coelho sabido', '  Raposa Astuta '];
  for (let i = 0; i < 50; i++) {
    const sorteado = sortearApelidoDeBot(ocupados);
    assert.ok(!ocupados.map(normalizarApelido).includes(normalizarApelido(sorteado)));
    assert.ok(sorteado.length >= 3 && sorteado.length <= APELIDO_MAX);
  }
});

test('bots/nomes: com um livre restante, sempre o retorna', () => {
  const quaseTodos = NOMES_DE_BOTS.slice(1);
  assert.equal(sortearApelidoDeBot(quaseTodos, () => 0), NOMES_DE_BOTS[0]);
});

test('bots/nomes: pool esgotado usa sufixo livre sem exceder 20', () => {
  const todos = [...NOMES_DE_BOTS];
  const sorteado = sortearApelidoDeBot(todos, () => 0);
  assert.equal(sorteado, apelidoComSufixo(NOMES_DE_BOTS[0]!, 2));
  assert.ok(sorteado.length <= APELIDO_MAX);
});
