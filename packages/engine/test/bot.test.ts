import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  acoesValidasDaSubfase,
  aplicarComandoDePartida,
  bordasAbertas,
  conectaNaVaga,
  estadoInicialDaPartida,
  executarTurnoDoBot,
  mapearBot,
  sortearAcao,
  type BordaCardinal,
  type Celula,
  type ComandoDePartida,
  type EstadoDaPartida,
  type Orientacao,
  type JogadorDaPartida,
  type PecaRecebida,
} from '../src/index.ts';

const selecionarPeca = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const girarPeca = (pecaId: string) =>
  ({ tipo: 'girar_peca', pecaId, sentido: 'horario' } as const);

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

const JOGADORES = ['ana', 'bruno', 'carla', 'diogo'];

function partidaIniciadaCom(
  roster: readonly string[],
  seed?: number,
): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(
    roster,
    seed === undefined ? undefined : { seed },
  );
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
}

// Resolve todas as pendências do Recebimento: escolhe a vaga de cada peça
// sorteada (primeira borda canônica ainda disponível), gira a Recebida até a
// borda voltada à Peça sob o Peão abrir (encaixe conectado, issue #311) e
// encaixa na célula-alvo derivada da vaga.
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

function concluirPrimeiroTurno(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = estado.jogadores.find(
    (item) => item.jogadorId === ator,
  );
  if (!jogador) {
    throw new Error('Partida sem Jogador Ativo');
  }
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionarPeca(pecaId), ator);
  estado = aplicar(
    estado,
    posicionarPeca(pecaId, celula.linha, celula.coluna),
    ator,
  );
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, celula.linha, celula.coluna),
    ator,
  );
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, encerrarTurno(), ator);
}

// Peões em (3,3), (0,0), (6,6) e (1,0): diogo foge de (6,0) porque a vaga
// norte de bruno envolve para lá na grade toroidal (issue #260) — mesmo
// fixture de monstros.test.ts.
function partidaEmRodada2(seed?: number): EstadoDaPartida {
  let estado = partidaIniciadaCom(JOGADORES, seed);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });
  return estado;
}

function peaoIdDo(jogadorId: string): string {
  const ordem = JOGADORES.indexOf(jogadorId);
  const cores = ['branco', 'vermelho', 'azul', 'amarelo'];
  return `peao-${cores[ordem]}`;
}

// Patch inline do Jogador (mesmo espírito do comJogador de sanidade.test.ts):
// injeta flags de estado (ex.: emBaixaIluminacao) sem percorrer a engine.
function comJogador(
  estado: EstadoDaPartida,
  jogadorId: string,
  patch: Partial<JogadorDaPartida>,
): EstadoDaPartida {
  return {
    ...estado,
    jogadores: estado.jogadores.map((item) =>
      item.jogadorId === jogadorId ? { ...item, ...patch } : item,
    ),
  };
}

// Pendência sintética do Recebimento (vaga e célula-alvo nulas até a escolha).
// Tipo Cruz: as 4 bordas abertas conectam em qualquer vaga (conectaNaVaga
// sempre true), de modo que os testes da #341 exercem apenas o filtro de
// Baixa — a exatidão literal das vagas (review #350) fica coberta pelos
// testes próprios da Reta.
const recebidaBaixa: PecaRecebida = {
  recebidaId: 'rec-baixa',
  pecaId: 'recebida-sintetica',
  tipo: 'cruz',
  orientacao: 0,
  vaga: null,
  celulaAlvo: null,
};

// Cenário de Baixa Iluminação controlado (#341): ana em Baixa, com o Peão
// sobre uma Peça Cruz sintética em (3,0) — as células vizinhas norte (2,0),
// leste (3,1), sul (4,0) e o oeste toroidal (3,6) (issue #260) estão vazias
// na Rodada 2 (longe das quatro Iniciais e das vagas que elas geram) — e a
// pendência informada como estado direto: a FSM enumera sem aplicar comandos.
function estadoDaBaixa(
  recebida: PecaRecebida,
  celulasIluminadas: readonly Celula[],
): EstadoDaPartida {
  const base = partidaEmRodada2(7);
  return {
    ...comJogador(base, 'ana', { emBaixaIluminacao: true }),
    celulasIluminadas,
    tabuleiro: {
      ...base.tabuleiro,
      posicionadas: [
        ...base.tabuleiro.posicionadas,
        {
          pecaId: 'peca-controle',
          tipo: 'cruz',
          orientacao: 0,
          celula: { linha: 3, coluna: 0 },
        },
      ],
      peoes: base.tabuleiro.peoes.map((peao) =>
        peao.peaoId === 'peao-branco'
          ? { ...peao, pecaId: 'peca-controle' }
          : peao,
      ),
      recebidas: [recebida],
    },
  };
}

test('mapearBot traduz botId em peão, cor, ordem e flag do Primeiro Turno', () => {
  const estado = partidaIniciadaCom(JOGADORES);
  assert.deepEqual(mapearBot(estado, 'ana'), {
    jogadorId: 'ana',
    cor: 'branco',
    peaoId: 'peao-branco',
    ordem: 1,
    primeiroTurnoPendente: true,
  });
  assert.deepEqual(mapearBot(estado, 'diogo'), {
    jogadorId: 'diogo',
    cor: 'amarelo',
    peaoId: 'peao-amarelo',
    ordem: 4,
    primeiroTurnoPendente: true,
  });
});

test('mapearBot e acoesValidasDaSubfase falham alto fora do roster', () => {
  const estado = partidaIniciadaCom(JOGADORES);
  assert.throws(
    () => mapearBot(estado, 'zelda'),
    /não pertence a esta partida/,
  );
  assert.throws(
    () => acoesValidasDaSubfase(estado, 'zelda'),
    /não pertence a esta partida/,
  );
});

test('sortearAcao distribui uniformemente via Math.random()', () => {
  const amostras = 6000;
  const contagem = new Map<string, number>([
    ['a', 0],
    ['b', 0],
    ['c', 0],
  ]);
  for (let i = 0; i < amostras; i++) {
    const sorteada = sortearAcao(['a', 'b', 'c'] as const);
    contagem.set(sorteada, (contagem.get(sorteada) ?? 0) + 1);
  }
  for (const [opcao, total] of contagem) {
    assert.ok(
      Math.abs(total - amostras / 3) <= 200,
      `opção ${opcao} fora da tolerância: ${total}`,
    );
  }
});

test('sortearAcao lança sobre lista vazia', () => {
  assert.throws(() => sortearAcao([]), /Não há ações válidas/);
});

test('subfase (a): partida terminada ou vez alheia não gera ações', () => {
  const viva = partidaEmRodada2();
  const terminada: EstadoDaPartida = {
    ...viva,
    resultado: { tipo: 'vitoria' },
  };
  assert.deepEqual(acoesValidasDaSubfase(terminada, 'ana'), []);
  const fresca = partidaIniciadaCom(JOGADORES);
  assert.deepEqual(acoesValidasDaSubfase(fresca, 'bruno'), []);
});

test('Primeiro Turno fresco: só selecionar a própria Inicial', () => {
  const estado = partidaIniciadaCom(JOGADORES);
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    { tipo: 'selecionar_peca', pecaId: 'inicial-1' },
  ]);
});

test('Primeiro Turno: após selecionar, posicionar em qualquer célula livre', () => {
  let estado = partidaIniciadaCom(JOGADORES);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.equal(acoes.length, 49);
  assert.ok(
    acoes.every(
      (acao) =>
        acao.tipo === 'posicionar_peca' && acao.pecaId === 'inicial-1',
    ),
  );
});

test('Primeiro Turno: sequência peão seleciona, posiciona e encerra', () => {
  let estado = partidaIniciadaCom(JOGADORES);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
  ]);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    {
      tipo: 'posicionar_peao',
      peaoId: 'peao-branco',
      celula: { linha: 3, coluna: 3 },
    },
  ]);
});

test('subfase (b): Recebimento pendente só emite escolher a vaga', () => {
  let estado = partidaIniciadaCom(JOGADORES);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.ok(estado.tabuleiro.recebidas.length > 0);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.ok(acoes.length > 0);
  assert.ok(
    acoes.every((acao) => acao.tipo === 'escolher_vaga_da_peca_recebida'),
  );
  const recebidas = new Set(
    estado.tabuleiro.recebidas.map((item) => item.recebidaId),
  );
  assert.ok(
    acoes.every(
      (acao) =>
        acao.tipo === 'escolher_vaga_da_peca_recebida' &&
        recebidas.has(acao.recebidaId),
    ),
  );
});

test('subfase (b): após escolher a vaga, só as ações da Recebida fixada (#311/#349)', () => {
  let estado = partidaIniciadaCom(JOGADORES);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  const primeira = estado.tabuleiro.recebidas[0];
  assert.ok(primeira);
  estado = aplicar(estado, escolherVaga(primeira.recebidaId, 'norte'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  // Guard canônico espelhado (#311): com a fixada pendente, a engine rejeita
  // escolher_vaga de outra pendência (PENDENCIA_NAO_RESOLVIDA) — a FSM
  // enumera apenas o encaixe conectado dela ou, se a vaga não conecta na
  // orientação sorteada, o giro que abre a borda voltada à geradora (#349).
  const fixada = estado.tabuleiro.recebidas.find(
    (item) => item.recebidaId === primeira.recebidaId,
  );
  assert.ok(fixada && fixada.vaga !== null && fixada.celulaAlvo !== null);
  if (conectaNaVaga(fixada.tipo, fixada.orientacao, fixada.vaga)) {
    assert.deepEqual(acoes, [
      {
        tipo: 'posicionar_peca',
        pecaId: fixada.pecaId,
        celula: fixada.celulaAlvo,
      },
    ]);
  } else {
    assert.deepEqual(acoes, [
      { tipo: 'girar_peca', pecaId: fixada.pecaId, sentido: 'horario' },
      { tipo: 'girar_peca', pecaId: fixada.pecaId, sentido: 'anti_horario' },
    ]);
  }
});

test('subfase (b): sem Peão selecionado, planeja o Recebimento direto — pré-adoção do ator (#326)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.ok(estado.tabuleiro.recebidas.length > 0);
  const semSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: null },
  };
  // Com a pré-adoção do engine (review #333), o planejador emite as ações do
  // Recebimento direto — nenhuma re-seleção intermediária.
  const acoes = acoesValidasDaSubfase(semSelecao, 'ana');
  assert.ok(acoes.length > 0);
  assert.ok(
    acoes.every((acao) => acao.tipo === 'escolher_vaga_da_peca_recebida'),
  );
  const recebidas = new Set(
    semSelecao.tabuleiro.recebidas.map((item) => item.recebidaId),
  );
  assert.ok(
    acoes.every(
      (acao) =>
        acao.tipo === 'escolher_vaga_da_peca_recebida' &&
        recebidas.has(acao.recebidaId),
    ),
  );
});

test('subfase (b): em Baixa Iluminação a FSM enumera apenas vagas em células escuras (#341)', () => {
  // A vaga norte (2,0) da Peça controle está iluminada; leste, sul e o oeste
  // toroidal (3,6) (issue #260) seguem escuros — a engine rejeita a iluminada
  // com DADOS_INVALIDOS.
  const estado = estadoDaBaixa(recebidaBaixa, [{ linha: 2, coluna: 0 }]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  // Conjunto de bordas enumeradas é exatamente o das vagas escuras — nenhuma
  // ação mira célula iluminada.
  assert.deepEqual(acoes, [
    escolherVaga('rec-baixa', 'leste'),
    escolherVaga('rec-baixa', 'sul'),
    escolherVaga('rec-baixa', 'oeste'),
  ]);
});

test('subfase (b): pendência da Travessia segue enumerando a borda travada em Baixa (#341)', () => {
  // Pendência da Travessia do Escuro: célula-alvo pré-fixada — aqui, na vaga
  // norte, ILUMINADA. A engine valida só o match da célula travada, então a
  // FSM não aplica o filtro de Baixa a esta pendência.
  const travessia: PecaRecebida = {
    ...recebidaBaixa,
    celulaAlvo: { linha: 2, coluna: 0 },
  };
  const estado = estadoDaBaixa(travessia, [{ linha: 2, coluna: 0 }]);
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    escolherVaga('rec-baixa', 'norte'),
  ]);
});

test('subfase (b): em Baixa com todas as vagas iluminadas, escolher_vaga não é enumerada (#341)', () => {
  // Todas as QUATRO vagas da Peça controle iluminadas — incluindo o oeste
  // toroidal (3,6) (issue #260): a pendência comum fica irresolúvel e o ramo
  // não emite escolher_vaga — lista vazia. No driver, isso desdobra em
  // desistência honesta via failsafe (o encerrar_turno forçado cai em
  // PENDENCIA_NAO_RESOLVIDA); pendência irresolúvel em Baixa é limitação
  // pré-existente da engine para humanos e bots, fora do escopo desta
  // correção.
  const estado = estadoDaBaixa(recebidaBaixa, [
    { linha: 2, coluna: 0 },
    { linha: 3, coluna: 1 },
    { linha: 4, coluna: 0 },
    { linha: 3, coluna: 6 },
  ]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, []);
});

// Pendência não fixada do Recebimento (#349): Reta na orientação 90° — bordas
// abertas leste+oeste. Sobre a Peça controle (vagas norte (2,0), leste (3,1),
// sul (4,0) e oeste toroidal (3,6) — issue #260), leste e oeste conectam (o
// oposto da vaga — oeste e leste, respectivamente — está aberto); norte e sul
// são vagas mortas para esta orientação.
const recebidaMorta: PecaRecebida = {
  recebidaId: 'rec-morta',
  pecaId: 'recebida-morta',
  tipo: 'reta',
  orientacao: 90,
  vaga: null,
  celulaAlvo: null,
};

// A mesma Reta com a vaga norte já escolhida — vaga morta fixada: a borda
// voltada à Peça geradora (sul, o oposto de norte) está fechada na
// orientação 90°.
const recebidaMortaFixada: PecaRecebida = {
  ...recebidaMorta,
  vaga: 'norte',
  celulaAlvo: { linha: 2, coluna: 0 },
};

// Cenário controlado do Recebimento para a #349: ana na Rodada 2, sem Baixa,
// com o Peão sobre a Peça controle Cruz sintética em (3,0) — as células
// vizinhas norte (2,0), leste (3,1), sul (4,0) e oeste toroidal (3,6)
// (issue #260) estão vazias (o mesmo cenário da #341). As Recebidas são
// informadas como estado direto; quando há Recebida com vaga fixada, o helper
// seta o pecaSelecionadaId para ela — o mesmo efeito do escolher_vaga na
// engine (peoes.ts), requisito do guard defensivo do giro (review #350).
function estadoDoRecebimento(
  recebidas: readonly PecaRecebida[],
): EstadoDaPartida {
  const base = partidaEmRodada2(7);
  const fixada = recebidas.find((item) => item.vaga !== null);
  return {
    ...base,
    tabuleiro: {
      ...base.tabuleiro,
      posicionadas: [
        ...base.tabuleiro.posicionadas,
        {
          pecaId: 'peca-controle',
          tipo: 'cruz',
          orientacao: 0,
          celula: { linha: 3, coluna: 0 },
        },
      ],
      peoes: base.tabuleiro.peoes.map((peao) =>
        peao.peaoId === 'peao-branco'
          ? { ...peao, pecaId: 'peca-controle' }
          : peao,
      ),
      pecaSelecionadaId: fixada ? fixada.pecaId : base.tabuleiro.pecaSelecionadaId,
      recebidas,
    },
  };
}

test('subfase (b): com Recebida fixada conectada, a enumeração é exatamente o encaixe dela (#311/#349)', () => {
  const fixada: PecaRecebida = {
    ...recebidaBaixa,
    recebidaId: 'rec-fixada',
    pecaId: 'recebida-fixada',
    vaga: 'norte',
    celulaAlvo: { linha: 2, coluna: 0 },
  };
  const estado = estadoDoRecebimento([fixada, recebidaBaixa]);
  // A segunda pendência (recebidaBaixa, sem vaga) NÃO gera escolher_vaga:
  // com a fixada pendente, a engine rejeitaria (PENDENCIA_NAO_RESOLVIDA,
  // guard da #311).
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, [
    {
      tipo: 'posicionar_peca',
      pecaId: 'recebida-fixada',
      celula: { linha: 2, coluna: 0 },
    },
  ]);
  // E o encaixe enumerado é aceito pela engine (Peça controle sob o Peão,
  // Cruz com a borda norte aberta, célula-alvo (2,0) vazia).
  aplicar(estado, acoes[0] as ComandoDePartida, 'ana');
});

test('subfase (b): exatidão literal — vaga conectante e vaga morta são AMBAS enumeradas (review #350)', () => {
  // Vagas da Peça controle: norte (2,0), leste (3,1), sul (4,0) e oeste
  // toroidal (3,6) (issue #260) — na orientação 90° da Reta (abertas
  // leste+oeste), leste e oeste conectam; norte e sul são vagas mortas. A
  // engine aceita escolher vaga morta (a conexão só valida no encaixe,
  // MOVIMENTO_NAO_CONECTADO em peoes.ts), então TODAS as vagas escuras são
  // enumeradas — filtrar conectantes seria enumerar subconjunto (viola a
  // exatidão); o giro da fixada é o resgate da vaga morta (#349).
  const estado = estadoDoRecebimento([recebidaMorta]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, [
    escolherVaga('rec-morta', 'norte'),
    escolherVaga('rec-morta', 'leste'),
    escolherVaga('rec-morta', 'sul'),
    escolherVaga('rec-morta', 'oeste'),
  ]);
  // E a vaga morta enumerada é de fato aceita pela engine (exatidão literal).
  aplicar(estado, acoes[0] as ComandoDePartida, 'ana');
});

test('subfase (b): sem nenhuma vaga conectante, as escuras mortas seguem enumeradas (review #350)', () => {
  // A mesma Reta em Baixa com as DUAS conectantes (leste (3,1) e oeste
  // toroidal (3,6)) iluminadas: restam só as vagas mortas norte e sul — e
  // ambas são enumeradas. Este era o "fallback" do pré-filtro removido:
  // agora é o comportamento incondicional da enumeração.
  const estado = estadoDaBaixa(recebidaMorta, [
    { linha: 3, coluna: 1 },
    { linha: 3, coluna: 6 },
  ]);
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    escolherVaga('rec-morta', 'norte'),
    escolherVaga('rec-morta', 'sul'),
  ]);
});

test('subfase (b): Recebida fixada em vaga morta enumera girar_peca nos dois sentidos, e o giro abre o encaixe (#349)', () => {
  // O helper já seta o pecaSelecionadaId na fixada — o mesmo efeito da
  // escolha de vaga na engine (peoes.ts) — satisfazendo o guard defensivo
  // do giro (review #350).
  const estado = estadoDoRecebimento([recebidaMortaFixada]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, [
    { tipo: 'girar_peca', pecaId: 'recebida-morta', sentido: 'horario' },
    { tipo: 'girar_peca', pecaId: 'recebida-morta', sentido: 'anti_horario' },
  ]);
  // Qualquer sentido da Reta sai de 90° para um eixo norte–sul — a borda
  // voltada à geradora abre e o encaixe passa a ser a ação enumerada.
  const girado = aplicar(estado, acoes[0] as ComandoDePartida, 'ana');
  assert.deepEqual(acoesValidasDaSubfase(girado, 'ana'), [
    {
      tipo: 'posicionar_peca',
      pecaId: 'recebida-morta',
      celula: { linha: 2, coluna: 0 },
    },
  ]);
});

test('subfase (b): fixada em vaga morta com seleção divergente não enumera giro (guard defensivo, review #350)', () => {
  // Estado artesanal: o pecaSelecionadaId diverge da Recebida fixada —
  // inalcançável por comandos válidos (a escolha da vaga fixa o
  // pecaSelecionadaId e a desseleção é rejeitada com Recebidas pendentes,
  // peoes.ts), mas o girar da engine rejeitaria com PECA_NAO_SELECIONADA
  // (tabuleiro.ts). A FSM não enumera rejeição certa: [] honesto — no
  // driver, desistência pelo failsafe, sem girar em falso.
  const base = estadoDoRecebimento([recebidaMortaFixada]);
  const divergente: EstadoDaPartida = {
    ...base,
    tabuleiro: { ...base.tabuleiro, pecaSelecionadaId: null },
  };
  assert.deepEqual(acoesValidasDaSubfase(divergente, 'ana'), []);
});

test('executarTurnoDoBot: a Recebida morta é recuperada por giro e o turno encerra (#349)', () => {
  const estado = estadoDoRecebimento([recebidaMortaFixada]);
  const resultado = executarTurnoDoBot(estado, 'ana');
  assert.equal(resultado.motivo, 'encerramento');
  assert.equal(resultado.estado.jogadorAtivoId, 'bruno');
  assert.equal(resultado.estado.tabuleiro.recebidas.length, 0);
  // O giro de recuperação de fato ocorreu no turno.
  assert.ok(
    resultado.acoesExecutadas.some(
      (acao) =>
        acao.tipo === 'girar_peca' && acao.pecaId === 'recebida-morta',
    ),
  );
});

test('regressão do travamento da semente 7: a rodada dos 4 bots progrediu sem desistir em todos os turnos (#349)', () => {
  // O travamento pré-correção: o bot fixava vaga morta, o ramo da fixada
  // deixava de agir e 400/400 turnos morriam em desistência (fail do teste
  // acima, padrão :694). Com a FSM exata, nenhum turno trava.
  let estado = partidaIniciadaCom(JOGADORES, 7);
  const rodadaInicial = estado.rodada;
  let tentativas = 0;
  let desistencias = 0;
  let foraDaVez = 0;
  while (estado.resultado === null && tentativas < 400) {
    tentativas++;
    const ator = estado.jogadorAtivoId;
    const turno = executarTurnoDoBot(estado, ator);
    if (turno.motivo === 'fora_da_vez') {
      foraDaVez++;
      break;
    }
    estado = turno.estado;
    if (turno.motivo === 'desistencia') {
      assert.notEqual(
        turno.codigoDaDesistencia,
        'DADOS_INVALIDOS',
        'desistência DADOS_INVALIDOS: ação enumerada rejeitada pela engine',
      );
      desistencias++;
      continue;
    }
  }
  assert.equal(foraDaVez, 0, 'bot nunca perde a vez agindo nela');
  assert.ok(
    estado.resultado !== null || tentativas === 400,
    'deveria terminar ou atingir o limite de tentativas',
  );
  assert.ok(
    desistencias < tentativas,
    `jogo travado na semente 7: ${desistencias}/${tentativas} turnos em desistência`,
  );
  assert.ok(estado.rodada >= rodadaInicial);
});

test('prova dinâmica da Travessia: ações de bot jamais criam pendência travada (review #350)', () => {
  // Par dinâmico da prova do ramo travada em bot.ts: a pendência com
  // celulaAlvo fixado nasce EXCLUSIVAMENTE em atravessarOEscuroDaPartida
  // (partida.ts) — gerarRecebidas nasce com celulaAlvo nulo (peoes.ts) e o
  // escolher de vaga fixa vaga e célula-alvo JUNTAS (peoes.ts) — e esta FSM
  // nunca emite atravessar_o_escuro. Aqui, a prova dinâmica: percorrendo
  // jogos de bots, nenhum estado alcançado contém pendência travada (vaga
  // nula com célula-alvo fixada) e nenhuma ação enumerada é
  // atravessar_o_escuro.
  for (let semente = 1; semente <= 25; semente++) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    let tentativas = 0;
    while (estado.resultado === null && tentativas < 400) {
      tentativas++;
      const ator = estado.jogadorAtivoId;
      assert.ok(
        !estado.tabuleiro.recebidas.some(
          (recebida) => recebida.vaga === null && recebida.celulaAlvo !== null,
        ),
        `pendência travada alcançada por ações de bot (semente ${semente})`,
      );
      for (const acao of acoesValidasDaSubfase(estado, ator)) {
        assert.notEqual(acao.tipo, 'atravessar_o_escuro');
      }
      const turno = executarTurnoDoBot(estado, ator);
      if (turno.motivo === 'fora_da_vez') break;
      if (turno.motivo === 'desistencia') continue;
      estado = turno.estado;
    }
  }
});

test('turno normal: início só seleciona o Peão; depois move ou permanece', () => {
  const estado = partidaEmRodada2();
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    { tipo: 'selecionar_peao', peaoId: 'peao-branco' },
  ]);
  const selecionado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const acoes = acoesValidasDaSubfase(selecionado, 'ana');
  assert.ok(acoes.length >= 1);
  assert.ok(
    acoes.every(
      (acao) =>
        acao.tipo === 'mover_peao' || acao.tipo === 'permanecer',
    ),
  );
  assert.ok(
    acoes.some(
      (acao) =>
        acao.tipo === 'permanecer' && acao.peaoId === 'peao-branco',
    ),
  );
});

test('turno normal: após mover, confirmar substitui o permanecer', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Re-seleção do Peão: semântica única da Movimentação — ver o fechamento do
  // moverPeaoDaPartida em partida.ts (#334).
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    { tipo: 'mover_peao', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } },
    { tipo: 'confirmar_posicao_do_peao', peaoId: 'peao-branco' },
  ]);
  estado = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(estado.posicaoConfirmada, true);
});

test('cadeia do turno normal: mover, confirmar, resolver e encerrar', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(estado.posicaoConfirmada, true);
  estado = resolverRecebidas(estado, 'ana');
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), [
    { tipo: 'encerrar_turno' },
  ]);
  const encerrado = aplicar(estado, encerrarTurno(), 'ana');
  assert.equal(encerrado.jogadorAtivoId, 'bruno');
  assert.deepEqual(acoesValidasDaSubfase(encerrado, 'ana'), []);
});

test('via da permanência: ficar na peça de início encerra o turno direto', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.ok(
    acoes.some(
      (acao) =>
        acao.tipo === 'permanecer' && acao.peaoId === 'peao-branco',
    ),
  );
  const turno = executarTurnoDoBot(estado, 'ana', {
    maxActionsPerTurn: 10,
    sortear: <T>(opcoes: readonly T[]): T => {
      const ficar = opcoes.find(
        (acao) =>
          (acao as unknown as ComandoDePartida).tipo === 'permanecer',
      );
      if (ficar === undefined) {
        throw new Error('permanecer deveria estar entre as válidas');
      }
      return ficar;
    },
  });
  assert.equal(turno.motivo, 'encerramento');
  assert.equal(turno.estado.jogadorAtivoId, 'bruno');
});

test('toda ação enumerada é aceita pela engine (exatidão da FSM)', () => {
  // 25 sementes: o caminho do bug da #341 era seed-dependente (bot em Baixa
  // Iluminação com vaga candidata iluminada) e escapava de amostras curtas.
  for (let semente = 1; semente <= 25; semente++) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    for (let passo = 0; passo < 40; passo++) {
      if (estado.resultado !== null) break;
      const ator = estado.jogadorAtivoId;
      const acoes = acoesValidasDaSubfase(estado, ator);
      for (const acao of acoes) {
        const resultado = aplicarComandoDePartida(estado, acao, ator);
        assert.equal(
          resultado.sucesso,
          true,
          `ação enumerada rejeitada: ${JSON.stringify(acao)} (${
            resultado.sucesso ? '' : resultado.erro.codigo
          })`,
        );
      }
      if (acoes.length === 0) break;
      estado = aplicar(estado, sortearAcao(acoes), ator);
    }
  }
});

test('identidade: 200 Primeiros Turnos nunca agem por outro jogador', () => {
  for (let i = 0; i < 200; i++) {
    let estado = partidaIniciadaCom(JOGADORES, 1000 + i);
    const ator = estado.jogadorAtivoId;
    const esperado = peaoIdDo(ator);
    for (let passo = 0; passo < 30; passo++) {
      if (estado.resultado !== null) break;
      if (estado.jogadorAtivoId !== ator) break;
      const acoes = acoesValidasDaSubfase(estado, ator);
      assert.ok(acoes.length > 0, 'bot travou sem failsafe no Primeiro Turno');
      for (const acao of acoes) {
        if ('peaoId' in acao && acao.peaoId !== undefined) {
          assert.equal(acao.peaoId, esperado);
        }
      }
      const comando = sortearAcao(acoes);
      const resultado = aplicarComandoDePartida(estado, comando, ator);
      assert.equal(resultado.sucesso, true);
      if (!resultado.sucesso) break;
      estado = resultado.estado;
    }
    assert.equal(estado.jogadorAtivoId === ator, false);
  }
});

test('identidade: 200 turnos normais sem FORA_DA_VEZ por culpa do bot', () => {
  for (let i = 0; i < 200; i++) {
    let estado = partidaEmRodada2(5000 + i);
    const ator = estado.jogadorAtivoId;
    const esperado = peaoIdDo(ator);
    for (let passo = 0; passo < 50; passo++) {
      if (estado.resultado !== null) break;
      if (estado.jogadorAtivoId !== ator) break;
      const acoes = acoesValidasDaSubfase(estado, ator);
      if (acoes.length === 0) break;
      const comando = sortearAcao(acoes);
      const resultado = aplicarComandoDePartida(estado, comando, ator);
      if (!resultado.sucesso) {
        assert.notEqual(
          resultado.erro.codigo,
          'FORA_DA_VEZ',
          'bot recebeu FORA_DA_VEZ agindo na própria vez',
        );
        break;
      }
      if ('peaoId' in comando && comando.peaoId !== undefined) {
        assert.equal(comando.peaoId, esperado);
      }
      estado = resultado.estado;
    }
  }
});

test('failsafe: vagar sem confirmar termina em ≤10 ações com desistência', () => {
  const estado = partidaEmRodada2();
  const sempreAPrimeira = <T>(acoes: readonly T[]): T => {
    const primeira = acoes[0];
    if (primeira === undefined) {
      throw new Error('sem ações');
    }
    return primeira;
  };
  const resultado = executarTurnoDoBot(estado, 'ana', {
    maxActionsPerTurn: 10,
    sortear: sempreAPrimeira,
  });
  assert.equal(resultado.motivo, 'desistencia');
  assert.equal(resultado.codigoDaDesistencia, 'ENCERRAMENTO_INVALIDO');
  assert.ok(resultado.acoesExecutadas.length <= 11);
});

test('failsafe: com a posição confirmada, o forçado encerra de imediato', () => {
  const base = partidaEmRodada2();
  const confirmada: EstadoDaPartida = {
    ...base,
    posicaoConfirmada: true,
  };
  const resultado = executarTurnoDoBot(confirmada, 'ana', {
    maxActionsPerTurn: 0,
  });
  assert.equal(resultado.motivo, 'encerramento');
  assert.deepEqual(resultado.acoesExecutadas, [{ tipo: 'encerrar_turno' }]);
  assert.equal(resultado.estado.jogadorAtivoId, 'bruno');
});

test('executarTurnoDoBot conclui o Primeiro Turno até o encerramento', () => {
  const estado = partidaIniciadaCom(JOGADORES, 42);
  const resultado = executarTurnoDoBot(estado, 'ana');
  assert.equal(resultado.motivo, 'encerramento');
  assert.equal(resultado.estado.jogadorAtivoId, 'bruno');
  const ana = resultado.estado.jogadores.find(
    (item) => item.jogadorId === 'ana',
  );
  assert.equal(ana?.primeiroTurnoPendente, false);
});

test('executarTurnoDoBot fora da vez não age', () => {
  const estado = partidaIniciadaCom(JOGADORES);
  const resultado = executarTurnoDoBot(estado, 'bruno');
  assert.equal(resultado.motivo, 'fora_da_vez');
  assert.deepEqual(resultado.acoesExecutadas, []);
});

test('4 bots terminam a partida quando a Caixa esgota sem objetivos', () => {
  const base = partidaEmRodada2();
  const semCaixa: EstadoDaPartida = {
    ...base,
    tabuleiro: { ...base.tabuleiro, caixa: [] },
  };
  const turno = executarTurnoDoBot(semCaixa, semCaixa.jogadorAtivoId);
  assert.equal(turno.motivo, 'resultado');
  assert.deepEqual(turno.estado.resultado, {
    tipo: 'derrota',
    motivo: 'caixa_esgotada',
  });
});

test('4 bots jogam até o resultado ou o limite de rodadas, sem exceção', () => {
  for (const semente of [7, 77, 777]) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    const rodadaInicial = estado.rodada;
    let tentativas = 0;
    let desistencias = 0;
    let foraDaVez = 0;
    while (estado.resultado === null && tentativas < 400) {
      tentativas++;
      const ator = estado.jogadorAtivoId;
      // Teto folgado do teste (50) acima do default do failsafe
      // (MAX_ACOES_POR_TURNO_DO_BOT = 10): dá espaço ao wander aleatório
      // sem mascarar o guardião do driver (#334).
      const turno = executarTurnoDoBot(estado, ator, {
        maxActionsPerTurn: 50,
      });
      if (turno.motivo === 'fora_da_vez') {
        foraDaVez++;
        break;
      }
      estado = turno.estado;
      if (turno.motivo === 'desistencia') {
        // Guarda da #341: a FSM não enumera mais vaga iluminada em Baixa, e
        // nenhuma outra ação enumerada é rejeitada pela engine — desistência
        // DADOS_INVALIDOS indica regressão da enumeração.
        assert.notEqual(
          turno.codigoDaDesistencia,
          'DADOS_INVALIDOS',
          'desistência DADOS_INVALIDOS: ação enumerada rejeitada pela engine',
        );
        // Desistência é desdobramento legítimo do failsafe: o turno não
        // avançou (o ator segue na vez) e a função é pura com sorteio
        // aleatório — re-executar o turno do mesmo ator em vez de abortar a
        // partida simulada (#334).
        desistencias++;
        continue;
      }
    }
    assert.equal(foraDaVez, 0, 'bot nunca perde a vez agindo nela');
    assert.ok(
      estado.resultado !== null || tentativas === 400,
      'deveria terminar ou atingir o limite de tentativas',
    );
    // Detector de travamento real: falha apenas quando NENHUM turno progrediu
    // (todas as tentativas morreram em desistência sem avançar o estado).
    // Desistências legítimas podem ocorrer — o wander aleatório não garante
    // progresso por turno — mas o estado segue avançando entre elas (#334),
    // e nenhuma delas é DADOS_INVALIDOS com o filtro de vagas escuras em
    // Baixa (#341).
    assert.ok(
      desistencias < tentativas,
      `jogo travado na semente ${semente}: ${desistencias}/${tentativas} turnos em desistência`,
    );
    assert.ok(estado.rodada >= rodadaInicial);
  }
});
