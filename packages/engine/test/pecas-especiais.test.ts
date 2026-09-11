import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  COMPOSICAO_DA_CAIXA,
  aplicarComandoDePartida,
  aplicarComandoDeTabuleiro,
  bordasAbertas,
  ehPecaEspecial,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  vagasDisponiveis,
  vizinhasConectadas,
  type BordaCardinal,
  type CodigoDeErroDeTabuleiro,
  type ComandoDePartida,
  type ComandoDeTabuleiro,
  type EstadoDaPartida,
  type EstadoDoTabuleiro,
  type Orientacao,
  type TipoDaPeca,
  type TipoDePecaEspecial,
} from '../src/index.ts';

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

const selecionar = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const posicionar = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } } as const);

const escolherVaga = (recebidaId: string, borda: BordaCardinal) =>
  ({ tipo: 'escolher_vaga_da_peca_recebida', recebidaId, borda } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const girar = (pecaId: string, sentido: 'horario' | 'anti_horario' = 'horario') =>
  ({ tipo: 'girar_peca', pecaId, sentido } as const);

const encerrarTurno = () => ({ tipo: 'encerrar_turno' } as const);

function aplicarTabuleiro(
  estado: EstadoDoTabuleiro,
  comando: ComandoDeTabuleiro,
): EstadoDoTabuleiro {
  const resultado = aplicarComandoDeTabuleiro(estado, comando);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
}

function codigoDaRejeicaoTabuleiro(
  estado: EstadoDoTabuleiro,
  comando: ComandoDeTabuleiro,
): CodigoDeErroDeTabuleiro {
  const resultado = aplicarComandoDeTabuleiro(estado, comando);
  assert.equal(resultado.sucesso, false, 'esperava uma rejeição de domínio');
  if (resultado.sucesso) {
    throw new Error('inacessível');
  }
  return resultado.erro.codigo;
}

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

function partidaIniciada(): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(JOGADORES);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

// Peão branco selecionado sobre a Peça Inicial em (3,3), com a pendência da
// peça especial indicada (vaga ainda nula) e a Caixa sem ela — mesmo padrão de
// monstros.test.ts: desde a ST-11 a seleção não gera Recebimento.
function estadoComEspecialPendente(
  tipo: TipoDePecaEspecial,
  pecaId: string,
): EstadoDoTabuleiro {
  let estado = aplicarTabuleiro(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicarTabuleiro(estado, posicionar('inicial-1', 3, 3));
  estado = aplicarTabuleiro(estado, selecionarPeao('peao-branco'));
  estado = aplicarTabuleiro(estado, posicionarPeao('peao-branco', 3, 3));
  return {
    ...estado,
    peaoSelecionadoId: 'peao-branco',
    caixa: estado.caixa.filter((peca) => peca.pecaId !== pecaId),
    recebidas: [
      {
        recebidaId: `recebida-${pecaId}`,
        pecaId,
        tipo,
        orientacao: 0,
        vaga: null,
        celulaAlvo: null,
      },
    ],
  };
}

// Partida com a Caixa reordenada: a peça especial indicada vai para a frente
// do sorteio, para que o Recebimento a retire primeiro — padrão de
// comVultoPrimeiroNaCaixa de monstros.test.ts.
function comEspecialPrimeiroNaCaixa(
  estado: EstadoDaPartida,
  pecaId: string,
): EstadoDaPartida {
  const caixa = estado.tabuleiro.caixa;
  const alvo = caixa.find((peca) => peca.pecaId === pecaId);
  if (!alvo) {
    throw new Error(`${pecaId} deveria estar na Caixa`);
  }
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [alvo, ...caixa.filter((peca) => peca.pecaId !== pecaId)],
    },
  };
}

// Resolve todas as pendências do Recebimento: escolhe a vaga de cada peça
// sorteada (primeira borda canônica ainda disponível), gira a Recebida até a
// borda voltada à Peça sob o Peão abrir (encaixe conectado, issue #311 — as
// Especiais têm as 4 bordas abertas e nunca giram) e encaixa na célula-alvo.
function resolverRecebidas(estado: EstadoDaPartida, ator: string): EstadoDaPartida {
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
      throw new Error(`nenhuma vaga disponível para a pendência ${pendente.recebidaId}`);
    }
    estado = resolvida;
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === pendente.recebidaId,
    );
    if (!escolhida || escolhida.celulaAlvo === null || escolhida.vaga === null) {
      throw new Error('Recebida escolhida deveria ter vaga com célula-alvo');
    }
    // Gira (horário) até a borda voltada à Peça sob o Peão — o oposto da
    // vaga — abrir; sem conexão o encaixe é rejeitado (issue #311).
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
      estado = aplicar(estado, girar(escolhida.pecaId), ator);
    }
    estado = aplicar(
      estado,
      posicionar(escolhida.pecaId, escolhida.celulaAlvo.linha, escolhida.celulaAlvo.coluna),
      ator,
    );
  }
  return estado;
}

function concluirPrimeiroTurno(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = estado.jogadores.find((item) => item.jogadorId === ator);
  if (!jogador) throw new Error('sem jogador ativo');
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionar(pecaId), ator);
  estado = aplicar(estado, posicionar(pecaId, celula.linha, celula.coluna), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(estado, posicionarPeao(jogador.peaoId, celula.linha, celula.coluna), ator);
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, encerrarTurno(), ator);
}

// Peões em (3,3), (0,0), (6,6) e (1,0): diogo foge de (6,0) porque a vaga
// norte de bruno envolve para lá na grade toroidal (issue #260) — ver o
// mesmo fixture em monstros.test.ts.
function partidaEmRodada2(): EstadoDaPartida {
  let estado = partidaIniciada();
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });
  return estado;
}

// ---------------------------------------------------------------------------
// Caixa: 17 especiais com ids/tipos corretos
// ---------------------------------------------------------------------------

test('a caixa contém 17 peças especiais com ids e tipos corretos (6 gerador, 3 sala_do_diretor, 4 sala_medica, 4 portao_de_saida)', () => {
  const estado = estadoInicialDoTabuleiro();
  const especiais = estado.caixa.filter((peca) => ehPecaEspecial(peca.tipo as TipoDaPeca));
  assert.equal(especiais.length, 17);

  const porTipo: Record<string, number> = {};
  for (const peca of especiais) {
    porTipo[peca.tipo] = (porTipo[peca.tipo] ?? 0) + 1;
  }
  assert.deepEqual(porTipo, {
    gerador: 6,
    sala_do_diretor: 3,
    sala_medica: 4,
    portao_de_saida: 4,
  });

  const ids = new Set(estado.caixa.map((peca) => peca.pecaId));
  for (let i = 1; i <= 6; i++) assert.ok(ids.has(`gerador-${i}`));
  for (let i = 1; i <= 3; i++) assert.ok(ids.has(`sala-do-diretor-${i}`));
  for (let i = 1; i <= 4; i++) assert.ok(ids.has(`sala-medica-${i}`));
  for (let i = 1; i <= 4; i++) assert.ok(ids.has(`portao-de-saida-${i}`));

  // Composição total permanece 89 (inclui caminho + monstros).
  assert.equal(estado.caixa.length, 89);
  assert.deepEqual(
    COMPOSICAO_DA_CAIXA.find((e) => e.tipo === 'gerador')?.quantidade,
    6,
  );
  assert.deepEqual(
    COMPOSICAO_DA_CAIXA.find((e) => e.tipo === 'sala_do_diretor')?.quantidade,
    3,
  );
});

// ---------------------------------------------------------------------------
// bordasAbertas: 4 bordas para cada especial em 4 orientações
// ---------------------------------------------------------------------------

test('peças especiais têm as quatro bordas abertas em qualquer orientação', () => {
  const tipos: readonly TipoDePecaEspecial[] = [
    'gerador',
    'sala_do_diretor',
    'sala_medica',
    'portao_de_saida',
  ];
  for (const tipo of tipos) {
    for (const orientacao of [0, 90, 180, 270] as const) {
      assert.deepEqual(
        bordasAbertas({ tipo, orientacao }),
        ['norte', 'leste', 'sul', 'oeste'],
        `${tipo} em ${orientacao} deve ter as quatro bordas abertas`,
      );
    }
    assert.equal(ehPecaEspecial(tipo), true);
  }
  // Contrapartida: tipos não-especiais
  assert.equal(ehPecaEspecial('reta'), false);
  assert.equal(ehPecaEspecial('cruz'), false);
  assert.equal(ehPecaEspecial('vulto'), false);
  assert.equal(ehPecaEspecial('inicial'), false);
});

// ---------------------------------------------------------------------------
// Ciclo gerarRecebidas -> escolher_vaga -> posicionar_peca para cada especial
// ---------------------------------------------------------------------------

for (const [tipo, pecaId] of [
  ['gerador', 'gerador-1'],
  ['sala_do_diretor', 'sala-do-diretor-1'],
  ['sala_medica', 'sala-medica-1'],
  ['portao_de_saida', 'portao-de-saida-1'],
] as const) {
  test(`ciclo completo via domínio puro para ${tipo} (${pecaId}): gerarRecebidas -> escolher_vaga -> posicionar na célula-alvo`, () => {
    let estado = estadoComEspecialPendente(tipo, pecaId);

    const escolha = aplicarComandoDeTabuleiro(
      estado,
      escolherVaga(`recebida-${pecaId}`, 'norte'),
    );
    assert.equal(escolha.sucesso, true);
    if (!escolha.sucesso) return;
    assert.equal(escolha.estado.recebidas[0].vaga, 'norte');
    assert.deepEqual(escolha.estado.recebidas[0].celulaAlvo, { linha: 2, coluna: 3 });
    assert.equal(escolha.estado.pecaSelecionadaId, pecaId);
    estado = escolha.estado;

    const encaixe = aplicarComandoDeTabuleiro(estado, posicionar(pecaId, 2, 3));
    assert.equal(encaixe.sucesso, true);
    if (!encaixe.sucesso) return;
    assert.deepEqual(encaixe.eventos, [
      {
        tipo: 'peca_posicionada',
        pecaId,
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      },
    ]);
    assert.ok(encaixe.estado.posicionadas.some((p) => p.pecaId === pecaId));
    assert.equal(encaixe.estado.recebidas.length, 0);
    assert.equal(encaixe.estado.pecaSelecionadaId, null);
  });
}

test('peça especial recebida pode ser girada antes do encaixe e a orientação é preservada no peca_posicionada', () => {
  for (const [tipo, pecaId] of [
    ['gerador', 'gerador-1'],
    ['sala_do_diretor', 'sala-do-diretor-1'],
    ['sala_medica', 'sala-medica-1'],
    ['portao_de_saida', 'portao-de-saida-1'],
  ] as const) {
    let estado = estadoComEspecialPendente(tipo, pecaId);
    estado = aplicarTabuleiro(estado, escolherVaga(`recebida-${pecaId}`, 'norte'));
    // Giro horário: 0 -> 90 (recebida segue padrão da seleção única, sem janela)
    const giro = aplicarComandoDeTabuleiro(estado, girar(pecaId, 'horario'));
    assert.equal(giro.sucesso, true);
    if (!giro.sucesso) continue;
    assert.equal(giro.eventos[0].tipo, 'peca_girada');
    if (giro.eventos[0].tipo !== 'peca_girada') continue;
    assert.equal(giro.eventos[0].orientacao, 90);
    assert.equal(giro.estado.recebidas[0].orientacao, 90);
    estado = giro.estado;
    // Anti-horário volta a 0
    const giroVolta = aplicarComandoDeTabuleiro(estado, girar(pecaId, 'anti_horario'));
    assert.equal(giroVolta.sucesso, true);
    if (!giroVolta.sucesso) continue;
    assert.equal(giroVolta.estado.recebidas[0].orientacao, 0);
    estado = giroVolta.estado;
    // Gira novamente e encaixa: evento reflete orientação girada
    estado = aplicarTabuleiro(estado, girar(pecaId, 'horario'));
    const encaixe = aplicarComandoDeTabuleiro(estado, posicionar(pecaId, 2, 3));
    assert.equal(encaixe.sucesso, true);
    if (!encaixe.sucesso) continue;
    assert.equal(encaixe.eventos[0].tipo, 'peca_posicionada');
    if (encaixe.eventos[0].tipo !== 'peca_posicionada') continue;
    assert.equal(encaixe.eventos[0].orientacao, 90);
    assert.equal(encaixe.estado.posicionadas.find((p) => p.pecaId === pecaId)?.orientacao, 90);
    assert.equal(encaixe.estado.pecaEmManipulacaoId, null);
  }
});

test('fluxo via partida: sorteio da sala_do_diretor e posicionamento na célula-alvo', () => {
  const inicio = estadoInicialDaPartida(JOGADORES);
  assert.equal(inicio.sucesso, true);
  if (!inicio.sucesso) return;
  let estado = comEspecialPrimeiroNaCaixa(inicio.estado, 'sala-do-diretor-1');
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const encaixeDoPeao = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(encaixeDoPeao.sucesso, true);
  if (!encaixeDoPeao.sucesso) return;
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas[0].tipo, 'sala_do_diretor');
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas[0].pecaId, 'sala-do-diretor-1');
  const sorteada = encaixeDoPeao.eventos.find(
    (e) => e.tipo === 'peca_sorteada' && e.pecaId === 'sala-do-diretor-1',
  );
  assert.ok(sorteada, 'esperava peca_sorteada da sala_do_diretor-1');
  estado = encaixeDoPeao.estado;

  const escolha = aplicarComandoDePartida(estado, escolherVaga('recebida-sala-do-diretor-1', 'norte'), 'ana');
  assert.equal(escolha.sucesso, true);
  if (!escolha.sucesso) return;
  estado = escolha.estado;

  const encaixe = aplicarComandoDePartida(estado, posicionar('sala-do-diretor-1', 2, 3), 'ana');
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  assert.deepEqual(encaixe.eventos, [
    { tipo: 'peca_posicionada', pecaId: 'sala-do-diretor-1', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
  ]);
});

// ---------------------------------------------------------------------------
// Sem janela de manipulação para especiais
// ---------------------------------------------------------------------------

for (const [tipo, pecaId] of [
  ['gerador', 'gerador-1'],
  ['sala_do_diretor', 'sala-do-diretor-1'],
  ['sala_medica', 'sala-medica-1'],
  ['portao_de_saida', 'portao-de-saida-1'],
] as const) {
  test(`especial ${tipo} (${pecaId}) não abre janela de manipulação e girar rejeita MANIPULACAO_ENCERRADA`, () => {
    let estado = estadoComEspecialPendente(tipo, pecaId);
    estado = aplicarTabuleiro(estado, escolherVaga(`recebida-${pecaId}`, 'norte'));
    const encaixe = aplicarComandoDeTabuleiro(estado, posicionar(pecaId, 2, 3));
    assert.equal(encaixe.sucesso, true);
    if (!encaixe.sucesso) return;
    assert.equal(encaixe.estado.pecaEmManipulacaoId, null);
    assert.equal(codigoDaRejeicaoTabuleiro(encaixe.estado, girar(pecaId)), 'MANIPULACAO_ENCERRADA');
  });
}

test('selecionar_peca de especial já posicionada rejeita PECA_JA_POSICIONADA', () => {
  let estado = estadoComEspecialPendente('gerador', 'gerador-1');
  estado = aplicarTabuleiro(estado, escolherVaga('recebida-gerador-1', 'norte'));
  estado = aplicarTabuleiro(estado, posicionar('gerador-1', 2, 3));
  assert.equal(codigoDaRejeicaoTabuleiro(estado, selecionar('gerador-1')), 'PECA_JA_POSICIONADA');
  assert.equal(codigoDaRejeicaoTabuleiro(estado, selecionar('sala-do-diretor-1')), 'PECA_NAO_ENCONTRADA');
});

test('tentar posicionar_peca com id ainda em caixa rejeita PECA_NAO_RECEBIDA', () => {
  const estado = estadoInicialDoTabuleiro();
  // Gerador ainda na Caixa, sem recebida: vedado.
  assert.equal(codigoDaRejeicaoTabuleiro(estado, posicionar('gerador-1', 3, 3)), 'PECA_NAO_RECEBIDA');
  assert.equal(codigoDaRejeicaoTabuleiro(estado, posicionar('sala-do-diretor-1', 3, 3)), 'PECA_NAO_RECEBIDA');
  assert.equal(codigoDaRejeicaoTabuleiro(estado, posicionar('sala-medica-1', 3, 3)), 'PECA_NAO_RECEBIDA');
  assert.equal(codigoDaRejeicaoTabuleiro(estado, posicionar('portao-de-saida-1', 3, 3)), 'PECA_NAO_RECEBIDA');
  // Mesmo com inicial selecionada, a vedação persiste.
  let comSelecao = aplicarTabuleiro(estado, selecionar('inicial-1'));
  assert.equal(codigoDaRejeicaoTabuleiro(comSelecao, posicionar('gerador-1', 3, 3)), 'PECA_NAO_RECEBIDA');
});

// ---------------------------------------------------------------------------
// Ocupação: portão 4 vs gerador/sala_* 1; vagasDisponiveis
// ---------------------------------------------------------------------------

test('portao_de_saida aceita 2º/3º/4º peão; 5º é rejeitado com PECA_JA_TEM_PEAO', () => {
  // Portão em (3,2) com cruz-1 (3,3) a leste e reta-1 (2,2) a norte, todos
  // conectados. Azul já no Portão (1º), branco e amarelo na cruz-1, vermelho na reta-1.
  let estado = partidaEmRodada2();
  // Substitui posicionadas para cenário controlado.
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        { pecaId: 'cruz-1', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        { pecaId: 'portao-1', tipo: 'portao_de_saida', orientacao: 0, celula: { linha: 3, coluna: 2 } },
        { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 2, coluna: 2 } },
      ],
      peoes: estado.tabuleiro.peoes.map((peao) => {
        if (peao.cor === 'branco') return { ...peao, pecaId: 'cruz-1' };
        if (peao.cor === 'vermelho') return { ...peao, pecaId: 'reta-1' };
        if (peao.cor === 'azul') return { ...peao, pecaId: 'portao-1' };
        if (peao.cor === 'amarelo') return { ...peao, pecaId: 'cruz-1' };
        return peao;
      }),
      peaoSelecionadoId: null,
      recebidas: [],
      pecaEmManipulacaoId: null,
      pecaSelecionadaId: null,
    },
    jogadorAtivoId: 'ana',
    pecaDoInicioDoTurnoId: 'cruz-1',
    posicaoConfirmada: false,
  };

  // 2º Peão (branco da cruz-1) entra no Portão (1 ocupante) -> sucesso.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 2), 'ana');

  // 3º Peão (amarelo da cruz-1) entra no Portão (2 ocupantes) -> sucesso.
  let vezDeDiogo = { ...estado, jogadorAtivoId: 'diogo' };
  vezDeDiogo = aplicar(vezDeDiogo, selecionarPeao('peao-amarelo'), 'diogo');
  estado = aplicar(vezDeDiogo, moverPeao('peao-amarelo', 3, 2), 'diogo');

  // 4º Peão (vermelho da reta-1) entra no Portão (3 ocupantes) -> sucesso.
  let vezDeBruno = { ...estado, jogadorAtivoId: 'bruno' };
  vezDeBruno = aplicar(vezDeBruno, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(vezDeBruno, moverPeao('peao-vermelho', 3, 2), 'bruno');
  assert.ok(estado.tabuleiro.peoes.every((peao) => peao.pecaId === 'portao-1' || peao.pecaId === 'cruz-1'));
  // Agora 4 no portão (azul, branco, amarelo, vermelho) - todos no mesmo portao-1.
  const ocupantesPortao = estado.tabuleiro.peoes.filter((peao) => peao.pecaId === 'portao-1').length;
  assert.equal(ocupantesPortao, 4);

  // Defesa sintética: portão já com 4 ocupantes reais (azul/branco/amarelo/vermelho).
  // O 5º peão é artificial (peao-extra) só para provar que o teto 4 é rígido no
  // domínio puro — em partida real só existem 4 peões, então este cenário nunca
  // ocorre, mas o domínio deve rejeitar mesmo assim.
  const tabuleiroCheio: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      { pecaId: 'portao-1', tipo: 'portao_de_saida', orientacao: 0, celula: { linha: 3, coluna: 2 } },
      { pecaId: 'cruz-1', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 3 } },
    ],
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'portao-1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'portao-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'portao-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'portao-1' },
      { peaoId: 'peao-extra', cor: 'branco', pecaId: 'cruz-1' },
    ],
    peaoSelecionadoId: 'peao-extra',
    recebidas: [],
    pecaEmManipulacaoId: null,
    pecaSelecionadaId: null,
    caixa: [],
    iniciais: [],
  };
  assert.equal(codigoDaRejeicaoTabuleiro(tabuleiroCheio, moverPeao('peao-extra', 3, 2)), 'PECA_JA_TEM_PEAO');
});

test('gerador, sala_do_diretor e sala_medica rejeitam 2º peão com PECA_JA_TEM_PEAO', () => {
  for (const [tipo, pecaId] of [
    ['gerador', 'gerador-1'],
    ['sala_do_diretor', 'sala-1'],
    ['sala_medica', 'sala-2'],
  ] as const) {
    const tabuleiro: EstadoDoTabuleiro = {
      ...estadoInicialDoTabuleiro(),
      posicionadas: [
        { pecaId, tipo: tipo as TipoDaPeca, orientacao: 0, celula: { linha: 3, coluna: 3 } },
        { pecaId: 'cruz-1', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 4 } },
      ],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'cruz-1' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
      ],
      peaoSelecionadoId: 'peao-vermelho',
      recebidas: [],
      pecaEmManipulacaoId: null,
      pecaSelecionadaId: null,
      caixa: [],
      iniciais: [],
    };
    // Cruz-1 conecta ao especial pela borda oeste (cruz tem todas abertas, especial tem todas).
    assert.ok(vizinhasConectadas(tabuleiro, 'cruz-1').some((p) => p.pecaId === pecaId));
    assert.equal(codigoDaRejeicaoTabuleiro(tabuleiro, moverPeao('peao-vermelho', 3, 3)), 'PECA_JA_TEM_PEAO');
  }
});

test('vagasDisponiveis para peça especial sob peão com vizinhas vazias retorna 4 vagas', () => {
  for (const tipo of ['gerador', 'sala_do_diretor', 'sala_medica', 'portao_de_saida'] as const) {
    const estado: EstadoDoTabuleiro = {
      ...estadoInicialDoTabuleiro(),
      posicionadas: [{ pecaId: 'esp-1', tipo: tipo as TipoDaPeca, orientacao: 0, celula: { linha: 3, coluna: 3 } }],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'esp-1' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
      ],
      peaoSelecionadoId: 'peao-branco',
      recebidas: [],
      pecaEmManipulacaoId: null,
      pecaSelecionadaId: null,
      caixa: [],
      iniciais: [],
    };
    const peca = estado.posicionadas[0];
    const vagas = vagasDisponiveis(estado, peca);
    assert.equal(vagas.length, 4);
    assert.deepEqual(
      vagas.map((v) => v.borda),
      ['norte', 'leste', 'sul', 'oeste'],
    );
    // Com uma vizinha ocupada, cai para 3.
    const comVizinha: EstadoDoTabuleiro = {
      ...estado,
      posicionadas: [
        ...estado.posicionadas,
        { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 2, coluna: 3 } },
      ],
    };
    const vagasComOcupada = vagasDisponiveis(comVizinha, peca);
    assert.equal(vagasComOcupada.length, 3);
    assert.ok(!vagasComOcupada.some((v) => v.borda === 'norte'));
  }
});

test('vagasDisponiveis exclui bordas já escolhidas por recebidas pendentes', () => {
  const estado: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [{ pecaId: 'portao-1', tipo: 'portao_de_saida', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'portao-1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ],
    peaoSelecionadoId: 'peao-branco',
    recebidas: [
      { recebidaId: 'recebida-x', pecaId: 'reta-1', tipo: 'reta', orientacao: 0, vaga: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
    ],
    pecaEmManipulacaoId: null,
    pecaSelecionadaId: null,
    caixa: [],
    iniciais: [],
  };
  const peca = estado.posicionadas[0];
  const vagas = vagasDisponiveis(estado, peca, estado.recebidas);
  assert.equal(vagas.length, 3);
  assert.ok(!vagas.some((v) => v.borda === 'norte'));
});

// ---------------------------------------------------------------------------
// Partida: fluxo completo via aplicarComandoDePartida com seed manipulada
// ---------------------------------------------------------------------------

test('fluxo completo via partida com caixa manipulada: 4 especiais sorteadas e posicionadas pelo Recebimento', () => {
  const inicio = estadoInicialDaPartida(JOGADORES, { seed: 999 });
  assert.equal(inicio.sucesso, true);
  if (!inicio.sucesso) return;
  // Reordena a Caixa para que os 4 especiais venham primeiro (ordem determinística).
  const ordemEspeciais = ['gerador-1', 'sala-do-diretor-1', 'sala-medica-1', 'portao-de-saida-1'];
  let estado = inicio.estado;
  for (const id of [...ordemEspeciais].reverse()) {
    estado = comEspecialPrimeiroNaCaixa(estado, id);
  }
  // Verifica topo da Caixa.
  assert.deepEqual(
    estado.tabuleiro.caixa.slice(0, 4).map((p) => p.pecaId),
    ordemEspeciais,
  );

  // Primeiro Turno de ana em (3,3) com Inicial norte+leste aberta -> 2 vagas.
  // Sorteia gerador-1 e sala-do-diretor-1.
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const encaixe = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  assert.equal(encaixe.estado.tabuleiro.recebidas.length, 2);
  assert.deepEqual(
    encaixe.estado.tabuleiro.recebidas.map((r) => r.pecaId),
    ['gerador-1', 'sala-do-diretor-1'],
  );
  estado = encaixe.estado;

  // Resolve as 2 pendências: gerador ao norte, sala ao leste.
  estado = aplicar(estado, escolherVaga('recebida-gerador-1', 'norte'), 'ana');
  estado = aplicar(estado, posicionar('gerador-1', 2, 3), 'ana');
  assert.equal(estado.tabuleiro.pecaEmManipulacaoId, null);
  estado = aplicar(estado, escolherVaga('recebida-sala-do-diretor-1', 'leste'), 'ana');
  estado = aplicar(estado, posicionar('sala-do-diretor-1', 3, 4), 'ana');
  assert.equal(estado.tabuleiro.pecaEmManipulacaoId, null);
  assert.equal(estado.tabuleiro.recebidas.length, 0);

  // Encerra e avança: manipulação nula não emite evento extra.
  const encerrado = aplicarComandoDePartida(estado, encerrarTurno(), 'ana');
  assert.equal(encerrado.sucesso, true);
  if (!encerrado.sucesso) return;
  assert.ok(!encerrado.eventos.some((e) => e.tipo === 'manipulacao_finalizada'));
  estado = encerrado.estado;

  // Segundo Primeiro Turno (bruno em 0,0) sorteia sala-medica-1 e portao-1.
  estado = aplicar(estado, selecionar('inicial-2'), 'bruno');
  estado = aplicar(estado, posicionar('inicial-2', 0, 0), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const encaixe2 = aplicarComandoDePartida(estado, posicionarPeao('peao-vermelho', 0, 0), 'bruno');
  assert.equal(encaixe2.sucesso, true);
  if (!encaixe2.sucesso) return;
  // Em (0,0) a Inicial norte envolve para (6,0) na grade toroidal (issue
  // #260): norte e leste viram vaga -> 2 peças sorteadas (sala-medica-1 e
  // portao-de-saida-1).
  assert.deepEqual(
    encaixe2.estado.tabuleiro.recebidas.map((r) => r.pecaId),
    ['sala-medica-1', 'portao-de-saida-1'],
  );
  estado = encaixe2.estado;
  estado = aplicar(estado, escolherVaga('recebida-sala-medica-1', 'leste'), 'bruno');
  estado = aplicar(estado, posicionar('sala-medica-1', 0, 1), 'bruno');
  assert.equal(estado.tabuleiro.pecaEmManipulacaoId, null);
  estado = aplicar(estado, escolherVaga('recebida-portao-de-saida-1', 'norte'), 'bruno');
  estado = aplicar(estado, posicionar('portao-de-saida-1', 6, 0), 'bruno');
  assert.equal(estado.tabuleiro.pecaEmManipulacaoId, null);
  estado = aplicar(estado, encerrarTurno(), 'bruno');
  assert.equal(estado.jogadorAtivoId, 'carla');

  // A composição da Caixa foi consumida exatamente nas 4 especiais.
  assert.ok(!estado.tabuleiro.caixa.some((p) => p.pecaId === 'portao-de-saida-1'));
  assert.ok(!estado.tabuleiro.caixa.some((p) => p.pecaId === 'gerador-1'));
});
