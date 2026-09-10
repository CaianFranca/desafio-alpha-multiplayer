import assert from 'node:assert/strict';
import test from 'node:test';
import { acoesValidasDaSubfase, expandirPosicionamentoDoBot } from '@flicker/engine';
import {
  adaptarSnapshotParaEspelho,
  aplicarEventoNoEspelho,
  converterComandoParaWire,
  espelhoInicial,
  JogadorBot,
  type EspelhoDoBot,
} from '../src/bots/jogador-bot.ts';
import type { EstadoDaPartidaSnapshot } from '@flicker/shared';

function snapshotFresco(): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0 },
        { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
      ],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: [
      {
        jogadorId: 'ana',
        apelido: 'ana',
        cor: 'branco',
        ordem: 1,
        peaoId: 'peao-branco',
        primeiroTurnoPendente: true,
        sanidade: 3,
        emBaixaIluminacao: false,
        amedrontado: false,
        protegido: false,
      },
      {
        jogadorId: 'bruno',
        apelido: 'bruno',
        cor: 'vermelho',
        ordem: 2,
        peaoId: 'peao-vermelho',
        primeiroTurnoPendente: true,
        sanidade: 3,
        emBaixaIluminacao: false,
        amedrontado: false,
        protegido: false,
      },
    ],
    jogadorAtivoId: 'ana',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  };
}

function dobrar(espelho: EspelhoDoBot, eventos: readonly unknown[]): EspelhoDoBot {
  let atual = espelho;
  for (const evento of eventos) {
    atual = aplicarEventoNoEspelho(atual, evento);
  }
  return atual;
}

test('adapter semeia o espelho com a contagem da Caixa e o roster', () => {
  const estado = adaptarSnapshotParaEspelho(snapshotFresco());
  assert.equal(estado.tabuleiro.caixa.length, 83);
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.resultado, null);
  assert.deepEqual(
    estado.jogadores.map((j) => [j.jogadorId, j.peaoId, j.cor]),
    [
      ['ana', 'peao-branco', 'branco'],
      ['bruno', 'peao-vermelho', 'vermelho'],
    ],
  );
});

test('adapter mapeia o término da partida', () => {
  const base = snapshotFresco();
  const derrota: EstadoDaPartidaSnapshot = {
    ...base,
    estado: 'terminada',
    resultado: 'derrota',
    motivo: 'equipe_amedrontada',
  };
  assert.deepEqual(adaptarSnapshotParaEspelho(derrota).resultado, {
    tipo: 'derrota',
    motivo: 'equipe_amedrontada',
  });
  const vitoria: EstadoDaPartidaSnapshot = {
    ...base,
    estado: 'terminada',
    resultado: 'vitoria',
  };
  assert.deepEqual(adaptarSnapshotParaEspelho(vitoria).resultado, {
    tipo: 'vitoria',
  });
});

test('fold do Primeiro Turno: seleção, encaixe, peão e recebimento', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    { type: 'PECA_SELECIONADA', pecaId: 'inicial-1' },
  ]);
  assert.equal(espelho.estado.tabuleiro.pecaSelecionadaId, 'inicial-1');
  espelho = dobrar(espelho, [
    {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
      orientacao: 0,
    },
  ]);
  assert.ok(
    espelho.estado.tabuleiro.posicionadas.some(
      (p) => p.pecaId === 'inicial-1' && p.tipo === 'inicial',
    ),
  );
  assert.equal(
    espelho.estado.tabuleiro.pecaEmManipulacaoId,
    'inicial-1',
  );
  espelho = dobrar(espelho, [
    { type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' },
    {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    },
    { type: 'PECA_SORTEADA', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 },
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-1',
          pecaId: 'reta-1',
          tipoDaPeca: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  ]);
  assert.equal(espelho.estado.tabuleiro.caixa.length, 82);
  assert.deepEqual(
    espelho.estado.tabuleiro.recebidas.map((r) => r.recebidaId),
    ['recebida-reta-1'],
  );
  assert.equal(espelho.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
});

test('fold da vaga: fixa borda, alvo e seleciona a sorteada', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-1',
          pecaId: 'reta-1',
          tipoDaPeca: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
    {
      type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
      recebidaId: 'recebida-reta-1',
      borda: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
    },
  ]);
  const recebida = espelho.estado.tabuleiro.recebidas[0];
  assert.equal(recebida?.vaga, 'norte');
  assert.deepEqual(recebida?.celulaAlvo, { linha: 2, coluna: 3 });
  assert.equal(espelho.estado.tabuleiro.pecaSelecionadaId, 'reta-1');
});

test('fold do recebimento preserva a orientação (base do giro do bot)', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-1',
          pecaId: 'reta-1',
          tipoDaPeca: 'reta',
          orientacao: 90,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  ]);
  // Regressão: sem a orientação no evento o espelho guardava `undefined` e a
  // expansão do posicionamento nunca emitia girar_peca para Recebidas.
  assert.equal(
    espelho.estado.tabuleiro.recebidas[0]?.orientacao,
    90,
  );
});

test('fold tolera payload antigo sem orientação (nasce 0 na Caixa)', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-1',
          pecaId: 'reta-1',
          tipoDaPeca: 'reta',
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  ]);
  assert.equal(
    espelho.estado.tabuleiro.recebidas[0]?.orientacao,
    0,
  );
});

test('espelho→engine: recebida com vaga expande em giro + encaixe', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-1',
          pecaId: 'reta-1',
          tipoDaPeca: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
    {
      type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
      recebidaId: 'recebida-reta-1',
      borda: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
    },
  ]);
  const comando = {
    tipo: 'posicionar_peca',
    pecaId: 'reta-1',
    celula: { linha: 2, coluna: 3 },
  } as const;
  // Reta em 0° com vaga norte: rótulos válidos manter, horario_2x e
  // anti_horario_2x — com orientação `undefined` no espelho a expansão
  // retornava só o posicionar em qualquer sorteio (o bug).
  const primeiro = <T>(acoes: readonly T[]): T => {
    if (acoes.length === 0) throw new Error('sem ações');
    return acoes[0] as T;
  };
  assert.deepEqual(expandirPosicionamentoDoBot(espelho.estado, comando, primeiro), [
    comando,
  ]);
  const ultimo = <T>(acoes: readonly T[]): T => {
    if (acoes.length === 0) throw new Error('sem ações');
    return acoes[acoes.length - 1] as T;
  };
  assert.deepEqual(expandirPosicionamentoDoBot(espelho.estado, comando, ultimo), [
    { tipo: 'girar_peca', pecaId: 'reta-1', sentido: 'anti_horario' },
    { tipo: 'girar_peca', pecaId: 'reta-1', sentido: 'anti_horario' },
    comando,
  ]);
});

test('fold do turno normal: mover re-seleciona; turno avança e limpa', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    { type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' },
    {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    },
  ]);
  // Espelha o engine (moverPeaoDaPartida re-seleciona silenciosamente,
  // re-land da #263 pela #324): a FSM pós-confirmação não propõe
  // selecionar_peao fantasma.
  assert.equal(espelho.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.equal(
    espelho.estado.tabuleiro.peoes.find((p) => p.peaoId === 'peao-branco')
      ?.pecaId,
    'reta-1',
  );
  espelho = dobrar(espelho, [
    {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'ana',
      peaoId: 'peao-branco',
      pecaId: 'reta-1',
      protegido: false,
    },
    { type: 'TURNO_ENCERRADO', jogadorId: 'ana' },
    { type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 1 },
  ]);
  assert.equal(espelho.estado.jogadorAtivoId, 'bruno');
  assert.equal(espelho.estado.posicaoConfirmada, false);
  assert.deepEqual(espelho.estado.tabuleiro.recebidas, []);
});

test('fold da confirmação soma conquistas e protege o resultante', () => {
  const comGerador: EstadoDaPartidaSnapshot = {
    ...snapshotFresco(),
    tabuleiro: {
      ...snapshotFresco().tabuleiro,
      posicionadas: [
        {
          pecaId: 'gerador-1',
          tipo: 'gerador',
          orientacao: 0,
          celula: { linha: 1, coluna: 1 },
        },
      ],
    },
  };
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(comGerador));
  espelho = dobrar(espelho, [
    {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'ana',
      peaoId: 'peao-branco',
      pecaId: 'gerador-1',
      protegido: true,
    },
  ]);
  assert.deepEqual(espelho.estado.geradoresLigados, ['gerador-1']);
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'ana')?.protegido,
    true,
  );
});

test('fold do ataque: escudo da Sala Médica sobrevive ao mesmo gatilho', () => {
  const comMedica: EstadoDaPartidaSnapshot = {
    ...snapshotFresco(),
    tabuleiro: {
      ...snapshotFresco().tabuleiro,
      posicionadas: [
        {
          pecaId: 'sala-medica-1',
          tipo: 'sala_medica',
          orientacao: 0,
          celula: { linha: 1, coluna: 1 },
        },
      ],
    },
  };
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(comMedica));
  espelho = dobrar(espelho, [
    {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'ana',
      peaoId: 'peao-branco',
      pecaId: 'sala-medica-1',
      protegido: true,
    },
    {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [],
      peoesAtingidos: [],
      protegidos: ['ana'],
      estadosAplicados: [],
    },
  ]);
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'ana')?.protegido,
    true,
    'escudo recém-concedido sobrevive ao consumo do mesmo gatilho',
  );
  // O ataque seguinte, sem nova confirmação, consome normalmente.
  espelho = dobrar(espelho, [
    {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [],
      peoesAtingidos: [],
      protegidos: ['ana'],
      estadosAplicados: [],
    },
  ]);
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'ana')?.protegido,
    false,
  );
});

test('fold do ataque aplica penalidades e o resgate limpa com graça', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [],
      peoesAtingidos: ['peao-branco'],
      protegidos: [],
      estadosAplicados: [
        {
          jogadorId: 'ana',
          emBaixaIluminacao: true,
          sanidade: 2,
          amedrontado: false,
        },
      ],
    },
  ]);
  const ana = espelho.estado.jogadores.find((j) => j.jogadorId === 'ana');
  assert.equal(ana?.emBaixaIluminacao, true);
  assert.equal(ana?.sanidade, 2);
  espelho = dobrar(espelho, [
    {
      type: 'RESGATE_REALIZADO',
      pecaId: 'inicial-1',
      resgatadoJogadorId: 'ana',
      resgatadorJogadorId: 'bruno',
      resgatadorPeaoId: 'peao-vermelho',
    },
  ]);
  const resgatada = espelho.estado.jogadores.find(
    (j) => j.jogadorId === 'ana',
  );
  assert.equal(resgatada?.emBaixaIluminacao, false);
  assert.deepEqual(espelho.estado.pecasEmPeriodoDeGraca, ['inicial-1']);
});

test('fold ignora mensagens fora do canal da partida', () => {
  const espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  assert.equal(aplicarEventoNoEspelho(espelho, null), espelho);
  assert.equal(aplicarEventoNoEspelho(espelho, { type: 'PING' }), espelho);
  assert.equal(
    aplicarEventoNoEspelho(espelho, { type: 'SALA_ATUALIZADA' }),
    espelho,
  );
});

test('converterComandoParaWire usa sempre o jogadorId do bot', () => {
  assert.deepEqual(
    converterComandoParaWire({ tipo: 'selecionar_peca', pecaId: 'inicial-1' }, 'ana'),
    { type: 'SELECIONAR_PECA', jogadorId: 'ana', pecaId: 'inicial-1' },
  );
  assert.deepEqual(
    converterComandoParaWire(
      { tipo: 'mover_peao', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } },
      'ana',
    ),
    {
      type: 'MOVER_PEAO',
      jogadorId: 'ana',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
    },
  );
  assert.deepEqual(converterComandoParaWire({ tipo: 'encerrar_turno' }, 'ana'), {
    type: 'ENCERRAR_TURNO',
    jogadorId: 'ana',
  });
  assert.deepEqual(
    converterComandoParaWire(
      { tipo: 'girar_peca', pecaId: 'reta-1', sentido: 'horario' },
      'ana',
    ),
    {
      type: 'GIRAR_PECA',
      jogadorId: 'ana',
      pecaId: 'reta-1',
      sentido: 'horario',
    },
  );
  assert.throws(
    () =>
      converterComandoParaWire(
        { tipo: 'finalizar_manipulacao' },
        'ana',
      ),
    /fora do plano do bot/,
  );
});

test('loop: turno completo do Primeiro Turno contra servidor de mentira', async () => {
  const enviados: { type: string; jogadorId: string }[] = [];
  const orientacoes: Record<string, 0 | 90 | 180 | 270> = {};
  const bot = new JogadorBot({
    jogadorId: 'ana',
    enviar: (comando) => {
      // O wire agora tem variantes de controle de debug sem `jogadorId`
      // (issue #340) — o bot nunca as envia, então o fallback nunca ocorre.
      enviados.push({ type: comando.type, jogadorId: 'jogadorId' in comando ? comando.jogadorId : '' });
      // Assíncrono como o WS real: a resposta nunca chega antes da espera.
      setTimeout(() => responder(comando), 1);
    },
    log: () => undefined,
    intervaloDeQuiescenciaMs: 5,
    timeoutDeRespostaMs: 500,
  });
  function responder(
    comando: import('@flicker/shared').PartidaComandoDoCliente,
  ): void {
    // O bot expande o posicionar em 0..2 giros (orientação sorteada): cada
    // giro é confirmado como no wire real para o espelho acompanhar.
    if (comando.type === 'GIRAR_PECA') {
      const pecaId = comando.pecaId;
      const anterior = orientacoes[pecaId] ?? 0;
      const orientacao = ((anterior + 90) % 360) as 0 | 90 | 180 | 270;
      orientacoes[pecaId] = orientacao;
      bot.aoReceberEvento({
        type: 'PECA_GIRADA',
        pecaId,
        orientacaoAnterior: anterior,
        orientacao,
        sentido: comando.sentido,
      });
      return;
    }
    const lotes: Record<string, readonly unknown[]> = {
      SELECIONAR_PECA: [{ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }],
      POSICIONAR_PECA: [
        {
          type: 'PECA_POSICIONADA',
          pecaId: 'inicial-1',
          celula: { linha: 3, coluna: 3 },
          orientacao: 0,
        },
      ],
      SELECIONAR_PEAO: [{ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' }],
      POSICIONAR_PEAO: [
        {
          type: 'PEAO_POSICIONADO',
          peaoId: 'peao-branco',
          pecaId: 'inicial-1',
          celula: { linha: 3, coluna: 3 },
        },
      ],
      ENCERRAR_TURNO: [
        { type: 'TURNO_ENCERRADO', jogadorId: 'ana' },
        { type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 1 },
      ],
    };
    for (const evento of lotes[comando.type] ?? []) {
      bot.aoReceberEvento(evento);
    }
  }
  bot.aoReceberSnapshot(snapshotFresco());
  bot.aoReceberEvento({ type: 'TURNO_INICIADO', jogadorId: 'ana', rodada: 1 });
  const limite = Date.now() + 3000;
  while (
    !enviados.some((e) => e.type === 'ENCERRAR_TURNO') &&
    Date.now() < limite
  ) {
    await new Promise((r) => setTimeout(r, 10));
  }
  // Ordem fixa, com 0..2 GIRAR_PECA entre selecionar e posicionar a peça.
  assert.equal(enviados[0]?.type, 'SELECIONAR_PECA');
  assert.deepEqual(
    enviados.slice(-3).map((e) => e.type),
    ['SELECIONAR_PEAO', 'POSICIONAR_PEAO', 'ENCERRAR_TURNO'],
  );
  const meio = enviados.slice(1, -3);
  assert.equal(
    meio.filter((e) => e.type === 'POSICIONAR_PECA').length,
    1,
    'um único encaixe da Inicial',
  );
  assert.equal(meio[meio.length - 1]?.type, 'POSICIONAR_PECA');
  const giros = meio.slice(0, -1);
  assert.ok(
    giros.length <= 2 && giros.every((e) => e.type === 'GIRAR_PECA'),
    `giros inesperados: ${JSON.stringify(meio)}`,
  );
  assert.ok(enviados.every((e) => e.jogadorId === 'ana'));
});

test('loop: turno alheio não dispara; silêncio desiste por timeout', async () => {
  const logs: unknown[][] = [];
  const enviados: { type: string }[] = [];
  const bot = new JogadorBot({
    jogadorId: 'ana',
    enviar: (comando) => {
      enviados.push({ type: comando.type });
    },
    log: (...args: unknown[]) => {
      logs.push(args);
    },
    maxActionsPerTurn: 2,
    intervaloDeQuiescenciaMs: 5,
    timeoutDeRespostaMs: 100,
  });
  bot.aoReceberSnapshot(snapshotFresco());
  bot.aoReceberEvento({ type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 1 });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(enviados, [], 'bot não age no turno alheio');
  // Vez própria com servidor silencioso: aborta por timeout, sem reenvio cego.
  bot.aoReceberEvento({ type: 'TURNO_INICIADO', jogadorId: 'ana', rodada: 2 });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(enviados.length, 1);
  assert.ok(
    logs.flat().join(' ').includes('sem confirmação'),
    'timeout deveria ser logado',
  );
});

test('loop: servidor responsivo sem progresso leva ao failsafe', async () => {
  const logs: unknown[][] = [];
  const enviados: { type: string }[] = [];
  const bot = new JogadorBot({
    jogadorId: 'ana',
    enviar: (comando) => {
      enviados.push({ type: comando.type });
      // Responde sem mudar nada útil: o espelho não avança.
      setTimeout(
        () =>
          bot.aoReceberEvento({ type: 'CELULAS_ILUMINADAS', celulas: [] }),
        1,
      );
    },
    log: (...args: unknown[]) => {
      logs.push(args);
    },
    maxActionsPerTurn: 2,
    intervaloDeQuiescenciaMs: 5,
    timeoutDeRespostaMs: 300,
  });
  bot.aoReceberSnapshot(snapshotFresco());
  bot.aoReceberEvento({ type: 'TURNO_INICIADO', jogadorId: 'ana', rodada: 1 });
  const limite = Date.now() + 4000;
  while (
    !enviados.some((e) => e.type === 'ENCERRAR_TURNO') &&
    Date.now() < limite
  ) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(
    enviados.some((e) => e.type === 'ENCERRAR_TURNO'),
    'failsafe deveria forçar o encerramento',
  );
  assert.ok(
    logs.flat().join(' ').includes('failsafe'),
    'failsafe deveria ser logado',
  );
});

test('fold: TURNO_ENCERRADO baixa o primeiroTurnoPendente de quem encerrou', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'ana')
      ?.primeiroTurnoPendente,
    true,
  );
  espelho = dobrar(espelho, [{ type: 'TURNO_ENCERRADO', jogadorId: 'ana' }]);
  // Quem encerrou necessariamente atuou: o flag dele cai; o do outro fica.
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'ana')
      ?.primeiroTurnoPendente,
    false,
  );
  assert.equal(
    espelho.estado.jogadores.find((j) => j.jogadorId === 'bruno')
      ?.primeiroTurnoPendente,
    true,
  );
  // Sem evento do wire para o campo, o flag do pulado (Amedrontado que nunca
  // encerra turno) permanece true — a semântica correta do engine.
});

test('FSM do bot: na rodada 2 sem pendência de Primeiro Turno, sem Inicial fantasma', () => {
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(snapshotFresco()));
  espelho = dobrar(espelho, [
    { type: 'TURNO_ENCERRADO', jogadorId: 'ana' },
    { type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 1 },
    // Bruno concluiu o Primeiro Turno na rodada 1 e a vez volta a ele na 2.
    { type: 'TURNO_ENCERRADO', jogadorId: 'bruno' },
    { type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 2 },
  ]);
  const validas = acoesValidasDaSubfase(espelho.estado, 'bruno');
  // Pré-fix o flag travava em true e a FSM caía no caso (c) propondo
  // selecionar_peca da Inicial — recusada pelo engine, turno órfão.
  assert.ok(
    !validas.some(
      (a) => a.tipo === 'selecionar_peca' && a.pecaId === 'inicial-2',
    ),
    'FSM não deve propor a Inicial do Primeiro Turno na rodada 2',
  );
});

test('FSM do bot: pós-mover+confirmar com recebidas, propõe encaixe (não re-seleção)', () => {
  const comPosicionada: EstadoDaPartidaSnapshot = {
    ...snapshotFresco(),
    tabuleiro: {
      ...snapshotFresco().tabuleiro,
      posicionadas: [
        {
          pecaId: 'reta-1',
          tipo: 'reta',
          orientacao: 0,
          celula: { linha: 2, coluna: 3 },
        },
      ],
    },
  };
  let espelho = espelhoInicial(adaptarSnapshotParaEspelho(comPosicionada));
  espelho = dobrar(espelho, [
    { type: 'TURNO_INICIADO', jogadorId: 'bruno', rodada: 2 },
    { type: 'PEAO_SELECIONADO', peaoId: 'peao-vermelho' },
    {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-vermelho',
      pecaIdDe: 'inicial-2',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    },
    {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'bruno',
      peaoId: 'peao-vermelho',
      pecaId: 'reta-1',
      protegido: false,
    },
    {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'recebida-reta-9',
          pecaId: 'reta-9',
          tipoDaPeca: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: null,
        },
      ],
    },
  ]);
  // O mover re-seleciona no engine sem evento: o espelho segue a seleção.
  assert.equal(
    espelho.estado.tabuleiro.peaoSelecionadoId,
    'peao-vermelho',
  );
  const validas = acoesValidasDaSubfase(espelho.estado, 'bruno');
  // Pré-fix a seleção zerava e a FSM propunha selecionar_peao — aceito
  // idempotente SEM eventos pelo engine, timeout de 8s e desistência.
  assert.ok(
    !validas.some((a) => a.tipo === 'selecionar_peao'),
    'FSM deve encaixar, não re-selecionar',
  );
  assert.equal(validas[0]?.tipo, 'escolher_vaga_da_peca_recebida');
});
