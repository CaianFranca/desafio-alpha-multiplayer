import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARENCIA_AVISO_FINAL_SEGUNDOS, type EventoDaPartida } from '@flicker/engine';
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

test('traduzirEventos mapeia ataque_resolvido para ATAQUE_RESOLVIDO com estadosAplicados', () => {
  // Issue #173: o eco no wire carrega o estado RESULTANTE das penalidades
  // por Jogador mudado, além de atacantes/peoesAtingidos/protegidos (#172).
  const eventos = [
    {
      tipo: 'ataque_resolvido',
      atacantes: [
        { pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'], pecasNoAlcance: ['reta-1'] },
        { pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-branco'], pecasNoAlcance: ['reta-1'] },
      ],
      peoesAtingidos: ['peao-branco'],
      protegidos: [],
      estadosAplicados: [
        { jogadorId: 'jogador-1', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
      ],
    },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'ATAQUE_RESOLVIDO',
    atacantes: [
      { pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'], pecasNoAlcance: ['reta-1'] },
      { pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-branco'], pecasNoAlcance: ['reta-1'] },
    ],
    peoesAtingidos: ['peao-branco'],
    protegidos: [],
    estadosAplicados: [
      { jogadorId: 'jogador-1', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
    ],
  });
});

test('traduzirEventos mapeia ataque_resolvido sem alvos com estadosAplicados vazio', () => {
  // Gatilho de saída do Alcance sem ninguém atingido: o evento existe (o
  // Monstro disparou) e estadosAplicados nasce vazio — ninguém mudou.
  const eventos = [
    {
      tipo: 'ataque_resolvido',
      atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [], pecasNoAlcance: ['reta-1'] }],
      peoesAtingidos: [],
      protegidos: [],
      estadosAplicados: [],
    },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'ATAQUE_RESOLVIDO',
    atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [], pecasNoAlcance: ['reta-1'] }],
    peoesAtingidos: [],
    protegidos: [],
    estadosAplicados: [],
  });
});

test('traduzirEventos tolera ataque_resolvido de binário antigo sem pecasNoAlcance', () => {
  // Compat wire (issue #384): servidor antigo omite o campo — a tradução
  // emite [] sem quebrar (mesmo padrão de `protegido ?? false`); nenhum
  // cliente precisa do campo para julgar jogadas.
  const legado = {
    tipo: 'ataque_resolvido',
    atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] }],
    peoesAtingidos: ['peao-branco'],
    protegidos: [],
    estadosAplicados: [],
  } as unknown as EventoDaPartida;
  const saida = traduzirEventos([legado]);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'ATAQUE_RESOLVIDO',
    atacantes: [
      { pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'], pecasNoAlcance: [] },
    ],
    peoesAtingidos: ['peao-branco'],
    protegidos: [],
    estadosAplicados: [],
  });
});

test('traduzirEventos mapeia resgate_realizado para RESGATE_REALIZADO', () => {
  // Resgate (#171): a tradução é o eco do feedback exigido pela #173 —
  // repassa o estado resultante do resgatado (a cura pode ser parcial).
  const eventos = [
    {
      tipo: 'resgate_realizado',
      pecaId: 'inicial-1',
      resgatadoJogadorId: 'jogador-1',
      resgatadorJogadorId: 'jogador-2',
      resgatadorPeaoId: 'peao-vermelho',
      emBaixaIluminacao: false,
      sanidade: 2,
    },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'RESGATE_REALIZADO',
    pecaId: 'inicial-1',
    resgatadoJogadorId: 'jogador-1',
    resgatadorJogadorId: 'jogador-2',
    resgatadorPeaoId: 'peao-vermelho',
    emBaixaIluminacao: false,
    sanidade: 2,
  });
});

test('traduzirEventos mapeia partida_terminada com vitoria para PARTIDA_TERMINADA sem chave motivo', () => {
  const eventos = [
    { tipo: 'partida_terminada', desfecho: { tipo: 'vitoria' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  // A vitória não tem motivo no domínio — a chave `motivo` nem aparece.
  assert.deepEqual(saida[0], { type: 'PARTIDA_TERMINADA', resultado: 'vitoria' });
});

test('traduzirEventos mapeia partida_terminada com derrota projetando o motivo no wire (#145-exp)', () => {
  // O motivo da derrota (caixa_esgotada/equipe_amedrontada/desistencia — sync
  // DesfechoDaPartida, engine/src/partida.ts:156-161) viaja no evento para a
  // tela distinguir o fim (issue #145-exp; 'desistencia' pela ADR-0013/#289).
  const eventos = [
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'caixa_esgotada' } },
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'equipe_amedrontada' } },
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'desistencia' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 3);
  assert.deepEqual(saida[0], {
    type: 'PARTIDA_TERMINADA',
    resultado: 'derrota',
    motivo: 'caixa_esgotada',
  });
  assert.deepEqual(saida[1], {
    type: 'PARTIDA_TERMINADA',
    resultado: 'derrota',
    motivo: 'equipe_amedrontada',
  });
  assert.deepEqual(saida[2], {
    type: 'PARTIDA_TERMINADA',
    resultado: 'derrota',
    motivo: 'desistencia',
  });
});

test('traduzirEventos mapeia desistencia_registrada para DESISTENCIA_REGISTRADA (issue #289, ADR-0013)', () => {
  // Shape 1:1 com o domínio — abre o lote do comando; o término por quórum
  // mínimo chega como PARTIDA_TERMINADA no fim do lote (motivo desistencia).
  const eventos = [
    { tipo: 'desistencia_registrada', jogadorId: 'jogador-2', peaoId: 'peao-vermelho' },
    { tipo: 'partida_terminada', desfecho: { tipo: 'derrota', motivo: 'desistencia' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 2);
  assert.deepEqual(saida[0], {
    type: 'DESISTENCIA_REGISTRADA',
    jogadorId: 'jogador-2',
    peaoId: 'peao-vermelho',
  });
  assert.deepEqual(saida[1], {
    type: 'PARTIDA_TERMINADA',
    resultado: 'derrota',
    motivo: 'desistencia',
  });
});

test('traduzirEventos emite PARTIDA_TERMINADA como último evento do lote da Ação consumadora', () => {
  const eventos = [
    { tipo: 'posicao_confirmada', jogadorId: 'jogador-1', peaoId: 'peao-branco', pecaId: 'gerador-1', protegido: false },
    { tipo: 'turno_iniciado', jogadorId: 'jogador-2', rodada: 3 },
    { tipo: 'partida_terminada', desfecho: { tipo: 'vitoria' } },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 3);
  assert.equal(saida[saida.length - 1]!.type, 'PARTIDA_TERMINADA');
});

test('traduzirEventos mapeia peao_desselecionado para PEAO_DESELECIONADO (issue #249)', () => {
  const eventos = [
    { tipo: 'peao_desselecionado', peaoId: 'peao-branco' },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], { type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' });
});

// Proteção no canal (issue #227): o POSICAO_CONFIRMADA transporta o estado
// RESULTANTE do ator no gatilho completo — a tradução é pass-through; a
// concessão/consumo vivem no domínio (engine).
test('traduzirEventos propaga o protegido resultante no POSICAO_CONFIRMADA (#227)', () => {
  const eventos = [
    { tipo: 'posicao_confirmada', jogadorId: 'jogador-1', peaoId: 'peao-branco', pecaId: 'sala-medica-1', protegido: true },
    { tipo: 'posicao_confirmada', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', pecaId: 'reta-2', protegido: false },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 2);
  assert.deepEqual(saida[0], {
    type: 'POSICAO_CONFIRMADA',
    jogadorId: 'jogador-1',
    peaoId: 'peao-branco',
    pecaId: 'sala-medica-1',
    protegido: true,
  });
  assert.deepEqual(saida[1], {
    type: 'POSICAO_CONFIRMADA',
    jogadorId: 'jogador-2',
    peaoId: 'peao-vermelho',
    pecaId: 'reta-2',
    protegido: false,
  });
});

// Rolling deploy (review PR #246): payload de binário do engine anterior à
// #227 não carrega `protegido` no posicao_confirmada — a tradução projeta
// false (mesmo padrão de snapshot.ts), sem quebrar o contrato do wire.
test('traduzirEventos normaliza posicao_confirmada sem protegido para false (#227)', () => {
  // Cast deliberado: simula o evento do binário antigo, cujo payload chega
  // sem o campo novo.
  const eventoAntigo = {
    tipo: 'posicao_confirmada',
    jogadorId: 'jogador-1',
    peaoId: 'peao-branco',
    pecaId: 'reta-1',
  } as unknown as EventoDaPartida;
  const saida = traduzirEventos([eventoAntigo]);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'POSICAO_CONFIRMADA',
    jogadorId: 'jogador-1',
    peaoId: 'peao-branco',
    pecaId: 'reta-1',
    protegido: false,
  });
});

// Tempo de turno (issue #429, B1): o aviso final do Primeiro Turno tem par no
// wire — PRIMEIRO_TURNO_AVISO_FINAL com segundosExtras = carência do engine.
test('traduzirEventos mapeia aviso_final_do_primeiro_turno para PRIMEIRO_TURNO_AVISO_FINAL (#429)', () => {
  const eventos = [
    { tipo: 'aviso_final_do_primeiro_turno', jogadorId: 'jogador-1' },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'PRIMEIRO_TURNO_AVISO_FINAL',
    jogadorId: 'jogador-1',
    segundosExtras: CARENCIA_AVISO_FINAL_SEGUNDOS,
  });
});

// Tempo de turno (issue #429, B1): falta/queima sem par no wire neste ticket —
// filtro explícito (F1 reserva o contrato ao ticket 2/3), sem descarte
// silencioso no default exaustivo.
test('traduzirEventos filtra falta_registrada e pecas_queimadas sem wire (#429)', () => {
  const eventos = [
    { tipo: 'falta_registrada', jogadorId: 'jogador-1', totalDeFaltas: 1 },
    { tipo: 'pecas_queimadas', pecaIds: ['reta-7'] },
    { tipo: 'turno_encerrado', jogadorId: 'jogador-1' },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], { type: 'TURNO_ENCERRADO', jogadorId: 'jogador-1' });
});

// Tempo de turno (issue #429, B1): a causa 'tempo' viaja viva no
// DESISTENCIA_REGISTRADA (4ª falta ou 2º expiry do Primeiro Turno).
test('traduzirEventos propaga causa tempo no DESISTENCIA_REGISTRADA (#429)', () => {
  const eventos = [
    { tipo: 'desistencia_registrada', jogadorId: 'jogador-1', peaoId: 'peao-branco', causa: 'tempo' },
  ] as const satisfies readonly EventoDaPartida[];
  const saida = traduzirEventos(eventos);
  assert.equal(saida.length, 1);
  assert.deepEqual(saida[0], {
    type: 'DESISTENCIA_REGISTRADA',
    jogadorId: 'jogador-1',
    peaoId: 'peao-branco',
    causa: 'tempo',
  });
});
