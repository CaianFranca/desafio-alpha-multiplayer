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
  expandirPosicionamentoDoBot,
  mapearBot,
  orientacaoConectaComGeradora,
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

test('subfase (b): após escolher a vaga, o encaixe é serial (sem nova escolha)', () => {
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
  assert.ok(acoes.length > 0);
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

test('subfase (b): em Baixa com RETA e todas as vagas iluminadas, escolher_vaga não é enumerada (review #350)', () => {
  // Par do teste da Cruz (:478) com a Reta — a troca do fixture
  // recebidaBaixa reta→cruz esvaziara o caso "todas as vagas iluminadas".
  // As QUATRO vagas da Peça controle iluminadas — norte (2,0), leste (3,1),
  // sul (4,0) e o oeste toroidal (3,6) (issue #260) — deixam a pendência
  // comum irresolúvel: nenhuma vaga escura restante, o ramo não emite
  // escolher_vaga — lista vazia (desistência honesta pelo failsafe no
  // driver). Com o pré-filtro de conexão removido, o Tipo não muda o filtro
  // de escuras — o caso fica coberto explicitamente mesmo assim.
  const estado = estadoDaBaixa(recebidaMorta, [
    { linha: 2, coluna: 0 },
    { linha: 3, coluna: 1 },
    { linha: 4, coluna: 0 },
    { linha: 3, coluna: 6 },
  ]);
  assert.deepEqual(acoesValidasDaSubfase(estado, 'ana'), []);
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
  // acima, padrão :694) — nem a rodada 1 avançava. Duas janelas assertadas:
  //
  // Janela da regressão (rodada 1), terminação ESTRITA — medida em 300
  // execuções: 4 turnos por partida, 1200/1200 encerrados em 'encerramento',
  // zero desistências, nenhum término de partida na rodada 1. O assert de
  // motivo é o próprio endurecimento: o travamento pré-correção encerrava o
  // turno do bot em 'desistencia' em vez de 'encerramento' (:662/:694).
  let estado = partidaIniciadaCom(JOGADORES, 7);
  const rodadaInicial = estado.rodada;
  while (
    estado.resultado === null &&
    estado.jogadores.some((jogador) => jogador.primeiroTurnoPendente)
  ) {
    const ator = estado.jogadorAtivoId;
    const turno = executarTurnoDoBot(estado, ator);
    assert.equal(
      turno.motivo,
      'encerramento',
      'turno do Primeiro Turno não encerrou — desistência é a regressão da #349',
    );
    estado = turno.estado;
  }
  assert.equal(estado.resultado, null, 'a rodada 1 não termina a partida');
  assert.ok(
    estado.jogadores.every((jogador) => !jogador.primeiroTurnoPendente),
    'os 4 Primeiros Turnos encerraram',
  );
  assert.equal(
    estado.rodada,
    rodadaInicial + 1,
    'a rodada avançou sem nenhum turno em desistência',
  );

  // Continuação (rodada 2+): a partida pode estender-se além do teto — o
  // wander aleatório não tem objetivo e a terminação da PARTIDA não é
  // propriedade da FSM (medido: 26/50 execuções sem término em 4000 turnos,
  // com zero desistências). O que a correção garante é o avanço dos turnos:
  // (i) nenhuma desistência é rejeição de ação enumerada (DADOS_INVALIDOS) e
  // (ii) desistências não travam o jogo — sequências seguidas sem progresso
  // têm teto medido de 2 (300 execuções; teto de 10 = margem 5×), e a única
  // exceção observada é o livelock da Baixa toda iluminada (limitação
  // pré-existente da engine, teste :478 — desistências seguidas ≥ 292 SEMPRE
  // com o ator em Baixa Iluminação).
  let tentativas = 0;
  let foraDaVez = 0;
  let desistenciasSeguidas = 0;
  let atorEmBaixa = false;
  // Teto de travamento (medido, 300 execuções): sem progresso, o failsafe
  // desiste no máximo 2 vezes seguidas (o re-sorteio do turno recupera) —
  // sequência maior só ocorre com o ator em Baixa Iluminação, o livelock
  // documentado em :478. Fora dela, travamento é regressão.
  const falharSeTravado = () => {
    if (desistenciasSeguidas > 10 && !atorEmBaixa) {
      assert.fail(
        `travamento fora da Baixa: ${desistenciasSeguidas} desistências seguidas sem progresso`,
      );
    }
  };
  while (estado.resultado === null && tentativas < 400) {
    tentativas++;
    const ator = estado.jogadorAtivoId;
    const turno = executarTurnoDoBot(estado, ator);
    if (turno.motivo === 'fora_da_vez') {
      foraDaVez++;
      break;
    }
    if (turno.motivo === 'desistencia') {
      // Guarda da #341/#349: a FSM não enumera ação rejeitada pela engine.
      assert.notEqual(
        turno.codigoDaDesistencia,
        'DADOS_INVALIDOS',
        'desistência DADOS_INVALIDOS: ação enumerada rejeitada pela engine',
      );
      desistenciasSeguidas++;
      const jogador = estado.jogadores.find(
        (item) => item.jogadorId === ator,
      );
      atorEmBaixa = jogador?.emBaixaIluminacao ?? false;
      continue;
    }
    falharSeTravado();
    desistenciasSeguidas = 0;
    estado = turno.estado;
  }
  falharSeTravado();
  assert.equal(foraDaVez, 0, 'bot nunca perde a vez agindo nela');
});

test('prova dinâmica da Travessia: o bot atravessa em Baixa e conclui a cadeia sem rejeição (ADR-0017)', () => {
  // Par dinâmico do ramo (d) em bot.ts: a pendência com celulaAlvo fixado
  // nasce em atravessarOEscuroDaPartida (partida.ts) — gerarRecebidas nasce
  // com celulaAlvo nulo (peoes.ts) e o escolher de vaga fixa vaga e
  // célula-alvo JUNTAS (peoes.ts). Pela ADR-0017 / issue #377 (Opção B) esta
  // FSM EMITE atravessar_o_escuro em Baixa (uma ação por vaga escura) — aqui,
  // a prova dinâmica: percorrendo jogos de bots, toda ação enumerada segue
  // aceita pela engine (exatidão — nenhuma desistência DADOS_INVALIDOS) e a
  // cadeia da travessia (escolher → encaixar → mover → confirmar → encerrar)
  // conclui sem travar.
  //
  // A mesma varredura prova, por invariante de estados alcançados, os ramos
  // `[]` do review 2 #350 que não têm teste artesanal próprio:
  // (i) com Recebimento pendente, o Peão do ator está sobre uma Peça
  //     posicionada — o 4º ramo (pecaSobOPeao === undefined) não ocorre: o
  //     Recebimento só nasce com o Peão sobre Peça (Confirmação/Primeiro
  //     Turno/Travessia), mover/permanecer são rejeitados com recebidas pendentes
  //     (peoes.ts) e o encerrar com pendências também — as recebidas nunca
  //     sobrevivem ao fim do turno;
  // (ii) com Recebida fixada, o pecaSelecionadaId é o dela — o 1º ramo (guard
  //     defensivo com seleção divergente) não ocorre: a escolha da vaga fixa
  //     a seleção na Recebida (peoes.ts) e a desseleção é rejeitada com
  //     recebidas pendentes; a divergência só existe em estado artesanal
  //     (teste :655).
  for (let semente = 1; semente <= 25; semente++) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    let tentativas = 0;
    while (estado.resultado === null && tentativas < 400) {
      tentativas++;
      const ator = estado.jogadorAtivoId;
      for (const acao of acoesValidasDaSubfase(estado, ator)) {
        // Exatidão da FSM: toda ação enumerada é aceita pela engine.
        const tentativa = aplicarComandoDePartida(estado, acao, ator);
        assert.equal(
          tentativa.sucesso,
          true,
          `ação enumerada rejeitada: ${acao.tipo} (${tentativa.sucesso ? '' : tentativa.erro.codigo}, semente ${semente})`,
        );
      }
      const jogador = estado.jogadores.find(
        (item) => item.jogadorId === ator,
      );
      const fixada = estado.tabuleiro.recebidas.find(
        (item) => item.vaga !== null,
      );
      if (estado.tabuleiro.recebidas.length > 0) {
        assert.ok(
          jogador !== undefined &&
            estado.tabuleiro.peoes.some(
              (peao) =>
                peao.peaoId === jogador.peaoId &&
                peao.pecaId !== null &&
                estado.tabuleiro.posicionadas.some(
                  (peca) => peca.pecaId === peao.pecaId,
                ),
            ),
          `Peão do ator fora de Peça posicionada com Recebimento pendente (semente ${semente})`,
        );
      }
      if (fixada) {
        assert.equal(
          estado.tabuleiro.pecaSelecionadaId,
          fixada.pecaId,
          `pecaSelecionadaId diverge da Recebida fixada (semente ${semente})`,
        );
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

test('turno normal: após mover, só confirmar (movimento único, sem segundo mover)', () => {
  let estado = partidaEmRodada2();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Re-seleção do Peão: semântica única da Movimentação — ver o fechamento do
  // moverPeaoDaPartida em partida.ts (#334).
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  // O mover re-seleciona o Peão (semântica única, issue #334): sem
  // re-seleção intermediária, a FSM já propõe a confirmação.
  assert.equal(estado.tabuleiro.peaoSelecionadoId, 'peao-branco');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, [
    { tipo: 'confirmar_posicao_do_peao', peaoId: 'peao-branco' },
  ]);
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

// ADR-0017 / issue #377 (Opção B) — o bot em Baixa atravessa o Escuro.
// Fixture: ana em Baixa com o peão sobre a cruz em (3,0), escuridão total e
// sem pendências — o turno abre na seleção do peão (ramo d).

function estadoDaBaixaSemPendencias(): EstadoDaPartida {
  const base = estadoDaBaixa(recebidaBaixa, []);
  assert.equal(base.jogadorAtivoId, 'ana');
  return {
    ...base,
    pecaDoInicioDoTurnoId: 'peca-controle',
    tabuleiro: { ...base.tabuleiro, recebidas: [] },
  };
}

test('bot em Baixa enumera atravessar_o_escuro, uma ação por vaga escura (ADR-0017)', () => {
  let estado = estadoDaBaixaSemPendencias();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  const travessias = acoes.filter((a) => a.tipo === 'atravessar_o_escuro');
  // Cruz em (3,0) com escuridão total no snapshot, mas a iluminação FRESCA
  // (mesmo preamble da engine) ilumina o norte (2,0) pela abertura da
  // própria cruz — restam 3 vagas escuras: leste (3,1), sul (4,0) e oeste
  // toroidal (3,6). A enumeração é exata com a engine.
  assert.equal(travessias.length, 3);
  assert.deepEqual(
    travessias
      .map((a) =>
        a.tipo === 'atravessar_o_escuro'
          ? `${a.celula.linha},${a.celula.coluna}`
          : null,
      )
      .sort(),
    ['3,1', '3,6', '4,0'],
  );
  assert.ok(
    acoes.some((a) => a.tipo === 'permanecer' && a.peaoId === 'peao-branco'),
  );
  // Exatidão: toda travessia enumerada é aceita pela engine.
  for (const acao of travessias) {
    const tentativa = aplicarComandoDePartida(estado, acao, 'ana');
    assert.equal(tentativa.sucesso, true);
  }
});

test('bot em Baixa com Caixa vazia não enumera atravessar_o_escuro (ADR-0018, M4)', () => {
  let estado = estadoDaBaixaSemPendencias();
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [],
      // Evita a derrota caixa_esgotada: objetivos atingíveis posicionados
      // (mesmo padrão de partida.test.ts "avancarVez em Baixa com caixa vazia").
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
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  // Caixa vazia não é erro na engine (travessia fantasma = no-op), mas o bot
  // não desperdiça passos: sem travessia enumerada, segue por permanência.
  assert.ok(acoes.every((a) => a.tipo !== 'atravessar_o_escuro'));
  assert.ok(
    acoes.some((a) => a.tipo === 'permanecer' && a.peaoId === 'peao-branco'),
  );
});

test('bot após atravessar não enumera nova travessia nem permanência (mover compulsório, ADR-0017)', () => {
  let estado = estadoDaBaixaSemPendencias();
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  const travessia = acoes.find((a) => a.tipo === 'atravessar_o_escuro');
  assert.ok(travessia);
  estado = aplicar(estado, travessia, 'ana');
  assert.equal(estado.atravessouNoTurno, true);
  const alvoTravessia = estado.tabuleiro.recebidas[0].celulaAlvo;
  assert.ok(alvoTravessia !== null);
  // Resolve a pendência travada seguindo a FSM como o driver (ramo b:
  // escolher a borda travada → girar até conectar → encaixar).
  let guard = 0;
  while (estado.tabuleiro.recebidas.length > 0 && guard++ < 10) {
    const sub = acoesValidasDaSubfase(estado, 'ana');
    assert.ok(sub.length > 0);
    const cmd =
      sub.find((a) => a.tipo === 'escolher_vaga_da_peca_recebida') ??
      sub.find((a) => a.tipo === 'posicionar_peca') ??
      sub[0];
    estado = aplicar(estado, cmd, 'ana');
  }
  assert.equal(estado.tabuleiro.recebidas.length, 0);
  // Ramo (d) pós-travessia: mover (inclui a peça colocada na célula da
  // travessia) e confirmar depois; sem nova travessia e sem permanência
  // (a engine rejeitaria ambas).
  const depois = acoesValidasDaSubfase(estado, 'ana');
  assert.ok(depois.length >= 1);
  assert.ok(depois.every((a) => a.tipo === 'mover_peao'));
  assert.ok(
    depois.some(
      (a) =>
        a.tipo === 'mover_peao' &&
        a.celula.linha === alvoTravessia.linha &&
        a.celula.coluna === alvoTravessia.coluna,
    ),
  );
});

test('bot em Baixa atravessa para Monstro e fecha o turno por Permanência (ADR-0017)', () => {
  let estado = estadoDaBaixaSemPendencias();
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
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const pre = acoesValidasDaSubfase(estado, 'ana');
  const travessia = pre.find((a) => a.tipo === 'atravessar_o_escuro');
  assert.ok(travessia);
  estado = aplicar(estado, travessia, 'ana');
  assert.equal(estado.atravessouNoTurno, true);
  // Resolve a pendência travada (a recebida é o Monstro do topo da Caixa).
  let guard = 0;
  while (estado.tabuleiro.recebidas.length > 0 && guard++ < 10) {
    const sub = acoesValidasDaSubfase(estado, 'ana');
    assert.ok(sub.length > 0);
    const cmd =
      sub.find((a) => a.tipo === 'escolher_vaga_da_peca_recebida') ??
      sub.find((a) => a.tipo === 'posicionar_peca') ??
      sub[0];
    estado = aplicar(estado, cmd, 'ana');
  }
  assert.equal(estado.tabuleiro.recebidas.length, 0);
  assert.equal(estado.pecaDaTravessiaId ?? null, 'vulto-x');
  // Peão segue na Peça de início (cruz em (3,0)): sem mover (o vizinho é
  // Monstro) e sem nova travessia — a FSM enumera apenas a Permanência, que
  // a engine aceita (exceção monstro) e fecha o turno.
  const depois = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(depois, [{ tipo: 'permanecer', peaoId: 'peao-branco' }]);
  const permanencia = aplicarComandoDePartida(
    estado,
    { tipo: 'permanecer', peaoId: 'peao-branco' },
    'ana',
  );
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.equal(permanencia.estado.jogadorAtivoId, 'bruno');
  assert.equal(permanencia.estado.atravessouNoTurno, false);
});

test('bot conclui a cadeia da travessia até o encerramento (ADR-0017)', () => {
  const estado = estadoDaBaixaSemPendencias();
  const turno = executarTurnoDoBot(estado, 'ana', {
    maxActionsPerTurn: 20,
    sortear: <T>(opcoes: readonly T[]): T => {
      const atravessar = opcoes.find(
        (acao) => (acao as unknown as ComandoDePartida).tipo === 'atravessar_o_escuro',
      );
      return (atravessar ?? opcoes[0]) as T;
    },
  });
  assert.equal(turno.motivo, 'encerramento');
  const tipos = turno.acoesExecutadas.map((a) => a.tipo);
  assert.ok(tipos.includes('atravessar_o_escuro'));
  assert.ok(tipos.includes('mover_peao'));
  assert.ok(tipos.includes('confirmar_posicao_do_peao'));
  assert.equal(turno.estado.jogadorAtivoId, 'bruno');
});

test('toda ação enumerada é aceita pela engine (exatidão da FSM)', () => {
  // 25 sementes: o caminho do bug da #341 era seed-dependente (bot em Baixa
  // Iluminação com vaga candidata iluminada) e escapava de amostras curtas.
  // posicionar_peca é verificado via expandirPosicionamentoDoBot (caminho real
  // do driver, ADR-0011): o cru pode rejeitar por MOVIMENTO_NAO_CONECTADO.
  for (let semente = 1; semente <= 25; semente++) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    for (let passo = 0; passo < 40; passo++) {
      if (estado.resultado !== null) break;
      const ator = estado.jogadorAtivoId;
      const acoes = acoesValidasDaSubfase(estado, ator);
      for (const acao of acoes) {
        const sequencia =
          acao.tipo === 'posicionar_peca'
            ? expandirPosicionamentoDoBot(estado, acao)
            : [acao];
        let cursor = estado;
        for (const passoSequencia of sequencia) {
          const resultado = aplicarComandoDePartida(
            cursor,
            passoSequencia,
            ator,
          );
          assert.equal(
            resultado.sucesso,
            true,
            `ação enumerada rejeitada: ${JSON.stringify(acao)} (${
              resultado.sucesso ? '' : resultado.erro.codigo
            })`,
          );
          if (resultado.sucesso) cursor = resultado.estado;
        }
      }
      if (acoes.length === 0) break;
      const sorteada = sortearAcao(acoes);
      if (sorteada.tipo === 'posicionar_peca') {
        for (const passoSequencia of expandirPosicionamentoDoBot(
          estado,
          sorteada,
        )) {
          estado = aplicar(estado, passoSequencia, ator);
        }
      } else {
        estado = aplicar(estado, sorteada, ator);
      }
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
      const sequencia =
        comando.tipo === 'posicionar_peca'
          ? expandirPosicionamentoDoBot(estado, comando)
          : [comando];
      let ok = true;
      for (const passoSequencia of sequencia) {
        const resultado = aplicarComandoDePartida(
          estado,
          passoSequencia,
          ator,
        );
        assert.equal(resultado.sucesso, true);
        if (!resultado.sucesso) {
          ok = false;
          break;
        }
        estado = resultado.estado;
      }
      if (!ok) break;
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

test('movimento único: bot nunca encadeia 2 movers no mesmo turno', () => {
  for (let semente = 1; semente <= 50; semente++) {
    let estado = partidaEmRodada2(semente);
    const ator = estado.jogadorAtivoId;
    const turno = executarTurnoDoBot(estado, ator, {
      // Sorteio que prefere mover sempre que possível: sem o fix, vagaria.
      sortear: <T>(opcoes: readonly T[]): T => {
        const mover = opcoes.find(
          (acao) =>
            (acao as unknown as ComandoDePartida).tipo === 'mover_peao',
        );
        const primeira = mover ?? opcoes[0];
        if (primeira === undefined) {
          throw new Error('sem ações');
        }
        return primeira;
      },
    });
    const movers = turno.acoesExecutadas.filter(
      (acao) => acao.tipo === 'mover_peao',
    ).length;
    assert.ok(
      movers <= 1,
      `semente ${semente}: bot moveu ${movers}x no mesmo turno`,
    );
    assert.notEqual(
      turno.motivo,
      'desistencia',
      `semente ${semente}: bot desistiu (${turno.codigoDaDesistencia})`,
    );
  }
});

test('failsafe: sem ação dentro do teto, forçado sem confirmação desiste', () => {
  const estado = partidaEmRodada2();
  const resultado = executarTurnoDoBot(estado, 'ana', {
    maxActionsPerTurn: 0,
  });
  assert.equal(resultado.motivo, 'desistencia');
  assert.equal(resultado.codigoDaDesistencia, 'ENCERRAMENTO_INVALIDO');
  assert.deepEqual(resultado.acoesExecutadas, []);
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

test('orientacaoConectaComGeradora exige a borda oposta à vaga', () => {
  // Reta base norte+sul; vaga norte = peça ao norte da geradora, que precisa
  // do sul aberto.
  assert.equal(orientacaoConectaComGeradora('reta', 0, 'norte'), true);
  assert.equal(orientacaoConectaComGeradora('reta', 90, 'norte'), false);
  assert.equal(orientacaoConectaComGeradora('reta', 180, 'norte'), true);
  assert.equal(orientacaoConectaComGeradora('reta', 90, 'leste'), true);
  assert.equal(orientacaoConectaComGeradora('reta', 0, 'leste'), false);
  // Inicial base norte+leste; vaga norte precisa do sul.
  assert.equal(orientacaoConectaComGeradora('inicial', 0, 'norte'), false);
  assert.equal(orientacaoConectaComGeradora('inicial', 90, 'norte'), true);
  // Cruz conecta em qualquer orientação e vaga.
  for (const orientacao of [0, 90, 180, 270] as const) {
    for (const vaga of ['norte', 'leste', 'sul', 'oeste'] as const) {
      assert.equal(
        orientacaoConectaComGeradora('cruz', orientacao, vaga),
        true,
      );
    }
  }
});

function primeiroTurnoAteRecebidas(
  seed: number,
): { estado: EstadoDaPartida; ator: string } {
  let estado = partidaIniciadaCom(JOGADORES, seed);
  const ator = estado.jogadorAtivoId;
  const jogador = estado.jogadores.find((item) => item.jogadorId === ator);
  if (!jogador) {
    throw new Error('Partida sem Jogador Ativo');
  }
  estado = aplicar(estado, selecionarPeca(`inicial-${jogador.ordem}`), ator);
  estado = aplicar(estado, posicionarPeca(`inicial-${jogador.ordem}`, 3, 3), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, 3, 3),
    ator,
  );
  assert.ok(estado.tabuleiro.recebidas.length > 0);
  return { estado, ator };
}

test('expandirPosicionamentoDoBot filtra pelos rótulos que conectam', () => {
  // Força uma reta como primeira recebida para determinismo.
  let achou = false;
  for (let seed = 1; seed <= 500 && !achou; seed++) {
    let { estado, ator } = primeiroTurnoAteRecebidas(seed);
    const indice = estado.tabuleiro.recebidas.findIndex(
      (item) => item.tipo === 'reta',
    );
    if (indice === -1) {
      continue;
    }
    achou = true;
    const recebida = estado.tabuleiro.recebidas[indice];
    estado = aplicar(estado, escolherVaga(recebida.recebidaId, 'norte'), ator);
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === recebida.recebidaId,
    );
    assert.ok(escolhida && escolhida.celulaAlvo);
    const comando = {
      tipo: 'posicionar_peca',
      pecaId: escolhida.pecaId,
      celula: escolhida.celulaAlvo,
    } as const;
    // Reta em 0° com vaga norte: orientações válidas 0° e 180°; rótulos
    // válidos manter, horario_2x e anti_horario_2x.
    const primeira = <T>(acoes: readonly T[]): T => {
      if (acoes.length === 0) {
        throw new Error('sem ações');
      }
      return acoes[0] as T;
    };
    assert.deepEqual(expandirPosicionamentoDoBot(estado, comando, primeira), [
      comando,
    ]);
    const ultima = <T>(acoes: readonly T[]): T => {
      if (acoes.length === 0) {
        throw new Error('sem ações');
      }
      return acoes[acoes.length - 1] as T;
    };
    assert.deepEqual(expandirPosicionamentoDoBot(estado, comando, ultima), [
      { tipo: 'girar_peca', pecaId: escolhida.pecaId, sentido: 'anti_horario' },
      { tipo: 'girar_peca', pecaId: escolhida.pecaId, sentido: 'anti_horario' },
      comando,
    ]);
  }
  assert.ok(achou, 'nenhuma seed sorteou reta como recebida');
});

test('expandirPosicionamentoDoBot passa intacta peça simétrica ou não selecionada', () => {
  let achouSimetrica = false;
  for (let seed = 1; seed <= 500 && !achouSimetrica; seed++) {
    let { estado, ator } = primeiroTurnoAteRecebidas(seed);
    const indice = estado.tabuleiro.recebidas.findIndex((item) =>
      ['cruz', 'gerador', 'sala_do_diretor', 'sala_medica',
        'portao_de_saida', 'vulto', 'espectro'].includes(item.tipo),
    );
    if (indice === -1) {
      continue;
    }
    achouSimetrica = true;
    const recebida = estado.tabuleiro.recebidas[indice];
    estado = aplicar(estado, escolherVaga(recebida.recebidaId, 'norte'), ator);
    const escolhida = estado.tabuleiro.recebidas.find(
      (item) => item.recebidaId === recebida.recebidaId,
    );
    assert.ok(escolhida && escolhida.celulaAlvo);
    const comando = {
      tipo: 'posicionar_peca',
      pecaId: escolhida.pecaId,
      celula: escolhida.celulaAlvo,
    } as const;
    assert.deepEqual(expandirPosicionamentoDoBot(estado, comando), [comando]);
  }
  assert.ok(achouSimetrica, 'nenhuma seed sorteou peça simétrica');
  // Peça não selecionada: giro seria PECA_NAO_SELECIONADA — passa intacta.
  const { estado, ator } = primeiroTurnoAteRecebidas(42);
  void ator;
  const semSelecao: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, pecaSelecionadaId: null },
  };
  const recebida = semSelecao.tabuleiro.recebidas[0];
  assert.ok(recebida);
  const comando = {
    tipo: 'posicionar_peca',
    pecaId: recebida.pecaId,
    celula: { linha: 2, coluna: 3 },
  } as const;
  assert.deepEqual(expandirPosicionamentoDoBot(semSelecao, comando), [comando]);
});

test('giro do bot: todo encaixe de Recebida conecta com a geradora', () => {
  // Escopo: Primeiros Turnos (sem Baixa Iluminação — o bot nunca tratou a
  // restrição de vaga escura do Recebimento em Baixa, limitação prévia fora
  // deste fix; o teste de jogo completo tolera desistencia nesses casos).
  for (let semente = 1; semente <= 40; semente++) {
    let estado = partidaIniciadaCom(JOGADORES, semente);
    for (let turno = 0; turno < 4; turno++) {
      const ator = estado.jogadorAtivoId;
      const resultado = executarTurnoDoBot(estado, ator);
      assert.equal(
        resultado.motivo,
        'encerramento',
        `semente ${semente}: bot desistiu (${resultado.codigoDaDesistencia})`,
      );
      let cursor = estado;
      for (const acao of resultado.acoesExecutadas) {
        if (acao.tipo === 'posicionar_peca') {
          const recebida = cursor.tabuleiro.recebidas.find(
            (item) => item.pecaId === acao.pecaId,
          );
          if (recebida && recebida.vaga !== null) {
            assert.equal(
              orientacaoConectaComGeradora(
                recebida.tipo,
                recebida.orientacao,
                recebida.vaga,
              ),
              true,
              `semente ${semente}: ${recebida.pecaId} encaixada sem conexão`,
            );
          }
        }
        cursor = aplicar(cursor, acao, ator);
      }
      estado = resultado.estado;
    }
  }
});

test('giro do bot: girar_peca precede o encaixe e a Inicial varia entre partidas', () => {
  let turnosComGiro = 0;
  const orientacoesDaInicial = new Set<number>();
  for (let semente = 1; semente <= 60; semente++) {
    const estado = partidaIniciadaCom(JOGADORES, semente);
    const ator = estado.jogadorAtivoId;
    const resultado = executarTurnoDoBot(estado, ator);
    assert.equal(resultado.motivo, 'encerramento');
    const acoes = resultado.acoesExecutadas;
    if (acoes.some((acao) => acao.tipo === 'girar_peca')) {
      turnosComGiro++;
    }
    for (let i = 0; i < acoes.length; i++) {
      const acao = acoes[i];
      if (acao?.tipo === 'girar_peca') {
        const proxima = acoes[i + 1];
        assert.ok(
          proxima &&
            ((proxima.tipo === 'girar_peca' &&
              proxima.pecaId === acao.pecaId) ||
              (proxima.tipo === 'posicionar_peca' &&
                proxima.pecaId === acao.pecaId)),
          'giro deve ser seguido do giro seguinte ou do encaixe da mesma peça',
        );
      }
    }
    const inicial = resultado.estado.tabuleiro.posicionadas.find(
      (peca) => peca.pecaId === 'inicial-1',
    );
    assert.ok(inicial, 'Inicial deveria estar posicionada');
    orientacoesDaInicial.add(inicial.orientacao);
  }
  assert.ok(turnosComGiro > 0, 'bot deveria girar em ao menos um turno');
  assert.ok(
    orientacoesDaInicial.size >= 2,
    `Inicial deveria variar a orientação: ${[...orientacoesDaInicial]}`,
  );
});

test('recebimento_gerado carrega a orientação de nascimento (contrato do espelho)', () => {
  let estado = partidaIniciadaCom(JOGADORES, 11);
  const ator = estado.jogadorAtivoId;
  const jogador = estado.jogadores.find((item) => item.jogadorId === ator);
  assert.ok(jogador);
  estado = aplicar(estado, selecionarPeca(`inicial-${jogador.ordem}`), ator);
  estado = aplicar(
    estado,
    posicionarPeca(`inicial-${jogador.ordem}`, 3, 3),
    ator,
  );
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao(jogador.peaoId, 3, 3),
    ator,
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) {
    throw new Error('inacessível');
  }
  const evento = resultado.eventos.find(
    (item) => item.tipo === 'recebimento_gerado',
  );
  assert.ok(evento, 'posicionar o peão gera recebimento_gerado');
  assert.ok(evento.tipo === 'recebimento_gerado');
  assert.ok(evento.recebidas.length > 0);
  // Regressão: sem a orientação no evento o espelho do bot guardava
  // `undefined` e a expansão nunca girava a Recebida (só a Inicial girava).
  for (const recebida of evento.recebidas) {
    assert.equal(recebida.orientacao, 0);
  }
});
