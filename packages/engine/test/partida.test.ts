import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  aplicarComandoDePartida,
  bordasAbertas,
  calcularIluminacao,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  vagasDisponiveis,
  type ComandoDePartida,
  type CodigoDeErroDaPartida,
  type EstadoDaPartida,
  type EventoDaPartida,
  type Orientacao,
} from '../src/index.ts';

const selecionarPeca = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const girarPeca = (pecaId: string) =>
  ({ tipo: 'girar_peca', pecaId, sentido: 'horario' } as const);

const finalizarManipulacao = () =>
  ({ tipo: 'finalizar_manipulacao' } as const);

const posicionarPeca = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } } as const);

const escolherVaga = (
  recebidaId: string,
  borda: 'norte' | 'leste' | 'sul' | 'oeste',
) =>
  ({ tipo: 'escolher_vaga_da_peca_recebida', recebidaId, borda } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const permanecer = (peaoId: string) =>
  ({ tipo: 'permanecer', peaoId } as const);

const confirmarPosicao = (peaoId: string) =>
  ({ tipo: 'confirmar_posicao_do_peao', peaoId } as const);

const encerrarTurno = () => ({ tipo: 'encerrar_turno' } as const);

function aplicar(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): EstadoDaPartida {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
}

function codigoDaRejeicao(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): CodigoDeErroDaPartida {
  const resultado = aplicarComandoDePartida(estado, comando, ator);
  assert.equal(resultado.sucesso, false, 'esperava uma rejeição de domínio');
  if (resultado.sucesso) {
    throw new Error('inacessível');
  }
  return resultado.erro.codigo;
}

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

function partidaIniciadaCom(roster: readonly string[]): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(roster);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

function partidaIniciada(): EstadoDaPartida {
  return partidaIniciadaCom(JOGADORES);
}

const jogadorAtivo = (estado: EstadoDaPartida) => {
  const jogador = estado.jogadores.find(
    (item) => item.jogadorId === estado.jogadorAtivoId,
  );
  if (!jogador) {
    throw new Error('Partida sem Jogador Ativo');
  }
  return jogador;
};

// Resolve todas as pendências do Recebimento do Peão selecionado: escolhe a
// vaga de cada peça sorteada (primeira borda canônica ainda disponível), gira
// a Recebida até a borda voltada à Peça sob o Peão abrir (encaixe conectado,
// issue #311) e encaixa na célula-alvo derivada da vaga.
function resolverRecebidas(
  estado: EstadoDaPartida,
  ator: string,
): EstadoDaPartida {
  while (estado.tabuleiro.recebidas.length > 0) {
    const pendente = estado.tabuleiro.recebidas[0];
    let resolvida: EstadoDaPartida | undefined;
    for (const borda of ['norte', 'leste', 'sul', 'oeste'] as const) {
      const resultado = aplicarComandoDePartida(
        estado,
        escolherVaga(pendente.recebidaId, borda),
        ator,
      );
      if (resultado.sucesso) {
        resolvida = resultado.estado;
        break;
      }
    }
    if (!resolvida) {
      throw new Error(
        `nenhuma vaga disponível para a pendência ${pendente.recebidaId}`,
      );
    }
    estado = resolvida;
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === pendente.recebidaId,
    );
    if (!escolhida || escolhida.celulaAlvo === null || escolhida.vaga === null) {
      throw new Error('Recebida escolhida deveria ter vaga com célula-alvo');
    }
    // Gira (horário) até a borda voltada à Peça sob o Peão — o oposto da
    // vaga — abrir; sem conexão o encaixe é rejeitado (issue #311). Peças
    // Especiais e Monstros têm as 4 bordas abertas: giros = 0.
    const alvo = BORDA_OPOSTA[escolhida.vaga];
    let giros = 0;
    while (
      giros < 4 &&
      !bordasAbertas({
        tipo: escolhida.tipo,
        orientacao: ((escolhida.orientacao + 90 * giros) %
          360) as Orientacao,
      }).includes(alvo)
    ) {
      giros++;
    }
    if (giros === 4) {
      throw new Error(
        `nenhuma rotação conecta a pendência ${pendente.recebidaId}`,
      );
    }
    for (let giro = 0; giro < giros; giro++) {
      estado = aplicar(estado, girarPeca(escolhida.pecaId), ator);
    }
    estado = aplicar(
      estado,
      posicionarPeca(
        escolhida.pecaId,
        escolhida.celulaAlvo.linha,
        escolhida.celulaAlvo.coluna,
      ),
      ator,
    );
  }
  return estado;
}

// Primeiro Turno completo do Jogador Ativo: Peça Inicial própria (com giros
// opcionais), Peão sobre ela, Recebimento automático resolvido e
// Encerramento do Turno.
function concluirPrimeiroTurno(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
  giros = 0,
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = jogadorAtivo(estado);
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionarPeca(pecaId), ator);
  for (let giro = 0; giro < giros; giro++) {
    estado = aplicar(estado, girarPeca(pecaId), ator);
  }
  estado = aplicar(estado, posicionarPeca(pecaId, celula.linha, celula.coluna), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, celula.linha, celula.coluna),
    ator,
  );
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, encerrarTurno(), ator);
}

// Partida com os quatro Primeiros Turnos concluídos: a vez voltou ao primeiro
// Jogador, agora em turno normal (rodada 2). Peões em (3,3), (0,0), (6,6) e
// (1,0): diogo foge de (6,0) porque a vaga norte de bruno envolve para lá na
// grade toroidal (issue #260) — mesmo fixture de monstros.test.ts.
function partidaEmRodada2(): EstadoDaPartida {
  let estado = partidaIniciada();
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });
  return estado;
}

test('estadoInicialDaPartida monta o roster, a vez e o evento de abertura', () => {
  const resultado = estadoInicialDaPartida(JOGADORES);
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const estado = resultado.estado;
  assert.deepEqual(estado.jogadores, [
    { jogadorId: 'ana', ordem: 1, cor: 'branco', peaoId: 'peao-branco', primeiroTurnoPendente: true, sanidade: 3, protegido: false, emBaixaIluminacao: false, amedrontado: false },
    { jogadorId: 'bruno', ordem: 2, cor: 'vermelho', peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, protegido: false, emBaixaIluminacao: false, amedrontado: false },
    { jogadorId: 'carla', ordem: 3, cor: 'azul', peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, protegido: false, emBaixaIluminacao: false, amedrontado: false },
    { jogadorId: 'diogo', ordem: 4, cor: 'amarelo', peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, protegido: false, emBaixaIluminacao: false, amedrontado: false },
  ]);
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 1);
  assert.equal(estado.pecaDoInicioDoTurnoId, null);
  assert.equal(estado.posicaoConfirmada, false);
  assert.equal(estado.tabuleiro.caixa.length, 89);
  assert.equal(estado.tabuleiro.iniciais.length, 4);
  assert.equal(estado.tabuleiro.peoes.length, 4);
  assert.deepEqual(resultado.eventos, [
    { tipo: 'turno_iniciado', jogadorId: 'ana', rodada: 1 },
  ]);
});

test('estadoInicialDaPartida aceita rosters de 2 e 3 com N cores, iniciais e peões', () => {
  const dois = estadoInicialDaPartida(['ana', 'bruno']);
  assert.equal(dois.sucesso, true);
  if (!dois.sucesso) return;
  assert.deepEqual(
    dois.estado.jogadores.map((jogador) => jogador.jogadorId),
    ['ana', 'bruno'],
  );
  assert.deepEqual(
    dois.estado.jogadores.map((jogador) => [jogador.cor, jogador.peaoId]),
    [
      ['branco', 'peao-branco'],
      ['vermelho', 'peao-vermelho'],
    ],
  );
  assert.deepEqual(
    dois.estado.tabuleiro.iniciais.map((peca) => peca.pecaId),
    ['inicial-1', 'inicial-2'],
  );
  assert.deepEqual(
    dois.estado.tabuleiro.peoes.map((peao) => peao.peaoId),
    ['peao-branco', 'peao-vermelho'],
  );
  assert.equal(dois.estado.tabuleiro.caixa.length, 89);
  assert.equal(dois.estado.jogadorAtivoId, 'ana');
  assert.equal(dois.estado.rodada, 1);

  const tres = estadoInicialDaPartida(['ana', 'bruno', 'carla']);
  assert.equal(tres.sucesso, true);
  if (!tres.sucesso) return;
  assert.deepEqual(
    tres.estado.jogadores.map((jogador) => jogador.cor),
    ['branco', 'vermelho', 'azul'],
  );
  assert.deepEqual(
    tres.estado.tabuleiro.iniciais.map((peca) => peca.pecaId),
    ['inicial-1', 'inicial-2', 'inicial-3'],
  );
  assert.deepEqual(
    tres.estado.tabuleiro.peoes.map((peao) => peao.peaoId),
    ['peao-branco', 'peao-vermelho', 'peao-azul'],
  );
  assert.equal(tres.estado.tabuleiro.caixa.length, 89);
});

test('estadoInicialDaPartida rejeita rosters com 1 e 5+ jogadores, duplicidade ou id inválido', () => {
  const solo = estadoInicialDaPartida(['ana']);
  assert.equal(solo.sucesso, false);
  if (!solo.sucesso) {
    assert.equal(solo.erro.codigo, 'DADOS_INVALIDOS');
    assert.equal(solo.erro.mensagem, 'A Partida exige de dois a quatro jogadores.');
  }
  const quinteto = estadoInicialDaPartida([
    'ana',
    'bruno',
    'carla',
    'diogo',
    'extra',
  ]);
  assert.equal(quinteto.sucesso, false);
  if (!quinteto.sucesso) {
    assert.equal(quinteto.erro.codigo, 'DADOS_INVALIDOS');
    assert.equal(quinteto.erro.mensagem, 'A Partida exige de dois a quatro jogadores.');
  }
  assert.equal(estadoInicialDaPartida([]).sucesso, false);
  const duplicado = estadoInicialDaPartida(['ana', 'bruno', 'ana', 'diogo']);
  assert.equal(duplicado.sucesso, false);
  if (!duplicado.sucesso) {
    assert.equal(duplicado.erro.codigo, 'DADOS_INVALIDOS');
  }
  const vazio = estadoInicialDaPartida(['ana', 'bruno', 'carla', '   ']);
  assert.equal(vazio.sucesso, false);
  if (!vazio.sucesso) {
    assert.equal(vazio.erro.codigo, 'DADOS_INVALIDOS');
  }
});

test('rodada com N=2: os dois Primeiros Turnos devolvem a vez à ana na rodada 2', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.equal(estado.rodada, 1);
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);
  assert.ok(
    estado.jogadores.every((jogador) => !jogador.primeiroTurnoPendente),
  );
});

test('rodada com N=3: os três Primeiros Turnos devolvem a vez à ana na rodada 2', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno', 'carla']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  assert.equal(estado.jogadorAtivoId, 'bruno');
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'carla');
  assert.equal(estado.rodada, 1);
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);
  assert.ok(
    estado.jogadores.every((jogador) => !jogador.primeiroTurnoPendente),
  );
});

test('primeiro turno: Peça Inicial própria, Peão com Recebimento automático e Passagem de Vez', () => {
  let estado = partidaIniciada();

  const encaixeDoPeao = aplicarComandoDePartida(
    aplicar(
      aplicar(
        aplicar(estado, selecionarPeca('inicial-1'), 'ana'),
        posicionarPeca('inicial-1', 3, 3),
        'ana',
      ),
      selecionarPeao('peao-branco'),
      'ana',
    ),
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixeDoPeao.sucesso, true);
  if (!encaixeDoPeao.sucesso) return;
  // O encaixe gera o Recebimento automaticamente (norte e leste vazias): uma
  // peca_sorteada por peça retirada da Caixa (ordem de composição: reta-1 e
  // reta-2) e o Peão segue selecionado para a sequência.
  assert.deepEqual(encaixeDoPeao.eventos, [
    {
      tipo: 'peao_posicionado',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    },
    { tipo: 'peca_sorteada', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 },
    { tipo: 'peca_sorteada', pecaId: 'reta-2', tipoDaPeca: 'reta', orientacao: 0 },
    {
      tipo: 'recebimento_gerado',
      recebidas: [
        { recebidaId: 'recebida-reta-1', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0, vaga: null, celulaAlvo: null },
        { recebidaId: 'recebida-reta-2', pecaId: 'reta-2', tipoDaPeca: 'reta', orientacao: 0, vaga: null, celulaAlvo: null },
      ],
    },
    {
      tipo: 'celulas_iluminadas',
      celulas: [
        { linha: 2, coluna: 3 },
        { linha: 3, coluna: 2 },
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 4, coluna: 3 },
      ],
    },
  ]);
  assert.equal(encaixeDoPeao.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas.length, 2);
  estado = encaixeDoPeao.estado;

  estado = resolverRecebidas(estado, 'ana');
  assert.equal(estado.tabuleiro.recebidas.length, 0);

  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  // A última Recebida encaixada (reta-2) deixa a janela de Manipulação aberta;
  // a Passagem de Vez a encerra antes do turno_iniciado.
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'manipulacao_finalizada', pecaId: 'reta-2' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 1 },
  ]);
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
  assert.equal(encerramento.estado.rodada, 1);
  assert.equal(encerramento.estado.posicaoConfirmada, false);
  assert.equal(encerramento.estado.tabuleiro.peaoSelecionadoId, null);
  const ana = encerramento.estado.jogadores.find((item) => item.jogadorId === 'ana');
  assert.equal(ana?.primeiroTurnoPendente, false);
  const bruno = encerramento.estado.jogadores.find((item) => item.jogadorId === 'bruno');
  assert.equal(bruno?.primeiroTurnoPendente, true);
  // Peão de bruno ainda sobre a Mesa: Peça do início do turno indefinida.
  assert.equal(encerramento.estado.pecaDoInicioDoTurnoId, null);
});

test('Passagem de Vez encerra a janela de Manipulação e veda o turno seguinte sobre ela', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  estado = resolverRecebidas(estado, 'ana');

  // A última Recebida encaixada (reta-2) deixa a janela de Manipulação aberta.
  assert.equal(estado.tabuleiro.pecaEmManipulacaoId, 'reta-2');

  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'manipulacao_finalizada', pecaId: 'reta-2' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 1 },
  ]);
  assert.equal(encerramento.estado.tabuleiro.pecaEmManipulacaoId, null);
  assert.equal(encerramento.estado.tabuleiro.pecaSelecionadaId, null);

  // O Jogador seguinte não manipula a Peça posicionada pelo anterior: girar
  // ou finalizar sobre ela é MANIPULACAO_ENCERRADA, sem alterar o estado.
  const novoTurno = encerramento.estado;
  assert.equal(
    codigoDaRejeicao(novoTurno, girarPeca('reta-2'), 'bruno'),
    'MANIPULACAO_ENCERRADA',
  );
  assert.equal(
    codigoDaRejeicao(novoTurno, finalizarManipulacao(), 'bruno'),
    'MANIPULACAO_ENCERRADA',
  );
  assert.deepEqual(novoTurno, encerramento.estado);
});

test('PECA_INICIAL_INDISPONIVEL: só a própria inicial, e só no próprio Primeiro Turno', () => {
  const estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, selecionarPeca('inicial-2'), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeca('inicial-2', 3, 3), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );

  // Mesmo a própria inicial é vedada fora do Primeiro Turno.
  const foraDoPrimeiro: EstadoDaPartida = {
    ...partidaIniciada(),
    jogadores: partidaIniciada().jogadores.map((jogador) =>
      jogador.jogadorId === 'ana'
        ? { ...jogador, primeiroTurnoPendente: false }
        : jogador,
    ),
  };
  assert.equal(
    codigoDaRejeicao(foraDoPrimeiro, selecionarPeca('inicial-1'), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(foraDoPrimeiro, posicionarPeca('inicial-1', 3, 3), 'ana'),
    'PECA_INICIAL_INDISPONIVEL',
  );
});

test('MOVIMENTO_INDISPONIVEL no Primeiro Turno; encerrar exige Peão posicionado e zero pendências', () => {
  let estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );

  // Peão posicionado com Recebimento pendente: encerramento bloqueado.
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'PENDENCIA_NAO_RESOLVIDA',
  );

  estado = resolverRecebidas(estado, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
});

test('recebimento com caixa vazia gera zero pendências e permite encerrar o turno', () => {
  let estado = partidaIniciada();
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [],
      // Término (issue #176): com a caixa vazia, a partida só segue com os
      // objetivos atingíveis pela contagem — 3 geradores não ligados, sala
      // do diretor e portão de saída, todos sob a iluminação dos peões.
      // vermelho em (0,0) ilumina (0,0),(0,1),(1,0); branco em (3,3)
      // ilumina a cruz em torno da inicial-1.
      posicionadas: [
        { pecaId: 'gerador-1', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 2, coluna: 3 } },
        { pecaId: 'gerador-2', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 2 } },
        { pecaId: 'gerador-3', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 4, coluna: 3 } },
        { pecaId: 'sala-1', tipo: 'sala_do_diretor' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 4 } },
        { pecaId: 'portao-1', tipo: 'portao_de_saida' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 1 } },
        { pecaId: 'inicial-2', tipo: 'inicial' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 0 } },
      ],
      peoes: estado.tabuleiro.peoes.map((peao) =>
        peao.cor === 'vermelho' ? { ...peao, pecaId: 'inicial-2' } : peao,
      ),
    },
  };
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const encaixe = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  // Caixa vazia: nem peca_sorteada nem recebimento_gerado — e o turno pode
  // ser encerrado normalmente.
  assert.ok(!encaixe.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!encaixe.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.deepEqual(encaixe.estado.tabuleiro.recebidas, []);

  const encerramento = aplicarComandoDePartida(encaixe.estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
});

test('recebimento com caixa insuficiente entrega as peças restantes sem erro', () => {
  let estado = partidaIniciada();
  estado = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, caixa: estado.tabuleiro.caixa.slice(0, 1) },
  };
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  // Duas vagas, uma peça na Caixa: o Jogador recebe apenas a restante.
  assert.equal(estado.tabuleiro.recebidas.length, 1);
  assert.equal(estado.tabuleiro.recebidas[0].recebidaId, 'recebida-reta-1');
  assert.deepEqual(estado.tabuleiro.caixa, []);
});

test('FORA_DA_VEZ: ator fora da vez, desconhecido e elemento de outro Jogador', () => {
  const estado = partidaIniciada();

  assert.equal(
    codigoDaRejeicao(estado, selecionarPeca('inicial-1'), 'bruno'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'fantasma'),
    'FORA_DA_VEZ',
  );
  // Ação sobre o Peão de outro Jogador, mesmo com o ator na vez.
  assert.equal(
    codigoDaRejeicao(estado, selecionarPeao('peao-vermelho'), 'ana'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-vermelho', 3, 3), 'ana'),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-vermelho'), 'ana'),
    'FORA_DA_VEZ',
  );
  // Ator com texto inválido: dados inválidos precedem a vez.
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), '  '),
    'DADOS_INVALIDOS',
  );

  // Invariante: exatamente um Jogador Ativo após as rejeições.
  assert.equal(estado.jogadores.filter((item) => item.jogadorId === estado.jogadorAtivoId).length, 1);
});

test('selecionar_peao reentra na sequência sem Recebimento (ST-11)', () => {
  let estado = partidaEmRodada2();

  // Ana em rodada 2: Peça do início é a inicial-1, onde o Peão está.
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(estado.tabuleiro.recebidas, []);

  // Muda de Peça e re-seleciona: a Peça recém-ocupada (reta-1, norte vazio)
  // NÃO gera recebimento na seleção.
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.deepEqual(estado.tabuleiro.recebidas, []);

  // Permanecer fora da Peça do início do turno: encerramento inválido, sem
  // alterar o estado.
  const antes = estado;
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
  assert.deepEqual(estado, antes);
});

test('turno normal: mover, desfazer pela conexão simétrica, confirmar com Recebimento e encerrar', () => {
  let estado = partidaEmRodada2();

  // Mover para a reta-1 (2,3), desfazer voltando à inicial-1 e mover de novo.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const movimento = aplicarComandoDePartida(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(movimento.sucesso, true);
  if (!movimento.sucesso) return;
  assert.deepEqual(movimento.eventos, [
    {
      tipo: 'peao_movido',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    },
  ]);
  estado = movimento.estado;
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');

  // A re-seleção do mover (#263) já recolocou o Peão em sequência — sem
  // re-seleção explícita antes de confirmar (R1/review #333). A Confirmação
  // de Posição trava o Peão na Peça em que terminou e gera o Recebimento
  // (norte da reta-1 vazio; o sul aponta para a inicial-1 ocupada). A peça
  // sorteada é a 7ª da composição (reta-7: as seis primeiras — reta-1 a
  // reta-6 — já saíram nos quatro Primeiros Turnos).
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.deepEqual(confirmacao.eventos, [
    { tipo: 'posicao_confirmada', jogadorId: 'ana', peaoId: 'peao-branco', pecaId: 'reta-1', protegido: false },
    { tipo: 'peca_sorteada', pecaId: 'reta-7', tipoDaPeca: 'reta', orientacao: 0 },
    {
      tipo: 'recebimento_gerado',
      recebidas: [
        { recebidaId: 'recebida-reta-7', pecaId: 'reta-7', tipoDaPeca: 'reta', orientacao: 0, vaga: null, celulaAlvo: null },
      ],
    },
    {
      tipo: 'celulas_iluminadas',
      // Iluminação toroidal (issue #260): cantos envolvem para o lado oposto
      // — (0,0) ilumina (6,0) e (0,6); (6,6) ilumina (6,0) e (0,6).
      celulas: [
        // peao-vermelho em (0,0)
        { linha: 0, coluna: 0 },
        { linha: 0, coluna: 1 },
        { linha: 0, coluna: 6 },
        // peao-amarelo em (1,0)
        { linha: 1, coluna: 0 },
        { linha: 1, coluna: 1 },
        { linha: 1, coluna: 3 },
        { linha: 1, coluna: 6 },
        // peao-branco em (2,3)
        { linha: 2, coluna: 0 },
        { linha: 2, coluna: 2 },
        { linha: 2, coluna: 3 },
        { linha: 2, coluna: 4 },
        { linha: 3, coluna: 3 },
        // peao-azul em (6,6)
        { linha: 5, coluna: 6 },
        { linha: 6, coluna: 0 },
        { linha: 6, coluna: 5 },
        { linha: 6, coluna: 6 },
      ],
    },
    // Limpeza: a reta-2 (3,4) ficou fora da iluminação da reta-1 (2,3).
    { tipo: 'limpeza_aplicada', pecasRemovidas: ['reta-2'] },
  ]);
  assert.equal(confirmacao.estado.posicaoConfirmada, true);
  estado = confirmacao.estado;

  // Após confirmar, mover, permanecer e re-confirmar são rejeitados.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'POSICAO_CONFIRMADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'POSICAO_CONFIRMADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'POSICAO_CONFIRMADA',
  );

  estado = resolverRecebidas(estado, 'ana');
  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  // A Recebida encaixada (reta-7) deixa a janela de Manipulação aberta; a
  // Passagem de Vez a encerra antes do turno_iniciado.
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'manipulacao_finalizada', pecaId: 'reta-7' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 2 },
  ]);
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
  assert.equal(encerramento.estado.rodada, 2);
  assert.equal(encerramento.estado.posicaoConfirmada, false);
  // Peça do início do turno de bruno: a inicial-2, onde o Peão dele ficou.
  assert.equal(encerramento.estado.pecaDoInicioDoTurnoId, 'inicial-2');
  assert.equal(encerramento.estado.tabuleiro.peaoSelecionadoId, null);
});

// Issue #326: a Confirmação preserva a seleção do Peão confirmado — a
// re-seleção do mover (#263, partida.ts) atravessa a Confirmação e as
// Recebidas ficam encaixáveis sem re-seleção intermediária.
test('confirmação preserva a seleção do peão confirmado — Recebidas encaixáveis sem re-seleção (#326)', () => {
  let estado = partidaEmRodada2();

  // A re-seleção do mover (#263) já devolve a seleção: mover direto, sem
  // selecionar_peao depois.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');

  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');

  // Escolher a vaga e encaixar direto, sem selecionar_peao no meio.
  estado = resolverRecebidas(confirmacao.estado, 'ana');
  // aplicar lança em rejeição: o encerramento válido é a prova final.
  estado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(estado.posicaoConfirmada, false);
});

// Defesa do restore (#326): mesmo quando o estado chega à Confirmação SEM
// seleção (base sem a re-seleção do mover, ou estado persistido antigo), a
// Confirmação adota o Peão confirmado e a sequência continua encaixável.
test('confirmação com seleção nula no estado restaura o peão confirmado (#326)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  // Zera a seleção como um motor sem a re-seleção do mover deixaria.
  const semSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: null },
  };

  const confirmacao = aplicarComandoDePartida(semSelecao, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');

  estado = resolverRecebidas(confirmacao.estado, 'ana');
  // aplicar lança em rejeição: o encerramento válido é a prova final.
  estado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(estado.posicaoConfirmada, false);
});

// B1/review #333: estado persistido do pré-deploy — Confirmação já ocorreu
// com seleção nula e Recebidas pendentes; os comandos de vaga/encaixe
// resolvem sem re-seleção (pré-adoção do ator) e o turno encerra.
test('estado persistido com seleção nula e Recebidas pendentes resolve sem re-seleção (#326)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.ok(confirmacao.estado.tabuleiro.recebidas.length > 0);
  // Esvazia a seleção como o estado persistido do pré-deploy chegaria.
  const persistido: EstadoDaPartida = {
    ...confirmacao.estado,
    tabuleiro: { ...confirmacao.estado.tabuleiro, peaoSelecionadoId: null },
  };
  estado = resolverRecebidas(persistido, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(estado.posicaoConfirmada, false);
});

// M2/review #333: o giro da Recebida cura o stale na mesma medida de escolher
// vaga/encaixar — pré-adoção do ator com seleção nula persistida. A vaga é
// escolhida antes (o giro da Recebida roteia pela peça selecionada, contrato
// do Tabuleiro) e a seleção do Peão re-zerada para isolar a cura feita PELO
// giro — o estado stale com Recebidas pendentes pode ocorrer em qualquer
// passo da sequência (escolher → girar → encaixar).
test('girar Recebida com seleção nula adota o Peão do ator (#326)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  const persistido: EstadoDaPartida = {
    ...confirmacao.estado,
    tabuleiro: { ...confirmacao.estado.tabuleiro, peaoSelecionadoId: null },
  };
  const recebida = persistido.tabuleiro.recebidas[0]!;
  // Escolhe a vaga da primeira Recebida (primeira borda canônica disponível).
  let escolhido: EstadoDaPartida | undefined;
  for (const borda of ['norte', 'leste', 'sul', 'oeste'] as const) {
    const resultado = aplicarComandoDePartida(
      persistido,
      escolherVaga(recebida.recebidaId, borda),
      'ana',
    );
    if (resultado.sucesso) {
      escolhido = resultado.estado;
      break;
    }
  }
  if (!escolhido) {
    throw new Error('esperava uma vaga disponível para a primeira Recebida');
  }
  // Re-zero do estado persistido: Recebida selecionada, seleção do Peão nula.
  const stale: EstadoDaPartida = {
    ...escolhido,
    tabuleiro: { ...escolhido.tabuleiro, peaoSelecionadoId: null },
  };
  const giro = aplicarComandoDePartida(stale, girarPeca(recebida.pecaId), 'ana');
  assert.equal(giro.sucesso, true);
  if (!giro.sucesso) return;
  assert.equal(giro.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
});

// Guarda de outra seleção com pendências: a proteção PENDENCIA_NAO_RESOLVIDA
// (tabuleiro) e o guard de peão alheio (partida) seguem de pé pós-confirmação.
test('com pendências pós-confirmação, peão alheio segue rejeitado (FORA_DA_VEZ)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.ok(confirmacao.estado.tabuleiro.recebidas.length > 0);

  assert.equal(
    codigoDaRejeicao(confirmacao.estado, selecionarPeao('peao-vermelho'), 'ana'),
    'FORA_DA_VEZ',
  );
});

// Guarda da #332: a Confirmação com OUTRO Peão selecionado segue recusada —
// o estado artesanal é o único caminho (no fluxo válido o Peão alheio nunca
// é selecionável pelo ator), e o guard existe exatamente para estados
// divergentes/derivados de bases antigas.
test('confirmação com outro peão selecionado é recusada (PEAO_NAO_SELECIONADO)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  const outroSelecionado: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: 'peao-vermelho' },
  };

  assert.equal(
    codigoDaRejeicao(outroSelecionado, confirmarPosicao('peao-branco'), 'ana'),
    'PEAO_NAO_SELECIONADO',
  );
});

test('confirmar sem mudança de Peça e no Primeiro Turno são ENCERRAMENTO_INVALIDO', () => {
  let estado = partidaEmRodada2();

  // Sem movimento: o Peão segue na Peça do início do turno.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );

  // No Primeiro Turno não existe Confirmação de Posição.
  let primeiro = partidaIniciada();
  primeiro = aplicar(primeiro, selecionarPeca('inicial-1'), 'ana');
  primeiro = aplicar(primeiro, posicionarPeca('inicial-1', 3, 3), 'ana');
  primeiro = aplicar(primeiro, selecionarPeao('peao-branco'), 'ana');
  primeiro = aplicar(primeiro, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(
    codigoDaRejeicao(primeiro, confirmarPosicao('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
});

test('permanecer sem mudança de Peça encerra o turno direto, sem Recebimento', () => {
  let estado = partidaEmRodada2();

  // Ana em rodada 2: Peça do início é a inicial-1, Peão ainda sobre ela.
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const permanencia = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.deepEqual(permanencia.eventos, [
    { tipo: 'peao_permaneceu', peaoId: 'peao-branco', pecaId: 'inicial-1' },
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 2 },
  ]);
  assert.ok(!permanencia.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(permanencia.estado.jogadorAtivoId, 'bruno');
  assert.equal(permanencia.estado.posicaoConfirmada, false);
  assert.equal(permanencia.estado.pecaDoInicioDoTurnoId, 'inicial-2');
});

test('permanecer após mudar de Peça é ENCERRAMENTO_INVALIDO e preserva o estado', () => {
  let estado = partidaEmRodada2();

  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const antes = estado;
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
  assert.deepEqual(estado, antes);
  assert.equal(estado.jogadorAtivoId, 'ana');
});

test('encerrar_turno em turno normal sem Confirmação é ENCERRAMENTO_INVALIDO', () => {
  const estado = partidaEmRodada2();

  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
});

test('avanço circular: os quatro encerram o Primeiro Turno e a vez volta ao primeiro na rodada 2', () => {
  let estado = partidaIniciada();

  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.equal(estado.rodada, 1);

  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  assert.equal(estado.jogadorAtivoId, 'diogo');
  assert.equal(estado.rodada, 1);

  // (1,0) em vez de (6,0): a vaga norte de bruno envolve para (6,0) — grade
  // toroidal (issue #260).
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);
  assert.ok(estado.jogadores.every((jogador) => !jogador.primeiroTurnoPendente));
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
});

test('rotação pós-Primeiros Turnos N=2: wrap ana→bruno→ana abre a rodada 3', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);

  // Turno normal sem mudança de Peça encerra direto (permanecer).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, permanecer('peao-branco'), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.equal(estado.rodada, 2);

  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 3);
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
});

test('rotação pós-Primeiros Turnos N=3: wrap ana→bruno→carla→ana abre a rodada 3', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno', 'carla']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 2);

  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, permanecer('peao-branco'), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
  assert.equal(estado.rodada, 2);

  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(estado.jogadorAtivoId, 'carla');
  assert.equal(estado.rodada, 2);

  estado = aplicar(estado, selecionarPeao('peao-azul'), 'carla');
  estado = aplicar(estado, permanecer('peao-azul'), 'carla');
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.rodada, 3);
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
});

test('após qualquer rejeição o estado da Partida fica inalterado, com um único Jogador Ativo', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');

  const antes = estado;
  const rejeicoes: ComandoDePartida[] = [
    moverPeao('peao-branco', 3, 4),
    permanecer('peao-branco'),
    confirmarPosicao('peao-branco'),
    encerrarTurno(),
    selecionarPeao('peao-vermelho'),
    selecionarPeca('inicial-2'),
  ];
  for (const comando of rejeicoes) {
    const resultado = aplicarComandoDePartida(estado, comando, 'ana');
    assert.equal(resultado.sucesso, false, `esperava rejeição para ${comando.tipo}`);
    assert.deepEqual(estado, antes);
    assert.equal(
      estado.jogadores.filter((jogador) => jogador.jogadorId === estado.jogadorAtivoId).length,
      1,
    );
    assert.equal(estado.rodada, 1);
  }
});

test('iluminação: inicial vazia, 1 peão centro ilumina 5, canto ilumina 5 com wrap, diagonais nunca (issue #260)', () => {
  let estado = partidaIniciada();
  assert.deepEqual(estado.celulasIluminadas, []);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.deepEqual(estado.celulasIluminadas, [
    { linha: 2, coluna: 3 },
    { linha: 3, coluna: 2 },
    { linha: 3, coluna: 3 },
    { linha: 3, coluna: 4 },
    { linha: 4, coluna: 3 },
  ]);
  // Diagonais nunca iluminadas
  assert.ok(!estado.celulasIluminadas.some((c) => c.linha === 2 && c.coluna === 2));
  assert.ok(!estado.celulasIluminadas.some((c) => c.linha === 2 && c.coluna === 4));

  // Encerrar e posicionar no canto (0,0) → 5 células com o wrap toroidal
  // (issue #260): (0,0),(0,1),(1,0) mais (6,0) e (0,6) do lado oposto.
  estado = resolverRecebidas(estado, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');
  estado = aplicar(estado, selecionarPeca('inicial-2'), 'bruno');
  estado = aplicar(estado, posicionarPeca('inicial-2', 0, 0), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, posicionarPeao('peao-vermelho', 0, 0), 'bruno');
  assert.equal(estado.celulasIluminadas.length, 10);
  // Células do canto: (0,0),(0,1),(1,0) — sem diagonais fora da grade
  const borda = estado.celulasIluminadas.filter((c) => c.linha <= 1 && c.coluna <= 1);
  assert.deepEqual(borda.sort((a, b) => a.linha - b.linha || a.coluna - b.coluna), [
    { linha: 0, coluna: 0 },
    { linha: 0, coluna: 1 },
    { linha: 1, coluna: 0 },
  ]);
  // O wrap alcança o lado oposto.
  assert.ok(estado.celulasIluminadas.some((c) => c.linha === 6 && c.coluna === 0));
  assert.ok(estado.celulasIluminadas.some((c) => c.linha === 0 && c.coluna === 6));
});

test('iluminação: união desduplicada e independente de conexões/orientação, vazias inclusas', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, girarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  // Apesar do giro, iluminação ortogonal idêntica
  assert.equal(estado.celulasIluminadas.length, 5);

  // União dedup 8 únicas via função pura (evita colisão com recebidas ocupadas)
  const tab = estadoInicialDoTabuleiro();
  const tabComDois = {
    ...tab,
    posicionadas: [
      { pecaId: 'inicial-1', tipo: 'inicial' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 3 } },
      { pecaId: 'inicial-2', tipo: 'inicial' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 4 } },
    ],
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco' as const, pecaId: 'inicial-1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho' as const, pecaId: 'inicial-2' },
      { peaoId: 'peao-azul', cor: 'azul' as const, pecaId: null },
      { peaoId: 'peao-amarelo', cor: 'amarelo' as const, pecaId: null },
    ],
  };
  const iluminacao = calcularIluminacao(tabComDois);
  assert.equal(iluminacao.length, 8);
  assert.deepEqual(iluminacao, [
    { linha: 2, coluna: 3 },
    { linha: 2, coluna: 4 },
    { linha: 3, coluna: 2 },
    { linha: 3, coluna: 3 },
    { linha: 3, coluna: 4 },
    { linha: 3, coluna: 5 },
    { linha: 4, coluna: 3 },
    { linha: 4, coluna: 4 },
  ]);
  // Vazias inclusas: (2,3) e (3,5) não têm peças mas estão iluminadas
  assert.ok(iluminacao.some((c) => c.linha === 2 && c.coluna === 3));
  assert.ok(iluminacao.some((c) => c.linha === 3 && c.coluna === 5));
  // Independe de orientação/conexões: girar peças não muda vizinhança ortogonal
  const tabGirado = {
    ...tabComDois,
    posicionadas: tabComDois.posicionadas.map((p) => ({ ...p, orientacao: 90 as const })),
  };
  assert.deepEqual(calcularIluminacao(tabGirado), iluminacao);
});

test('iluminação: mover_peao não altera até confirmar_posicao_do_peao; permanecer/selecionar/posicionar_peca não alteram', () => {
  let estado = partidaEmRodada2();
  const antes = [...estado.celulasIluminadas];
  // selecionar_peao não altera
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(estado.celulasIluminadas, antes);

  // A Caixa é opaca (ST-12): selecionar peça de caminho direto dela é
  // rejeitado — e a rejeição preserva o estado e a iluminação.
  const sel = aplicarComandoDePartida(estado, selecionarPeca('cruz-1'), 'ana');
  assert.equal(sel.sucesso, false);
  if (sel.sucesso) throw new Error('inacessível');
  assert.equal(sel.erro.codigo, 'PECA_NAO_ENCONTRADA');
  assert.deepEqual(estado.celulasIluminadas, antes);
  // girar_peca sobre peça da Caixa é rejeitado, sem alterar a iluminação
  // (que independe de orientação).
  const gir = aplicarComandoDePartida(estado, girarPeca('cruz-1'), 'ana');
  assert.equal(gir.sucesso, false);
  if (gir.sucesso) throw new Error('inacessível');
  assert.equal(gir.erro.codigo, 'PECA_NAO_ENCONTRADA');
  assert.deepEqual(estado.celulasIluminadas, antes);
  // posicionar_peca delegado (caminho direto é PECA_NAO_RECEBIDA, mas ainda preserva iluminação)
  const pos = aplicarComandoDePartida(estado, posicionarPeca('cruz-1', 1, 1), 'ana');
  assert.equal(pos.sucesso, false);
  assert.equal(pos.erro.codigo, 'PECA_NAO_RECEBIDA');

  assert.deepEqual(estado.celulasIluminadas, antes);
  // Mover tentativo não altera
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.deepEqual(estado.celulasIluminadas, antes);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(estado.celulasIluminadas, antes);
  const confirm = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirm.sucesso, true);
  if (!confirm.sucesso) throw new Error('confirmar deveria suceder');
  assert.notDeepEqual(confirm.estado.celulasIluminadas, antes);
  assert.ok(confirm.estado.celulasIluminadas.some((c) => c.linha === 1 && c.coluna === 3));
  // Após confirmar, mover bloqueado e iluminação permanece
  const depois = [...confirm.estado.celulasIluminadas];
  assert.equal(
    codigoDaRejeicao(confirm.estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'POSICAO_CONFIRMADA',
  );
  assert.deepEqual(confirm.estado.celulasIluminadas, depois);
  // Permanecer em turno onde não mudou de peça não altera até avançar
  let permEstado = partidaEmRodada2();
  const permAntes = [...permEstado.celulasIluminadas];
  permEstado = aplicar(permEstado, selecionarPeao('peao-branco'), 'ana');
  const permRes = aplicarComandoDePartida(permEstado, permanecer('peao-branco'), 'ana');
  assert.equal(permRes.sucesso, true);
  if (!permRes.sucesso) throw new Error('permanecer deveria suceder');
  assert.deepEqual(permRes.estado.celulasIluminadas, permAntes);
});

// Injetor de estado: adiciona uma peça manualmente a posicionadas, como os
// testes de iluminação fazem com tabComDois — para forçar uma peça fora do
// alcance do Peão sem depender da sequência completa do Recebimento.
function comPecaFora(
  estado: EstadoDaPartida,
  pecaId: string,
  tipo: 'inicial' | 'reta' | 'T' | 'cruz' | 'gerador',
  linha: number,
  coluna: number,
): EstadoDaPartida {
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        { pecaId, tipo, orientacao: 0 as const, celula: { linha, coluna } },
      ],
    },
  };
}

const temLimpeza = (eventos: readonly { readonly tipo: string }[]) =>
  eventos.some((evento) => evento.tipo === 'limpeza_aplicada');

test('zona da origem: o segundo salto do Peão dentro do turno é barrado (MOVIMENTO_INDISPONIVEL)', () => {
  let estado = partidaEmRodada2();
  // Peça além do 1º salto: vizinha da reta-1 e conectada a ela (reta norte-sul
  // em (1,3)), mas FORA da zona de inicial-1 (3,3).
  estado = comPecaFora(estado, 'longe-1', 'reta', 1, 3);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // 1º salto (3,3) → (2,3): dentro da zona {inicial-1} ∪ suas vizinhas.
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  // 2º salto (2,3) → (1,3): conectado à origem atual, mas fora da zona do
  // início do turno → barrado antes de qualquer movimento.
  const segundo = aplicarComandoDePartida(
    estado,
    moverPeao('peao-branco', 1, 3),
    'ana',
  );
  assert.equal(segundo.sucesso, false);
  if (segundo.sucesso) return;
  assert.equal(segundo.erro.codigo, 'MOVIMENTO_INDISPONIVEL');
  // Ida-e-volta livre permanece: voltar à Peça do início do turno segue ok.
  const volta = aplicarComandoDePartida(
    estado,
    moverPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(volta.sucesso, true);
});

test('limpeza: Primeiro Turno remove peça fora da iluminação sem retorno à Caixa', () => {
  let estado = partidaIniciada();
  const caixaAntes = estado.tabuleiro.caixa.length;
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Peão em (3,3) ilumina (2,3),(3,2),(3,3),(3,4),(4,3); (0,0) fica fora.
  estado = comPecaFora(estado, 'fora-1', 'inicial', 0, 0);

  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const limpeza = resultado.eventos.find((e) => e.tipo === 'limpeza_aplicada');
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza?.tipo !== 'limpeza_aplicada') return;
  assert.deepEqual(limpeza.pecasRemovidas, ['fora-1']);
  assert.ok(
    !resultado.estado.tabuleiro.posicionadas.some((p) => p.pecaId === 'fora-1'),
  );
  // Sem retorno à Caixa: a peça removida não volta para a caixa.
  // caixaAntes é o tamanho antes de posicionarPeao; gerarRecebidas desenha
  // peças da Caixa. Verifica que a limpeza não altera o resultado.
  const recebimento = resultado.eventos.find((e) => e.tipo === 'recebimento_gerado');
  const desenhadas = recebimento ? (recebimento.recebidas as readonly unknown[]).length : 0;
  assert.equal(resultado.estado.tabuleiro.caixa.length, caixaAntes - desenhadas);
});

test('limpeza: Confirmação de Posição com mudança de peça remove peça fora da iluminação', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Fora da iluminação dos quatro peões em rodada 2.
  estado = comPecaFora(estado, 'fora-2', 'cruz', 0, 5);

  const resultado = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const limpeza = resultado.eventos.find((e) => e.tipo === 'limpeza_aplicada');
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza?.tipo !== 'limpeza_aplicada') return;
  // Inclui a peça injetada fora da iluminação (outras peças posicionadas fora
  // da iluminação — ex: reta-2 — também são limpas, conforme o esperado).
  assert.ok(limpeza.pecasRemovidas.includes('fora-2'));
  assert.ok(limpeza.pecasRemovidas.includes('reta-2'));
  assert.ok(
    !resultado.estado.tabuleiro.posicionadas.some((p) => p.pecaId === 'fora-2'),
  );
});

test('limpeza: peça sob o peão é preservada', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Peça fora da iluminação, para garantir que o evento dispara.
  estado = comPecaFora(estado, 'fora-3', 'T', 5, 5);

  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  // A peça sob o peão (inicial-1, iluminada por ele) e a peça do peão em si
  // permanecem em posicionadas e não estão em limpeza_aplicada.
  assert.ok(
    resultado.estado.tabuleiro.posicionadas.some((p) => p.pecaId === 'inicial-1'),
  );
  const limpeza = resultado.eventos.find((e) => e.tipo === 'limpeza_aplicada');
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza?.tipo !== 'limpeza_aplicada') return;
  assert.ok(!limpeza.pecasRemovidas.includes('inicial-1'));
});

test('limpeza: mover_peao, permanecer e encerrar_turno não emitem limpeza_aplicada', () => {
  // mover_peao
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = comPecaFora(estado, 'fora-m1', 'reta', 0, 5);
  const mov = aplicarComandoDePartida(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(mov.sucesso, true);
  if (!mov.sucesso) return;
  assert.ok(!temLimpeza(mov.eventos), 'mover_peao não deve limpar');

  // permanecer (sem mudança de peça encerra o turno direto)
  let perm = partidaEmRodada2();
  perm = aplicar(perm, selecionarPeao('peao-branco'), 'ana');
  perm = comPecaFora(perm, 'fora-p1', 'cruz', 0, 5);
  const resPerm = aplicarComandoDePartida(perm, permanecer('peao-branco'), 'ana');
  assert.equal(resPerm.sucesso, true);
  if (!resPerm.sucesso) return;
  assert.ok(!temLimpeza(resPerm.eventos), 'permanecer não deve limpar');

  // encerrar_turno (Primeiro Turno, com recebidas resolvidas)
  let enc = partidaIniciada();
  enc = aplicar(enc, selecionarPeca('inicial-1'), 'ana');
  enc = aplicar(enc, posicionarPeca('inicial-1', 3, 3), 'ana');
  enc = aplicar(enc, selecionarPeao('peao-branco'), 'ana');
  enc = aplicar(enc, posicionarPeao('peao-branco', 3, 3), 'ana');
  enc = resolverRecebidas(enc, 'ana');
  enc = comPecaFora(enc, 'fora-e1', 'gerador', 0, 5);
  const resEnc = aplicarComandoDePartida(enc, encerrarTurno(), 'ana');
  assert.equal(resEnc.sucesso, true);
  if (!resEnc.sucesso) return;
  assert.ok(!temLimpeza(resEnc.eventos), 'encerrar_turno não deve limpar');
});

test('limpeza: remove só peças, preservando caixa, peões, jogadores e iluminação', () => {
  let estado = partidaIniciada();
  const caixaAntes = estado.tabuleiro.caixa.length;
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = comPecaFora(estado, 'fora-4', 'reta', 0, 0);

  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const { tabuleiro, jogadores, celulasIluminadas } = resultado.estado;
  // A peça sob o peão permanece; a de fora é removida.
  assert.equal(tabuleiro.posicionadas.length, 1);
  assert.deepEqual(
    tabuleiro.posicionadas.map((p) => p.pecaId),
    ['inicial-1'],
  );
  const recebimento = resultado.eventos.find((e) => e.tipo === 'recebimento_gerado');
  const desenhadas = recebimento ? (recebimento.recebidas as readonly unknown[]).length : 0;
  assert.equal(tabuleiro.caixa.length, caixaAntes - desenhadas, 'Caixa intacta');
  assert.equal(tabuleiro.peoes.length, 4, 'Peões intactos');
  assert.equal(jogadores.length, 4, 'Jogadores intactos');
  assert.equal(jogadores.filter((j) => j.jogadorId === estado.jogadorAtivoId).length, 1);
  // Iluminação do peão em (3,3), recalculada e íntegra.
  assert.equal(celulasIluminadas.length, 5);
  assert.ok(celulasIluminadas.some((c) => c.linha === 3 && c.coluna === 3));
});

test('limpeza: remove peça inicial, de caminho e especial fora da iluminação', () => {
  let estado = partidaIniciada();
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Inicial, de caminho e especial, todas fora da iluminação de (3,3).
  estado = comPecaFora(estado, 'inicial-x', 'inicial', 0, 0);
  estado = comPecaFora(estado, 'reta-x', 'reta', 6, 6);
  estado = comPecaFora(estado, 'gerador-x', 'gerador', 6, 0);

  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const limpeza = resultado.eventos.find((e) => e.tipo === 'limpeza_aplicada');
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza?.tipo !== 'limpeza_aplicada') return;
  assert.deepEqual(
    limpeza.pecasRemovidas,
    ['inicial-x', 'reta-x', 'gerador-x'],
  );
  const ids = resultado.estado.tabuleiro.posicionadas.map((p) => p.pecaId);
  assert.ok(!ids.includes('inicial-x'));
  assert.ok(!ids.includes('reta-x'));
  assert.ok(!ids.includes('gerador-x'));
  assert.ok(ids.includes('inicial-1'));
});

// Travessia do Escuro (issue #264 / spec #272): comando exclusivo de Baixa
// Iluminação. Helpers locais — o estado da travessia posiciona o Peão de ana
// sobre a reta-1 em (2,3) e re-seleciona: a vaga norte (1,3) é escura, vazia
// e conectada; as rodadas anteriores já consumiram as reta-1..6 da Caixa
// (topo reta-7), então o sorteio de Baixa (1 peça) puxa o topo controlado.
const atravessarOEscuro = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'atravessar_o_escuro', peaoId, celula: { linha, coluna } } as const);

function comJogadorEmBaixa(
  estado: EstadoDaPartida,
  jogadorId: string,
): EstadoDaPartida {
  return {
    ...estado,
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === jogadorId
        ? { ...jogador, emBaixaIluminacao: true }
        : jogador,
    ),
  };
}

function estadoDaTravessia(): EstadoDaPartida {
  // ADR-0014 (regra "uma casa por turno"): a Travessia só parte da Peça do
  // início do turno. A peça branca em rodada 2 aqui é a que repousa na
  // vizinha (2,3) do inicial-1 — o turno "começa" nela (estado válido de
  // rodada avançada: o peão está onde parou no turno anterior).
  const base = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
  const peca = base.tabuleiro.posicionadas.find(
    (p) => p.celula.linha === 2 && p.celula.coluna === 3,
  );
  if (!peca) {
    throw new Error('esperava uma peça em (2,3) para a Travessia');
  }
  let estado: EstadoDaPartida = {
    ...base,
    pecaDoInicioDoTurnoId: peca.pecaId,
    tabuleiro: {
      ...base.tabuleiro,
      peoes: base.tabuleiro.peoes.map((p) =>
        p.peaoId === 'peao-branco' ? { ...p, pecaId: peca.pecaId } : p,
      ),
    },
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  return estado;
}

test('travessia do Escuro: rejeitada quando o Peão já se moveu (fora da Peça do início — "uma casa por turno")', () => {
  // Bug 1: mover para a peça iluminada (vizinho do inicial-1 NÃO é a Peça do
  // início do turno) e atravessar dali contaria como dois movimentos — a
  // Travessia só vale na Peça em que o turno começou.
  let estado = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  const travessia = aplicarComandoDePartida(
    estado,
    atravessarOEscuro('peao-branco', 1, 3),
    'ana',
  );
  assert.equal(travessia.sucesso, false);
  if (travessia.sucesso) return;
  assert.equal(travessia.erro.codigo, 'MOVIMENTO_INDISPONIVEL');
  assert.match(travessia.erro.mensagem, /Peça do início do turno/);
});

test('travessia do Escuro: atravessar, encaixar a Recebida travada, confirmar sem re-seleção e encerrar', () => {
  let estado = estadoDaTravessia();
  // Caixa controlada: o Recebimento de Baixa (1 peça) puxa o topo (reta-x),
  // garantindo determinismo; a fora-esc em (0,5) garante limpeza na
  // Confirmação sem depender da sequência completa do Recebimento.
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [
        { pecaId: 'reta-x', tipo: 'reta' as const, orientacao: 0 as const },
        ...estado.tabuleiro.caixa,
      ],
    },
  };
  estado = comPecaFora(estado, 'fora-esc', 'reta', 0, 5);

  const travessia = aplicarComandoDePartida(
    estado,
    atravessarOEscuro('peao-branco', 1, 3),
    'ana',
  );
  assert.equal(travessia.sucesso, true);
  if (!travessia.sucesso) return;
  // Lote canônico: atravessou_o_escuro abre, seguido do sorteio único de
  // Baixa (peca_sorteada + recebimento_gerado com a célula-alvo PRÉ-FIXADA
  // na célula escura da travessia).
  assert.deepEqual(travessia.eventos, [
    {
      tipo: 'atravessou_o_escuro',
      peaoId: 'peao-branco',
      celula: { linha: 1, coluna: 3 },
    },
    { tipo: 'peca_sorteada', pecaId: 'reta-x', tipoDaPeca: 'reta', orientacao: 0 },
    {
      tipo: 'recebimento_gerado',
      recebidas: [
        {
          recebidaId: 'recebida-reta-x',
          pecaId: 'reta-x',
          tipoDaPeca: 'reta',
          orientacao: 0,
          vaga: null,
          celulaAlvo: { linha: 1, coluna: 3 },
        },
      ],
    },
  ]);
  assert.equal(travessia.estado.atravessouNoTurno, true);
  // A Seleção do Peão é preservada para a sequência (escolher → encaixar →
  // mover); a pendência nasce SEM vaga — a escolha da borda é o passo
  // seguinte — mas JÁ com a célula-alvo travada.
  assert.equal(travessia.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.equal(travessia.estado.tabuleiro.recebidas.length, 1);
  const pendencia = travessia.estado.tabuleiro.recebidas[0];
  assert.equal(pendencia.vaga, null);
  assert.deepEqual(pendencia.celulaAlvo, { linha: 1, coluna: 3 });
  estado = travessia.estado;

  // ST-15 / issue #264: a escolha da vaga aceita apenas a borda que mapeia à
  // célula travada — leste (2,4) é DADOS_INVALIDOS; norte (1,3) flui.
  assert.equal(
    codigoDaRejeicao(estado, escolherVaga('recebida-reta-x', 'leste'), 'ana'),
    'DADOS_INVALIDOS',
  );
  estado = aplicar(estado, escolherVaga('recebida-reta-x', 'norte'), 'ana');
  assert.equal(
    estado.tabuleiro.recebidas[0].vaga,
    'norte',
  );

  estado = aplicar(estado, posicionarPeca('reta-x', 1, 3), 'ana');
  assert.equal(estado.tabuleiro.recebidas.length, 0);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  assert.equal(
    estado.tabuleiro.peoes.find((peao) => peao.peaoId === 'peao-branco')?.pecaId,
    'reta-x',
  );

  // AC-3 do #272: a Confirmação NÃO exige o Peão selecionado (o movimento o
  // deseleciona) — o fluxo de Baixa continua até o Encerramento do Turno.
  const confirmacao = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.deepEqual(confirmacao.eventos, [
    {
      tipo: 'posicao_confirmada',
      jogadorId: 'ana',
      peaoId: 'peao-branco',
      pecaId: 'reta-x',
      protegido: false,
    },
    {
      tipo: 'celulas_iluminadas',
      // Iluminação toroidal (issue #260): cantos envolvem para o lado oposto;
      // peao-amarelo em (1,0) (fixture de rodada 2) e peao-branco em Baixa.
      celulas: [
        // peao-vermelho em (0,0)
        { linha: 0, coluna: 0 },
        { linha: 0, coluna: 1 },
        { linha: 0, coluna: 6 },
        // peao-amarelo em (1,0)
        { linha: 1, coluna: 0 },
        { linha: 1, coluna: 1 },
        // peao-branco em (1,3) — Baixa Iluminação: apenas a própria célula
        { linha: 1, coluna: 3 },
        { linha: 1, coluna: 6 },
        { linha: 2, coluna: 0 },
        // peao-azul em (6,6)
        { linha: 5, coluna: 6 },
        { linha: 6, coluna: 0 },
        { linha: 6, coluna: 5 },
        { linha: 6, coluna: 6 },
      ],
    },
    // Limpeza: inicial-1, reta-1, reta-2 e fora-esc ficaram fora da
    // iluminação (Baixa cobre só a célula do peão); a reta-x (sob o peão) e
    // as demais peças sob os peões são preservadas.
    {
      tipo: 'limpeza_aplicada',
      pecasRemovidas: ['inicial-1', 'reta-1', 'reta-2', 'fora-esc'],
    },
  ]);
  // Em Baixa a Confirmação NÃO sorteia (o Recebimento já ocorreu na
  // Travessia): zero peça_sorteada/recebimento_gerado e zero pendências.
  assert.ok(!confirmacao.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!confirmacao.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(confirmacao.estado.tabuleiro.recebidas.length, 0);
  // A flag persiste até o avanço da vez — não é zerada na Confirmação.
  assert.equal(confirmacao.estado.atravessouNoTurno, true);
  estado = confirmacao.estado;

  const encerramento = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerramento.sucesso, true);
  if (!encerramento.sucesso) return;
  // A reta-x (última encaixada) deixou a janela de Manipulação aberta; a
  // Passagem de Vez a encerra antes do turno_iniciado e zera a flag.
  assert.deepEqual(encerramento.eventos, [
    { tipo: 'turno_encerrado', jogadorId: 'ana' },
    { tipo: 'manipulacao_finalizada', pecaId: 'reta-x' },
    { tipo: 'turno_iniciado', jogadorId: 'bruno', rodada: 2 },
  ]);
  assert.equal(encerramento.estado.jogadorAtivoId, 'bruno');
  assert.equal(encerramento.estado.atravessouNoTurno, false);
  assert.equal(encerramento.estado.posicaoConfirmada, false);
});

test('travessia do Escuro: mover para célula iluminada e confirmar em Baixa não sorteia nem marca a flag', () => {
  // reta-2 girada para 90 em (3,4): oeste conectado à inicial-1 — movimento
  // NORMAL para uma célula iluminada dentro da sequência do turno.
  let estado = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: estado.tabuleiro.posicionadas.map((peca) =>
        peca.pecaId === 'reta-2' ? { ...peca, orientacao: 90 as const } : peca,
      ),
    },
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 4), 'ana');
  assert.equal(
    estado.tabuleiro.peoes.find((peao) => peao.peaoId === 'peao-branco')?.pecaId,
    'reta-2',
  );

  // AC-3: a Confirmação direta (sem re-seleção) sucede em Baixa — e, sem
  // Travessia, consome zero peças da Caixa (0 consumo) sem marcar a flag.
  const confirmacao = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.posicaoConfirmada, true);
  assert.equal(confirmacao.estado.atravessouNoTurno, false);
  assert.ok(!confirmacao.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!confirmacao.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(confirmacao.estado.tabuleiro.recebidas.length, 0);
});

// B3/review #333: em Baixa Iluminação a Confirmação não sorteia (ADR-0005) —
// sem Recebimento não nasce sequência, e a seleção não é adotada: o estado
// segue com Seleção nula (invariante "a seleção vive durante a sequência").
test('em Baixa, a Confirmação sem Recebimento não adota a seleção (#326)', () => {
  // reta-2 girada para 90 em (3,4): oeste conectado à inicial-1 — movimento
  // NORMAL para uma célula iluminada dentro da sequência do turno.
  let estado = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: estado.tabuleiro.posicionadas.map((peca) =>
        peca.pecaId === 'reta-2' ? { ...peca, orientacao: 90 as const } : peca,
      ),
    },
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 4), 'ana');
  // A re-seleção do mover (#263) recoloca o Peão; a injeção zera a seleção
  // para espelhar como a Confirmação chegaria com Seleção nula.
  const semSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: null },
  };
  const confirmacao = aplicarComandoDePartida(
    semSelecao,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  // Confirmação em Baixa não gera Recebimento; a adoção do Peão confirmado
  // não existe — a seleção permanece nula no resultado.
  assert.equal(confirmacao.estado.tabuleiro.recebidas.length, 0);
  assert.equal(confirmacao.estado.tabuleiro.peaoSelecionadoId, null);
});

test('travessia do Escuro: guardas na ordem canônica', () => {
  // Peão de outro Jogador e ator fora da vez: a vez precede a travessia.
  assert.equal(
    codigoDaRejeicao(
      comJogadorEmBaixa(partidaEmRodada2(), 'ana'),
      atravessarOEscuro('peao-vermelho', 1, 3),
      'ana',
    ),
    'FORA_DA_VEZ',
  );
  assert.equal(
    codigoDaRejeicao(estadoDaTravessia(), atravessarOEscuro('peao-branco', 1, 3), 'fantasma'),
    'FORA_DA_VEZ',
  );

  // Sem Baixa Iluminação a travessia é vedada, mesmo com o Peão em sequência.
  {
    let semBaixa = partidaEmRodada2();
    semBaixa = aplicar(semBaixa, selecionarPeao('peao-branco'), 'ana');
    semBaixa = aplicar(semBaixa, moverPeao('peao-branco', 2, 3), 'ana');
    semBaixa = aplicar(semBaixa, selecionarPeao('peao-branco'), 'ana');
    assert.equal(
      codigoDaRejeicao(semBaixa, atravessarOEscuro('peao-branco', 1, 3), 'ana'),
      'MOVIMENTO_INDISPONIVEL',
    );
  }

  // No Primeiro Turno a jogada ainda não existe.
  assert.equal(
    codigoDaRejeicao(partidaIniciada(), atravessarOEscuro('peao-branco', 1, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );

  // Após a Confirmação de Posição (que em Baixa não sorteia) nada mais se move.
  {
    // O peão muda de Peça (ida à inicial-1, dentro da zona) antes de confirmar
    // — Confirmação sem mudança de Peça é inválida; a guarda alvo é a da
    // travessia pós-confirmação.
    let confirmado = estadoDaTravessia();
    confirmado = aplicar(confirmado, moverPeao('peao-branco', 3, 3), 'ana');
    assert.equal(confirmado.atravessouNoTurno, false);
    confirmado = aplicar(confirmado, confirmarPosicao('peao-branco'), 'ana');
    assert.equal(
      codigoDaRejeicao(confirmado, atravessarOEscuro('peao-branco', 1, 3), 'ana'),
      'POSICAO_CONFIRMADA',
    );
  }

  // Única por turno: a segunda travessia é vedada com a flag já marcada.
  {
    let jaAtravessou = estadoDaTravessia();
    jaAtravessou = aplicar(jaAtravessou, atravessarOEscuro('peao-branco', 1, 3), 'ana');
    assert.equal(jaAtravessou.atravessouNoTurno, true);
    assert.equal(
      codigoDaRejeicao(jaAtravessou, atravessarOEscuro('peao-branco', 2, 3), 'ana'),
      'MOVIMENTO_INDISPONIVEL',
    );
  }

  // AC-3 do #272: com a Seleção nula a Travessia usa o Peão do ator como
  // referência e NÃO trava — adota a Seleção na sequência. A Movimentação
  // re-seleciona o Peão movido (#334), então a Seleção nula é construída
  // sinteticamente para exercitar a guarda (sobre a origem legal da fixture).
  {
    const base = estadoDaTravessia();
    const semSelecao: EstadoDaPartida = {
      ...base,
      tabuleiro: { ...base.tabuleiro, peaoSelecionadoId: null },
    };
    const travessia = aplicarComandoDePartida(
      semSelecao,
      atravessarOEscuro('peao-branco', 1, 3),
      'ana',
    );
    assert.equal(travessia.sucesso, true);
    if (!travessia.sucesso) return;
    // A Travessia re-adota o Peão do ator: a sequência (escolher → encaixar →
    // mover) continua sem exigir re-seleção.
    assert.equal(travessia.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
    assert.equal(travessia.estado.atravessouNoTurno, true);
    // Seleção de outro Peão continua vedada.
    const estadoComOutroSelecionado: EstadoDaPartida = {
      ...base,
      tabuleiro: {
        ...base.tabuleiro,
        peaoSelecionadoId: 'peao-vermelho',
      },
    };
    assert.equal(
      codigoDaRejeicao(
        estadoComOutroSelecionado,
        atravessarOEscuro('peao-branco', 1, 3),
        'ana',
      ),
      'PEAO_NAO_SELECIONADO',
    );
  }

  // Alvos inválidos: ocupado, não conectado, fora da grade e iluminado.
  const estado = estadoDaTravessia();
  assert.equal(
    codigoDaRejeicao(estado, atravessarOEscuro('peao-branco', 3, 3), 'ana'),
    'CELULA_JA_OCUPADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, atravessarOEscuro('peao-branco', 4, 4), 'ana'),
    'MOVIMENTO_NAO_CONECTADO',
  );
  assert.equal(
    codigoDaRejeicao(estado, atravessarOEscuro('peao-branco', 7, 0), 'ana'),
    'CELULA_NAO_ENCONTRADA',
  );
  // Iluminada: sem a reta-1, o Peão volta à inicial-1 e (2,3) — vaga norte
  // dela — precisa estar iluminada por terceiro para testar o guard fresco
  // (em Baixa a própria ana só ilumina 3,3). Coloca peao-vermelho em 2,2
  // para iluminar 2,3 via cálculo fresco.
  {
    let semReta1 = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
    semReta1 = {
      ...semReta1,
      tabuleiro: {
        ...semReta1.tabuleiro,
        posicionadas: [
          ...semReta1.tabuleiro.posicionadas.filter((peca) => peca.pecaId !== 'reta-1'),
          { pecaId: 'ilum-22', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 2, coluna: 2 } },
        ],
        peoes: semReta1.tabuleiro.peoes.map((peao) =>
          peao.peaoId === 'peao-vermelho' ? { ...peao, pecaId: 'ilum-22' } : peao,
        ),
      },
    };
    semReta1 = aplicar(semReta1, selecionarPeao('peao-branco'), 'ana');
    assert.equal(
      codigoDaRejeicao(semReta1, atravessarOEscuro('peao-branco', 2, 3), 'ana'),
      'MOVIMENTO_INDISPONIVEL',
    );
  }
});

test('travessia do Escuro: Caixa vazia entrega zero peças, sem evento e sem marcar a flag', () => {
  let estado = estadoDaTravessia();
  estado = { ...estado, tabuleiro: { ...estado.tabuleiro, caixa: [] } };

  const travessia = aplicarComandoDePartida(
    estado,
    atravessarOEscuro('peao-branco', 1, 3),
    'ana',
  );
  assert.equal(travessia.sucesso, true);
  if (!travessia.sucesso) return;
  // Sem sorteio não há lote de travessia (nem o evento, nem pendências) — e a
  // flag não marca. O funil de término pode anexar partida_terminada
  // (caixa_esgotada), fora das asserções deste cenário.
  assert.ok(!travessia.eventos.some((evento) => evento.tipo === 'atravessou_o_escuro'));
  assert.ok(!travessia.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!travessia.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(travessia.estado.tabuleiro.recebidas.length, 0);
  assert.equal(travessia.estado.atravessouNoTurno, false);
});

test('travessia do Escuro: a Confirmação recusa a cadeia incompleta (cadeia obrigatória, Req 3 do #272)', () => {
  let estado = estadoDaTravessia();
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [
        { pecaId: 'reta-x', tipo: 'reta' as const, orientacao: 0 as const },
        ...estado.tabuleiro.caixa,
      ],
    },
  };
  estado = aplicar(estado, atravessarOEscuro('peao-branco', 1, 3), 'ana');
  const pendencia = estado.tabuleiro.recebidas[0];

  // Atalho que pula escolher/posicionar/mover: o confirmar direto é rejeitado
  // — sem o guard, a Confirmação em Baixa zeraria as recebidas e a peça da
  // Caixa (reta-x) seria consumida sem nunca ser posicionada. A cadeia
  // obrigatória (escolher → encaixar → mover → confirmar) é garantia do
  // servidor, não do cliente.
  assert.equal(
    codigoDaRejeicao(estado, confirmarPosicao('peao-branco'), 'ana'),
    'PENDENCIA_NAO_RESOLVIDA',
  );
  assert.equal(estado.posicaoConfirmada, false);
  assert.equal(estado.tabuleiro.recebidas.length, 1);
  assert.equal(estado.tabuleiro.recebidas[0], pendencia);

  // A pendência persiste e a cadeia segue completável: escolher → encaixar →
  // mover → confirmar.
  estado = aplicar(estado, escolherVaga('recebida-reta-x', 'norte'), 'ana');
  estado = aplicar(estado, posicionarPeca('reta-x', 1, 3), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  const validacao = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(validacao.sucesso, true);
  if (!validacao.sucesso) return;
  assert.equal(validacao.estado.posicaoConfirmada, true);
  assert.equal(validacao.estado.tabuleiro.recebidas.length, 0);
});

test('primeiro turno em Baixa: Recebimento de 1 peça e vaga obrigatoriamente escura', () => {
  let estado = comJogadorEmBaixa(partidaIniciada(), 'ana');
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const encaixe = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  // Baixa limita o Recebimento a UMA peça (reta-1 do topo), com pendência sem
  // vaga (o fluxo normal pede a escolha); a Iluminação cobre apenas a célula
  // do Peão em Baixa.
  assert.deepEqual(encaixe.estado.tabuleiro.recebidas, [
    { recebidaId: 'recebida-reta-1', pecaId: 'reta-1', tipo: 'reta', orientacao: 0, vaga: null, celulaAlvo: null },
  ]);
  assert.deepEqual(encaixe.estado.celulasIluminadas, [{ linha: 3, coluna: 3 }]);
  estado = encaixe.estado;

  // Vagas escuras (norte (2,3) e leste (3,4)): a escolha flui normalmente.
  const norte = aplicarComandoDePartida(
    estado,
    escolherVaga('recebida-reta-1', 'norte'),
    'ana',
  );
  assert.equal(norte.sucesso, true);
  const leste = aplicarComandoDePartida(
    estado,
    escolherVaga('recebida-reta-1', 'leste'),
    'ana',
  );
  assert.equal(leste.sucesso, true);

  // ST-15 / issue #264: vaga iluminada é DADOS_INVALIDOS — o estado injetado
  // simula outra iluminação cobrindo (2,3); a vaga escura segue válida.
  const estadoIluminado: EstadoDaPartida = {
    ...estado,
    celulasIluminadas: [
      ...estado.celulasIluminadas,
      { linha: 2, coluna: 3 },
    ],
  };
  assert.equal(
    codigoDaRejeicao(
      estadoIluminado,
      escolherVaga('recebida-reta-1', 'norte'),
      'ana',
    ),
    'DADOS_INVALIDOS',
  );
  const lesteIluminado = aplicarComandoDePartida(
    estadoIluminado,
    escolherVaga('recebida-reta-1', 'leste'),
    'ana',
  );
  assert.equal(lesteIluminado.sucesso, true);
  assert.equal(lesteIluminado.estado.tabuleiro.recebidas[0].vaga, 'leste');
});

test('escolher vaga em Baixa com Seleção nula valida pela Peça do ator (Req 4 #272)', () => {
  // Pendência comum do Primeiro Turno em Baixa (recebida-reta-1, vaga e
  // célula-alvo nulas) sobre a inicial-1 em (3,3); a Seleção é zerada por
  // injeção — a referência da vaga deve ser o Peão do ator (ator.peaoId).
  let estado = comJogadorEmBaixa(partidaIniciada(), 'ana');
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const encaixe = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  const semSelecao: EstadoDaPartida = {
    ...encaixe.estado,
    tabuleiro: { ...encaixe.estado.tabuleiro, peaoSelecionadoId: null },
  };
  assert.equal(semSelecao.tabuleiro.recebidas.length, 1);

  // Vaga iluminada (norte (2,3) coberta por iluminação injetada): a validação
  // da Partida NÃO é fragilizada pela Seleção nula — DADOS_INVALIDOS antes da
  // delegação, em vez de aceitar vaga iluminada.
  const comVagaIluminada: EstadoDaPartida = {
    ...semSelecao,
    celulasIluminadas: [
      ...semSelecao.celulasIluminadas,
      { linha: 2, coluna: 3 },
    ],
  };
  assert.equal(
    codigoDaRejeicao(
      comVagaIluminada,
      escolherVaga('recebida-reta-1', 'norte'),
      'ana',
    ),
    'DADOS_INVALIDOS',
  );

  // Vaga escura (leste (3,4)): a validação da Partida passa e a pré-adoção do
  // ator (B1/review #333) alimenta a delegação com o Peão do ator — o comando
  // flui sem re-seleção e a seleção nasce do próprio ator no resultado.
  const escura = aplicarComandoDePartida(
    semSelecao,
    escolherVaga('recebida-reta-1', 'leste'),
    'ana',
  );
  assert.equal(escura.sucesso, true);
  if (!escura.sucesso) return;
  assert.equal(escura.estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
});

test('travessia do Escuro: a cadeia é obrigatória — o turno não avança sem o confirmar (Req 3 #272)', () => {
  // Entre a Travessia e o encaixe, o turno já não avança: sem posição
  // confirmada o encerramento é inválido (a pendência do Recebimento também
  // bloquearia) — a Limpeza do caminho escuro não pode ser pulada.
  let estado = estadoDaTravessia();
  estado = aplicar(estado, atravessarOEscuro('peao-branco', 1, 3), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );

  // Com a pendência resolvida (escolher → encaixar → mover) e SEM confirmar,
  // o turno ainda não termina: encerrar exige posicaoConfirmada e permanecer
  // exige a Peça do início do turno (inválida após a mudança) — o único ponto
  // definitivo que fecha o caminho escuro (Iluminação + Limpeza) é o confirmar.
  const recebidaId = estado.tabuleiro.recebidas[0].recebidaId;
  const pecaRecebidaId = estado.tabuleiro.recebidas[0].pecaId;
  estado = aplicar(estado, escolherVaga(recebidaId, 'norte'), 'ana');
  estado = aplicar(estado, posicionarPeca(pecaRecebidaId, 1, 3), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  assert.equal(estado.tabuleiro.recebidas.length, 0);
  assert.equal(
    codigoDaRejeicao(estado, encerrarTurno(), 'ana'),
    'ENCERRAMENTO_INVALIDO',
  );
  // Permanência: o mover re-seleciona o Peão (semântica única, issue #334),
  // então o guarda do Tabuleiro não barra por seleção — ADR-0014 / issue #377
  // (Opção B): após a Travessia, a Permanência é vedada até o mover
  // compulsório (MOVIMENTO_INDISPONIVEL, mesmo após mover — a flag só cai na
  // Confirmação). Nenhum caminho fecha o turno sem o confirmar.
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  // Re-selecionar o próprio Peão é idempotente (sem novo Recebimento) e não
  // muda o veredito.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco'), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  // O confirmar fecha o gatilho com Limpeza (assinado pelo próprio fluxo):
  // estado pós-confirmação pronto para o encerramento.
  const confirmacao = aplicarComandoDePartida(
    estado,
    confirmarPosicao('peao-branco'),
    'ana',
  );
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.posicaoConfirmada, true);
  assert.equal(
    aplicarComandoDePartida(confirmacao.estado, encerrarTurno(), 'ana').sucesso,
    true,
  );
});

// ADR-0014 / issue #377 — mover compulsório PARA a peça colocada.
test('ADR-0014: mover pós-travessia só para a peça colocada — voltar à origem é rejeitado', () => {
  let estado = estadoDaTravessia();
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [
        { pecaId: 'reta-x', tipo: 'reta' as const, orientacao: 0 as const },
        ...estado.tabuleiro.caixa,
      ],
    },
  };
  estado = aplicar(estado, atravessarOEscuro('peao-branco', 1, 3), 'ana');
  estado = aplicar(estado, escolherVaga('recebida-reta-x', 'norte'), 'ana');
  estado = aplicar(estado, posicionarPeca('reta-x', 1, 3), 'ana');
  // O encaixe da travessia registra a peça colocada.
  assert.equal(estado.pecaDaTravessiaId ?? null, 'reta-x');
  assert.equal(estado.atravessouNoTurno, true);
  // Voltar à origem (3,3, inicial-1, conectada) é rejeitado: o movimento da
  // travessia não é desfazível.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  // Só a peça colocada aceita o mover.
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  assert.equal(
    estado.tabuleiro.peoes.find((peao) => peao.peaoId === 'peao-branco')?.pecaId,
    'reta-x',
  );
});

// ADR-0014 / issue #377 — exceção monstro: a peça sacada é Monstro (não
// aceita peão), então o mover compulsório é impossível e o turno travado
// fecha via Permanência — uma travessia por turno, mesmo com Monstro (a
// flag não cai no posicionar).
test('ADR-0014: travessia que coloca Monstro mantém o turno travado — Permanência fecha', () => {
  let estado = estadoDaTravessia();
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [
        { pecaId: 'vulto-x', tipo: 'vulto' as const, orientacao: 0 as const },
        ...estado.tabuleiro.caixa,
      ],
    },
  };
  estado = aplicar(estado, atravessarOEscuro('peao-branco', 1, 3), 'ana');
  estado = aplicar(estado, escolherVaga('recebida-vulto-x', 'norte'), 'ana');
  estado = aplicar(estado, posicionarPeca('vulto-x', 1, 3), 'ana');
  // Turno travado: flag mantida + peça-alvo registrada; o peão segue na Peça
  // em que estava ao atravessar (reta-1, não a do início do turno).
  assert.equal(estado.atravessouNoTurno, true);
  assert.equal(estado.pecaDaTravessiaId ?? null, 'vulto-x');
  assert.equal(
    estado.tabuleiro.peoes.find((peao) => peao.peaoId === 'peao-branco')?.pecaId,
    'reta-1',
  );
  // Mover para o Monstro segue rejeitado pela regra absoluta (não é o
  // compulsório — é PECA_JA_TEM_PEAO).
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 1, 3), 'ana'),
    'PECA_JA_TEM_PEAO',
  );
  // Volta à origem também é rejeitado: o movimento da travessia não é
  // desfazível (compulsório para a colocada).
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  // Segunda travessia no mesmo turno: vedada (a flag não caiu).
  assert.equal(
    codigoDaRejeicao(estado, atravessarOEscuro('peao-branco', 2, 3), 'ana'),
    'MOVIMENTO_INDISPONIVEL',
  );
  // Permanência fecha o turno travado (exceção monstro — peão fora da Peça
  // do início, permanece onde estava ao atravessar).
  const permanencia = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.equal(permanencia.estado.jogadorAtivoId, 'bruno');
  assert.equal(permanencia.estado.atravessouNoTurno, false);
});

// ADR-0014 / issue #377 — Opção B (revoga ADR-0013): sem sorteio no início do
// turno em Baixa; o saque é só sob demanda, na Travessia do Escuro.

test('ADR-0014: permanecer com seleção nula adota o peão do ator (bloqueante 1)', () => {
  let estado = partidaEmRodada2();
  // Ana em turno normal, peça do início = inicial-1 (3,3), sem pendências
  assert.equal(estado.jogadorAtivoId, 'ana');
  assert.equal(estado.pecaDoInicioDoTurnoId, 'inicial-1');
  // Simula avancarVez que limpa peaoSelecionadoId (turno_iniciado já limpa)
  const semSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: null },
  };
  const permanencia = aplicarComandoDePartida(semSelecao, permanecer('peao-branco'), 'ana');
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.equal(permanencia.estado.jogadorAtivoId, 'bruno');
  assert.ok(permanencia.eventos.some((e) => e.tipo === 'peao_permaneceu'));
  // Seleção alheia permanece rejeitada — não adota cegamente
  const comOutroSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: 'peao-vermelho' },
  };
  assert.equal(
    codigoDaRejeicao(comOutroSelecao, permanecer('peao-branco'), 'ana'),
    'PEAO_NAO_SELECIONADO',
  );
});

test('ADR-0014: avancarVez em Baixa nunca puxa no turno_iniciado (0 peças) — permanecer sem seleção sucede', () => {
  // Usa N=2 para controlar o wrap ana→bruno→ana
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  // Bloqueia vagas de ana (inicial-1 em 3,3: norte 2,3 e leste 3,4) para forçar 0
  for (const cel of [{ linha: 2, coluna: 3 }, { linha: 3, coluna: 4 }] as const) {
    if (!estado.tabuleiro.posicionadas.some((p) => p.celula.linha === cel.linha && p.celula.coluna === cel.coluna)) {
      estado = comPecaFora(estado, `bloq-${cel.linha}-${cel.coluna}`, 'reta', cel.linha, cel.coluna);
    }
  }
  estado = comJogadorEmBaixa(estado, 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, permanecer('peao-branco'), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const encerrarBruno = aplicarComandoDePartida(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(encerrarBruno.sucesso, true);
  if (!encerrarBruno.sucesso) return;
  // avancarVez para ana (Baixa, sem vaga escura) → 0 peças, sem recebimento_gerado
  assert.equal(encerrarBruno.estado.jogadorAtivoId, 'ana');
  assert.equal(encerrarBruno.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!encerrarBruno.eventos.some((e) => e.tipo === 'recebimento_gerado'));
  assert.equal(encerrarBruno.estado.tabuleiro.peaoSelecionadoId, null);
  // Agora ana com seleção nula e 0 recebidas deve permanecer com adoção
  const permanecerAna = aplicarComandoDePartida(encerrarBruno.estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanecerAna.sucesso, true);
  if (!permanecerAna.sucesso) return;
  assert.equal(permanecerAna.estado.jogadorAtivoId, 'bruno');
});

test('ADR-0014: avancarVez em Baixa com caixa vazia não puxa (0 peças)', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  // Evita derrota caixa_esgotada: posiciona objetivos atingíveis antes de esvaziar a caixa
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [],
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        { pecaId: 'gerador-1', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 2, coluna: 3 } },
        { pecaId: 'gerador-2', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 2 } },
        { pecaId: 'gerador-3', tipo: 'gerador' as const, orientacao: 0 as const, celula: { linha: 4, coluna: 3 } },
        { pecaId: 'sala-1', tipo: 'sala_do_diretor' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 4 } },
        { pecaId: 'portao-1', tipo: 'portao_de_saida' as const, orientacao: 0 as const, celula: { linha: 0, coluna: 1 } },
      ],
    },
  };
  estado = comJogadorEmBaixa(estado, 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, permanecer('peao-branco'), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const retorno = aplicarComandoDePartida(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(retorno.sucesso, true);
  if (!retorno.sucesso) return;
  assert.equal(retorno.estado.jogadorAtivoId, 'ana');
  assert.equal(retorno.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!retorno.eventos.some((e) => e.tipo === 'peca_sorteada'));
});

test('ADR-0014 / issue #377: avancarVez em Baixa COM vaga escura e caixa cheia não puxa (0 peças)', () => {
  // Regressão do bug: o código antigo (ADR-0013) sacava 1 peça no
  // turno_iniciado quando havia vaga escura — travando o movimento do peão.
  // O fluxo canônico agora é a Travessia do Escuro sob demanda (Opção B).
  // Cena controlada: ana em Baixa com o peão sobre uma cruz livre em (5,5)
  // (vagas escuras garantidas), caixa cheia, turno de ana em curso.
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  assert.equal(estado.jogadorAtivoId, 'ana');
  estado = comPecaFora(estado, 'livre-1', 'cruz', 5, 5);
  const pecaLivre = estado.tabuleiro.posicionadas.find((p) => p.pecaId === 'livre-1');
  assert.ok(pecaLivre);
  const vagasLivres = vagasDisponiveis(estado.tabuleiro, pecaLivre);
  assert.ok(vagasLivres.length >= 1);
  for (const [i, vaga] of vagasLivres.slice(1).entries()) {
    estado = comPecaFora(estado, `bloq-377-${i}`, 'reta', vaga.celula.linha, vaga.celula.coluna);
  }
  estado = {
    ...estado,
    celulasIluminadas: [],
    pecaDoInicioDoTurnoId: 'livre-1',
    tabuleiro: {
      ...estado.tabuleiro,
      peoes: estado.tabuleiro.peoes.map((p) =>
        p.peaoId === 'peao-branco' ? { ...p, pecaId: 'livre-1' } : p,
      ),
    },
  };
  const caixaAntes = [...estado.tabuleiro.caixa];
  assert.ok(caixaAntes.length > 0);
  estado = comJogadorEmBaixa(estado, 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, permanecer('peao-branco'), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const turnoBruno = aplicarComandoDePartida(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(turnoBruno.sucesso, true);
  if (!turnoBruno.sucesso) return;
  // avancarVez para ana (Baixa, COM vaga escura e caixa cheia) → 0 peças, sem
  // recebimento_gerado, Caixa intacta e seleção nula.
  assert.equal(turnoBruno.estado.jogadorAtivoId, 'ana');
  assert.equal(turnoBruno.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!turnoBruno.eventos.some((e) => e.tipo === 'peca_sorteada'));
  assert.ok(!turnoBruno.eventos.some((e) => e.tipo === 'recebimento_gerado'));
  assert.deepEqual(turnoBruno.estado.tabuleiro.caixa, caixaAntes);
  assert.equal(turnoBruno.estado.tabuleiro.peaoSelecionadoId, null);
  // E ana, sem saque no início, pode permanecer (Opção C) — o turno não trava.
  const permanecerAna = aplicarComandoDePartida(turnoBruno.estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanecerAna.sucesso, true);
});

test('ADR-0014: confirmar_posicao em Baixa mantém recebidas [] (sem sorteio no confirmar)', () => {
  let estado = comJogadorEmBaixa(partidaEmRodada2(), 'ana');
  // Move para peça vizinha conectada e confirma — em Baixa o confirmar não sorteia
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // reta-2 em 3,4 girada para conectar oeste com inicial-1, permite mover
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: estado.tabuleiro.posicionadas.map((p) =>
        p.pecaId === 'reta-2' ? { ...p, orientacao: 90 as const } : p,
      ),
    },
  };
  estado = aplicar(estado, moverPeao('peao-branco', 3, 4), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'peca_sorteada'));
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'recebimento_gerado'));
});

test('ADR-0014: travessia usa iluminação fresca (unificada com posicionarPeao)', () => {
  let estado = estadoDaTravessia();
  // Injeta iluminação stale divergente: adiciona célula iluminada que cobre a vaga norte (1,3)
  // Se a travessia usasse stale, consideraria (1,3) iluminada e falharia; com fresca deve suceder
  // pois (1,3) é escura na iluminação fresca (peões em 3,3 etc).
  const stale: EstadoDaPartida = {
    ...estado,
    celulasIluminadas: [...estado.celulasIluminadas, { linha: 1, coluna: 3 }],
  };
  const travessia = aplicarComandoDePartida(stale, atravessarOEscuro('peao-branco', 1, 3), 'ana');
  assert.equal(travessia.sucesso, true);
  if (!travessia.sucesso) return;
  assert.equal(travessia.estado.tabuleiro.recebidas.length, 1);
});

// Issue #343 — Baixa nova no mesmo gatilho descarta o sorteio: 0 no turno e
// 0 no avancarVez seguinte (ADR-0014 — sem puxar-1; só a Travessia saca, sob
// demanda). Sem o descarte, a pendencia comum fica irresoluvel e o turno
// trava com PENDENCIA_NAO_RESOLVIDA. Aqui o Primeiro Turno prova 0 + encerrar.

function comPosicionada(
  estado: EstadoDaPartida,
  pecaId: string,
  tipo: 'cruz' | 'inicial' | 'vulto',
  orientacao: Orientacao,
  linha: number,
  coluna: number,
): EstadoDaPartida {
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        { pecaId, tipo, orientacao, celula: { linha, coluna } },
      ],
    },
  };
}

function comPeaoSobre(
  estado: EstadoDaPartida,
  peaoId: string,
  pecaId: string,
): EstadoDaPartida {
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      peoes: estado.tabuleiro.peoes.map((peao) =>
        peao.peaoId === peaoId ? { ...peao, pecaId } : peao,
      ),
    },
  };
}

function ataqueDoLoteDaPartida(eventos: readonly EventoDaPartida[]) {
  const ataque = eventos.find((evento) => evento.tipo === 'ataque_resolvido');
  assert.ok(ataque && ataque.tipo === 'ataque_resolvido');
  if (!ataque || ataque.tipo !== 'ataque_resolvido') {
    throw new Error('esperava ataque_resolvido no lote');
  }
  return ataque;
}

test('issue #343: Primeiro Turno com Baixa nova e todas as vagas iluminadas descarta a 0 e libera o turno', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno', 'carla']);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Vulto ao norte da Inicial (ocupa a vaga norte): o posicionamento do Peao
  // entra no Alcance (conexao norte) e impoe Baixa nova. As pontes iluminam as
  // vagas finais: bruno em (3,5) ilumina o leste (3,4); carla em (1,3) — peca
  // com o sul fechado, fora do raio do Vulto — ilumina o norte (2,3).
  estado = comPosicionada(estado, 'vulto-x', 'vulto', 0, 2, 3);
  estado = comPosicionada(estado, 'ponte-b', 'cruz', 0, 3, 5);
  estado = comPosicionada(estado, 'ponte-c', 'inicial', 0, 1, 3);
  estado = comPeaoSobre(estado, 'peao-vermelho', 'ponte-b');
  estado = comPeaoSobre(estado, 'peao-azul', 'ponte-c');
  const caixaAntes = estado.tabuleiro.caixa.length;

  const gatilho = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLoteDaPartida(gatilho.eventos);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  const ana = gatilho.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.emBaixaIluminacao, true);
  // Descarte total: 0 pendencias, sem sorteio no lote e Caixa intacta.
  assert.equal(gatilho.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!gatilho.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!gatilho.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(gatilho.estado.tabuleiro.caixa.length, caixaAntes);
  // O turno avanca: encerrar_turno aprova sem PENDENCIA_NAO_RESOLVIDA.
  const encerrado = aplicarComandoDePartida(gatilho.estado, encerrarTurno(), 'ana');
  assert.equal(encerrado.sucesso, true);
  if (!encerrado.sucesso) return;
  assert.equal(encerrado.estado.jogadorAtivoId, 'bruno');
});

test('issue #343: Primeiro Turno com Baixa nova e vaga escura descarta a 0 (sem manter 1)', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Mesmo ataque do caso anterior, mas so o leste (3,4) e iluminado (bruno em
  // (3,5)); o norte (2,3) reabre escuro com a remocao do Vulto na segunda
  // Limpeza — mesmo assim o gatilho descarta tudo (0), sem manter 1.
  estado = comPosicionada(estado, 'vulto-x', 'vulto', 0, 2, 3);
  estado = comPosicionada(estado, 'ponte-b', 'cruz', 0, 3, 5);
  estado = comPeaoSobre(estado, 'peao-vermelho', 'ponte-b');
  const caixaAntes = estado.tabuleiro.caixa.length;

  const gatilho = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLoteDaPartida(gatilho.eventos);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  const ana = gatilho.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.emBaixaIluminacao, true);
  // Descarte total mesmo com vaga escura: 0 pendencias, sem sorteio, Caixa intacta.
  assert.equal(gatilho.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!gatilho.eventos.some((evento) => evento.tipo === 'peca_sorteada'));
  assert.ok(!gatilho.eventos.some((evento) => evento.tipo === 'recebimento_gerado'));
  assert.equal(gatilho.estado.tabuleiro.caixa.length, caixaAntes);
  const encerrado = aplicarComandoDePartida(gatilho.estado, encerrarTurno(), 'ana');
  assert.equal(encerrado.sucesso, true);
  if (!encerrado.sucesso) return;
  assert.equal(encerrado.estado.jogadorAtivoId, 'bruno');
});

test('review PR #370 (Bug 1): confirmar que impõe Baixa nova não sorteia (0 no turno, 0 no avancarVez — ADR-0014)', () => {
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  // Destino com vagas livres (cruz em 3,4) para que o sorteio pré-ataque
  // geraria recebidas; o Vulto em 3,5 ataca o destino pelo raio oeste.
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas.map((p) =>
          p.pecaId === 'reta-2' ? { ...p, tipo: 'cruz' as const } : p,
        ),
        { pecaId: 'vulto-x', tipo: 'vulto' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 5 } },
      ],
    },
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 4), 'ana');
  const caixaAntes = [...estado.tabuleiro.caixa];
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.equal(confirmacao.estado.jogadores.find((j) => j.jogadorId === 'ana')?.emBaixaIluminacao, true);
  assert.ok(confirmacao.eventos.some((e) => e.tipo === 'ataque_resolvido'));
  assert.equal(confirmacao.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'peca_sorteada'));
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'recebimento_gerado'));
  assert.deepEqual(confirmacao.estado.tabuleiro.caixa, caixaAntes);
  // 0 também no próximo avancarVez (ADR-0014 / issue #377: sem puxar-1 no
  // turno_iniciado — o saque em Baixa é só sob demanda, na Travessia do
  // Escuro): encerra o turno de ana, bruno permanece (o permanecer já avança
  // a vez) e ana reabre em Baixa SEM recebida na Bandeja, com a Caixa intacta.
  estado = aplicar(confirmacao.estado, encerrarTurno(), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const turnoBruno = aplicarComandoDePartida(estado, permanecer('peao-vermelho'), 'bruno');
  assert.equal(turnoBruno.sucesso, true);
  if (!turnoBruno.sucesso) return;
  assert.equal(turnoBruno.estado.jogadorAtivoId, 'ana');
  assert.equal(turnoBruno.estado.tabuleiro.recebidas.length, 0);
  assert.ok(!turnoBruno.eventos.some((e) => e.tipo === 'peca_sorteada'));
  assert.ok(!turnoBruno.eventos.some((e) => e.tipo === 'recebimento_gerado'));
  assert.deepEqual(turnoBruno.estado.tabuleiro.caixa, caixaAntes);
});

test('review PR #370 (Bug 2): fluxo Baixa completo — colocar, OK, selecionar, mover, confirmar e encerrar', () => {
  // O "puxar" é gesto local do cliente (sem comando wire — coberto no
  // frontend); aqui a cadeia começa na recebida com a forma da travessia
  // (ADR-0014: o saque em Baixa nasce no ATRAVESSAR_O_ESCURO, não mais no
  // avancarVez), injetada com peça determinística (cruz conecta sempre,
  // 0 giros).
  let estado = partidaIniciadaCom(['ana', 'bruno']);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  const [, ...restoCaixa] = estado.tabuleiro.caixa;
  const cruzX = { pecaId: 'cruz-x', tipo: 'cruz' as const, orientacao: 0 as const };
  estado = {
    ...estado,
    jogadores: estado.jogadores.map((j) =>
      j.jogadorId === 'ana' ? { ...j, emBaixaIluminacao: true } : j,
    ),
    // Peão terminou o turno anterior sobre reta-2: origem do turno = reta-2.
    pecaDoInicioDoTurnoId: 'reta-2',
    tabuleiro: {
      ...estado.tabuleiro,
      peoes: estado.tabuleiro.peoes.map((p) =>
        p.peaoId === 'peao-branco' ? { ...p, pecaId: 'reta-2' } : p,
      ),
      caixa: [cruzX, ...restoCaixa],
      recebidas: [
        { recebidaId: 'recebida-cruz-x', pecaId: 'cruz-x', tipo: 'cruz' as const, orientacao: 0 as const, vaga: null, celulaAlvo: null },
      ],
    },
  };
  // Colocar: escolher a vaga (a pré-adoção supre a seleção nula, #326) e OK
  // (posicionar_peca — a recusa desconectada vive em peoes.test.ts).
  estado = aplicar(estado, escolherVaga('recebida-cruz-x', 'leste'), 'ana');
  const pendente = estado.tabuleiro.recebidas.find(
    (r) => r.recebidaId === 'recebida-cruz-x',
  );
  assert.deepEqual(pendente?.celulaAlvo, { linha: 3, coluna: 5 });
  estado = aplicar(estado, posicionarPeca('cruz-x', 3, 5), 'ana');
  assert.equal(estado.tabuleiro.recebidas.length, 0);
  // Peão selecionável após o OK (núcleo do Bug 2): sem pendências, a seleção
  // volta a emitir.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  // Mover, confirmar sem sortear (emBaixa mantido) e encerrar.
  estado = aplicar(estado, moverPeao('peao-branco', 3, 5), 'ana');
  const confirmacao = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmacao.sucesso, true);
  if (!confirmacao.sucesso) return;
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'peca_sorteada'));
  assert.ok(!confirmacao.eventos.some((e) => e.tipo === 'recebimento_gerado'));
  assert.equal(confirmacao.estado.jogadores.find((j) => j.jogadorId === 'ana')?.emBaixaIluminacao, true);
  estado = aplicar(confirmacao.estado, encerrarTurno(), 'ana');
  assert.equal(estado.jogadorAtivoId, 'bruno');
});
