import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contarBotsEmAdmissao,
  limparEstadoDeBotsParaTeste,
  listarApelidosDeBotsEmAdmissao,
  marcarBotAtivo,
  marcarBotEncerrado,
  marcarBotFalhou,
  obterEstadoDoBot,
  registrarBotEmAdmissao,
} from '../src/bots/estado.ts';


// Estado volátil dos bots (#352, review #365 itens 2+3): sem I/O, sem banco.
test('bots/estado: registra admitindo e conta in-flight por sala', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'b-1', salaId: 's1', codigoDeSala: 'ABCDEF' });
  registrarBotEmAdmissao({ jogadorId: 'j2', apelido: 'b-2', salaId: 's1', codigoDeSala: 'ABCDEF' });
  registrarBotEmAdmissao({ jogadorId: 'j3', apelido: 'b-3', salaId: 's2', codigoDeSala: 'GHIJKL' });
  assert.equal(contarBotsEmAdmissao('s1'), 2);
  assert.equal(contarBotsEmAdmissao('s2'), 1);
  assert.equal(obterEstadoDoBot('j1')?.fase, 'admitindo');
});

test('bots/estado: ativo remove do in-flight mas mantém status', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'b-1', salaId: 's1', codigoDeSala: 'ABCDEF' });
  marcarBotAtivo('j1');
  assert.equal(contarBotsEmAdmissao('s1'), 0);
  assert.equal(obterEstadoDoBot('j1')?.fase, 'ativo');
});

test('bots/estado: falhou guarda codigo/mensagem e libera vaga', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'b-1', salaId: 's1', codigoDeSala: 'ABCDEF' });
  marcarBotFalhou('j1', 'SALA_CHEIA', 'A sala está cheia (máximo 4 membros).');
  assert.equal(contarBotsEmAdmissao('s1'), 0);
  const estado = obterEstadoDoBot('j1');
  assert.equal(estado?.fase, 'falhou');
  assert.equal(estado?.codigo, 'SALA_CHEIA');
});

test('bots/estado: encerrado libera vaga e marca fim do ciclo', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'b-1', salaId: 's1', codigoDeSala: 'ABCDEF' });
  marcarBotAtivo('j1');
  marcarBotEncerrado('j1');
  assert.equal(obterEstadoDoBot('j1')?.fase, 'encerrado');
  assert.equal(contarBotsEmAdmissao('s1'), 0);
});

test('bots/estado: ocupacao = membros + in-flight (teto de 4)', () => {
  limparEstadoDeBotsParaTeste();
  // Sala com 3 vínculos ativos + 1 bot in-flight = cheia; +1 estoura.
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'b-1', salaId: 's1', codigoDeSala: 'ABCDEF' });
  const membrosAtivos = 3;
  assert.ok(membrosAtivos + contarBotsEmAdmissao('s1') >= 4);
});

test('bots/estado: lista apelidos in-flight por sala (escolha não repete)', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'Coelho Sabido', salaId: 's1', codigoDeSala: 'ABCDEF' });
  registrarBotEmAdmissao({ jogadorId: 'j2', apelido: 'Raposa Astuta', salaId: 's1', codigoDeSala: 'ABCDEF' });
  registrarBotEmAdmissao({ jogadorId: 'j3', apelido: 'Corvo Insone', salaId: 's2', codigoDeSala: 'GHIJKL' });
  assert.deepEqual(listarApelidosDeBotsEmAdmissao('s1'), ['Coelho Sabido', 'Raposa Astuta']);
  assert.deepEqual(listarApelidosDeBotsEmAdmissao('s2'), ['Corvo Insone']);
  assert.deepEqual(listarApelidosDeBotsEmAdmissao('s3'), []);
});

test('bots/estado: ativo sai do in-flight (nome segue via membros/PG)', () => {
  limparEstadoDeBotsParaTeste();
  registrarBotEmAdmissao({ jogadorId: 'j1', apelido: 'Coelho Sabido', salaId: 's1', codigoDeSala: 'ABCDEF' });
  marcarBotAtivo('j1');
  assert.deepEqual(listarApelidosDeBotsEmAdmissao('s1'), []);
});
