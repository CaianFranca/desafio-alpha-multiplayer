import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  acoesValidasDaSubfase,
  aplicarComandoDePartida,
  bordasAbertas,
  estadoInicialDaPartida,
  executarTurnoDoBot,
  mapearBot,
  sortearAcao,
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

function partidaEmRodada2(seed?: number): EstadoDaPartida {
  let estado = partidaIniciadaCom(JOGADORES, seed);
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 0 });
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

// Pendência sintética do Recebimento (vaga e célula-alvo nulas até a escolha):
// o ramo (b) da FSM não lê o pecaId da pendência, então o valor é irrelevante
// para a enumeração.
const recebidaBaixa: PecaRecebida = {
  recebidaId: 'rec-baixa',
  pecaId: 'recebida-sintetica',
  tipo: 'reta',
  orientacao: 0,
  vaga: null,
  celulaAlvo: null,
};

// Cenário de Baixa Iluminação controlado (#341): ana em Baixa, com o Peão
// sobre uma Peça Cruz sintética em (3,0) — as células vizinhas norte (2,0),
// leste (3,1) e sul (4,0) estão vazias na Rodada 2 (longe das quatro
// Iniciais e das vagas que elas geram), e o oeste cai fora da grade — e a
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

test('subfase (b): após escolher a vaga, resta escolher ou encaixar', () => {
  let estado = partidaIniciadaCom(JOGADORES);
  estado = aplicar(estado, selecionarPeca('inicial-1'), 'ana');
  estado = aplicar(estado, posicionarPeca('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  const primeira = estado.tabuleiro.recebidas[0];
  assert.ok(primeira);
  estado = aplicar(estado, escolherVaga(primeira.recebidaId, 'norte'), 'ana');
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  const tipos = new Set(acoes.map((acao) => acao.tipo));
  assert.ok(tipos.has('posicionar_peca'));
  assert.ok(
    acoes.every(
      (acao) =>
        acao.tipo === 'posicionar_peca' ||
        acao.tipo === 'escolher_vaga_da_peca_recebida',
    ),
  );
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
  // A vaga norte (2,0) da Peça controle está iluminada; leste e sul seguem
  // escuras — a engine rejeita a iluminada com DADOS_INVALIDOS.
  const estado = estadoDaBaixa(recebidaBaixa, [{ linha: 2, coluna: 0 }]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  // Conjunto de bordas enumeradas é exatamente o das vagas escuras — nenhuma
  // ação mira célula iluminada.
  assert.deepEqual(acoes, [
    escolherVaga('rec-baixa', 'leste'),
    escolherVaga('rec-baixa', 'sul'),
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
  // Todas as três vagas da Peça controle iluminadas: a pendência comum fica
  // irresolúvel e o ramo não emite escolher_vaga — lista vazia. No driver,
  // isso desdobra em desistência honesta via failsafe (o encerrar_turno
  // forçado cai em PENDENCIA_NAO_RESOLVIDA); pendência irresolúvel em Baixa é
  // limitação pré-existente da engine para humanos e bots, fora do escopo
  // desta correção.
  const estado = estadoDaBaixa(recebidaBaixa, [
    { linha: 2, coluna: 0 },
    { linha: 3, coluna: 1 },
    { linha: 4, coluna: 0 },
  ]);
  const acoes = acoesValidasDaSubfase(estado, 'ana');
  assert.deepEqual(acoes, []);
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
