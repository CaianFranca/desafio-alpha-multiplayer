// Desseleção autoritativa do Peão no canal de Partida (issue #249).
//
// Testes unitários puros (sem Redis/WS): a guarda wire aceita
// DESELECIONAR_PEAO com jogadorId + peaoId, o mapeamento converte para o
// domínio `desselecionar_peao`, e códigos de erro seguem no conjunto fechado
// (PENDENCIA_NAO_RESOLVIDA viaja ao autor, sem vazar código fora do contrato).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarComandoDeTabuleiro,
  estadoInicialDoTabuleiro,
} from '@flicker/engine';
import {
  ehComandoDaPartida,
  mapearComandoDaPartida,
  paraCodigoDaPartidaWire,
} from '../src/partidas/wire.ts';
import { traduzirEventos } from '../src/partidas/traducao.ts';

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

test('DESELECIONAR_PEAO idempotente gera PEAO_DESELECIONADO visível ao autor (ack #249)', () => {
  // Sem seleção vigente: estado inalterado, mas com evento de confirmação —
  // o handlers.ts persiste e faz broadcast do lote, então o autor recebe o
  // ack e libera DESELECIONAR_PEAO:peao em pendentesEmVoo.
  const semSelecao = estadoInicialDoTabuleiro();
  const vazio = aplicarComandoDeTabuleiro(semSelecao, {
    tipo: 'desselecionar_peao',
    peaoId: 'peao-branco',
  });
  assert.equal(vazio.sucesso, true);
  if (!vazio.sucesso) throw new Error('inacessível');
  assert.deepEqual(vazio.estado, semSelecao);
  assert.deepEqual(
    traduzirEventos(vazio.eventos),
    [{ type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' }],
  );
});

test('DESELECIONAR_PEAO de outro peão confirma sem roubar a sequência (#249)', () => {
  const base = estadoInicialDoTabuleiro();
  const selecionado = aplicarComandoDeTabuleiro(base, {
    tipo: 'selecionar_peao',
    peaoId: 'peao-branco',
  });
  assert.equal(selecionado.sucesso, true);
  if (!selecionado.sucesso) throw new Error('inacessível');
  const alheia = aplicarComandoDeTabuleiro(selecionado.estado, {
    tipo: 'desselecionar_peao',
    peaoId: 'peao-vermelho',
  });
  assert.equal(alheia.sucesso, true);
  if (!alheia.sucesso) throw new Error('inacessível');
  assert.equal(alheia.estado.peaoSelecionadoId, 'peao-branco');
  assert.deepEqual(
    traduzirEventos(alheia.eventos),
    [{ type: 'PEAO_DESELECIONADO', peaoId: 'peao-vermelho' }],
  );
});
