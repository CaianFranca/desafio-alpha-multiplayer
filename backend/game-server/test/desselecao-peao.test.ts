// Desseleção autoritativa do Peão no canal de Partida (issue #249).
//
// Testes unitários puros (sem Redis/WS): a guarda wire aceita
// DESELECIONAR_PEAO com jogadorId + peaoId, o mapeamento converte para o
// domínio `desselecionar_peao`, e códigos de erro seguem no conjunto fechado
// (PENDENCIA_NAO_RESOLVIDA viaja ao autor, sem vazar código fora do contrato).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ehComandoDaPartida,
  mapearComandoDaPartida,
  paraCodigoDaPartidaWire,
} from '../src/partidas/wire.ts';

test('ehComandoDaPartida aceita DESELECIONAR_PEAO com jogadorId e peaoId', () => {
  assert.equal(
    ehComandoDaPartida({ type: 'DESELECIONAR_PEAO', jogadorId: 'j1', peaoId: 'peao-branco' }),
    true,
  );
  assert.equal(
    ehComandoDaPartida({ type: 'DESELECIONAR_PEAO', jogadorId: 'j1' }),
    false,
  );
  assert.equal(
    ehComandoDaPartida({ type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' }),
    false,
  );
});

test('mapearComandoDaPartida converte DESELECIONAR_PEAO para desselecionar_peao', () => {
  const comando = mapearComandoDaPartida({
    type: 'DESELECIONAR_PEAO',
    jogadorId: 'j1',
    peaoId: 'peao-branco',
  });
  assert.deepEqual(comando, { tipo: 'desselecionar_peao', peaoId: 'peao-branco' });
});

test('PENDENCIA_NAO_RESOLVIDA da desseleção viaja no wire (falha fechada)', () => {
  assert.equal(paraCodigoDaPartidaWire('PENDENCIA_NAO_RESOLVIDA'), 'PENDENCIA_NAO_RESOLVIDA');
});
