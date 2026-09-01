import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSICAO_DA_CAIXA,
  aplicarComandoDePartida,
  aplicarComandoDeTabuleiro,
  bordasAbertas,
  ehPecaDeMonstro,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  vizinhasConectadas,
  type BordaCardinal,
  type CodigoDeErroDeTabuleiro,
  type ComandoDePartida,
  type ComandoDeTabuleiro,
  type EstadoDaPartida,
  type EstadoDoTabuleiro,
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

const girar = (pecaId: string) =>
  ({ tipo: 'girar_peca', pecaId, sentido: 'horario' } as const);

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

function codigoDaRejeicao(
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

// Peão branco selecionado sobre a Peça Inicial em (3,3), com a pendência do
// monstro vulto-1 (vaga ainda nula) e a Caixa sem ele — literal do estado no
// padrão de peoes.test.ts: desde a ST-11, a seleção não gera mais
// Recebimento, a geração pertence à camada da Partida.
function estadoComMonstroPendente(): EstadoDoTabuleiro {
  let estado = aplicarTabuleiro(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicarTabuleiro(estado, posicionar('inicial-1', 3, 3));
  estado = aplicarTabuleiro(estado, selecionarPeao('peao-branco'));
  estado = aplicarTabuleiro(estado, posicionarPeao('peao-branco', 3, 3));
  return {
    ...estado,
    peaoSelecionadoId: 'peao-branco',
    caixa: estado.caixa.filter((peca) => peca.pecaId !== 'vulto-1'),
    recebidas: [
      {
        recebidaId: 'recebida-vulto-1',
        pecaId: 'vulto-1',
        tipo: 'vulto',
        orientacao: 0,
        vaga: null,
        celulaAlvo: null,
      },
    ],
  };
}

// Partida com a Caixa reordenada: o vulto-1 vai para a frente do sorteio, para
// que o Recebimento o retire primeiro — o resto permanece na ordem de
// composição.
function comVultoPrimeiroNaCaixa(estado: EstadoDaPartida): EstadoDaPartida {
  const caixa = estado.tabuleiro.caixa;
  const vulto1 = caixa.find((peca) => peca.pecaId === 'vulto-1');
  if (!vulto1) {
    throw new Error('vulto-1 deveria estar na Caixa');
  }
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      caixa: [vulto1, ...caixa.filter((peca) => peca.pecaId !== 'vulto-1')],
    },
  };
}

// Injetor de estado no padrão de partida.test.ts: adiciona um monstro
// posicionado fora da iluminação do Peão.
function comMonstroFora(
  estado: EstadoDaPartida,
  pecaId: string,
  linha: number,
  coluna: number,
): EstadoDaPartida {
  return {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas,
        { pecaId, tipo: 'vulto', orientacao: 0, celula: { linha, coluna } },
      ],
    },
  };
}

test('a composição da caixa inclui 6 vultos e 6 espectros entre as demais', () => {
  const vulto = COMPOSICAO_DA_CAIXA.find((entrada) => entrada.tipo === 'vulto');
  const espectro = COMPOSICAO_DA_CAIXA.find(
    (entrada) => entrada.tipo === 'espectro',
  );
  assert.equal(vulto?.quantidade, 6);
  assert.equal(espectro?.quantidade, 6);

  const estado = estadoInicialDoTabuleiro();
  assert.equal(estado.caixa.filter((peca) => peca.tipo === 'vulto').length, 6);
  assert.equal(
    estado.caixa.filter((peca) => peca.tipo === 'espectro').length,
    6,
  );
  // Ids determinísticos por tipo, no mesmo padrão das demais peças.
  const ids = new Set(estado.caixa.map((peca) => peca.pecaId));
  assert.ok(ids.has('vulto-1'));
  assert.ok(ids.has('vulto-6'));
  assert.ok(ids.has('espectro-1'));
  assert.ok(ids.has('espectro-6'));
});

test('monstros embaralhados: a mesma seed produz exatamente a mesma ordem da caixa', () => {
  const primeira = estadoInicialDoTabuleiro({ seed: 20260901 });
  const segunda = estadoInicialDoTabuleiro({ seed: 20260901 });

  assert.equal(primeira.caixa.length, 83);
  assert.deepEqual(
    primeira.caixa.map((peca) => peca.pecaId),
    segunda.caixa.map((peca) => peca.pecaId),
  );
  // A composição é preservada: os 12 monstros continuam no embaralhamento.
  assert.equal(primeira.caixa.filter((peca) => peca.tipo === 'vulto').length, 6);
  assert.equal(
    primeira.caixa.filter((peca) => peca.tipo === 'espectro').length,
    6,
  );
});

test('monstros têm as quatro bordas abertas em qualquer orientação', () => {
  for (const tipo of ['vulto', 'espectro'] as const) {
    for (const orientacao of [0, 90, 180, 270] as const) {
      assert.deepEqual(
        bordasAbertas({ tipo, orientacao }),
        ['norte', 'leste', 'sul', 'oeste'],
        `${tipo} em ${orientacao} deve ter as quatro bordas abertas`,
      );
    }
  }
  // O predicado identifica a categoria própria (fora de TipoDePecaEspecial).
  assert.equal(ehPecaDeMonstro('vulto'), true);
  assert.equal(ehPecaDeMonstro('espectro'), true);
  assert.equal(ehPecaDeMonstro('gerador'), false);
  assert.equal(ehPecaDeMonstro('reta'), false);
  assert.equal(ehPecaDeMonstro('inicial'), false);
});

test('sorteio e encaixe de monstro geram apenas eventos padrão, sem ataque', () => {
  const inicio = estadoInicialDaPartida(JOGADORES);
  assert.equal(inicio.sucesso, true);
  if (!inicio.sucesso) return;
  let estado = comVultoPrimeiroNaCaixa(inicio.estado);
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  // O Recebimento do Primeiro Turno sorteia o vulto-1 (gerarRecebidas, seam
  // da camada da Partida): a primeira pendência é a do Monstro.
  const encaixeDoPeao = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(encaixeDoPeao.sucesso, true);
  if (!encaixeDoPeao.sucesso) return;
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas[0].tipo, 'vulto');
  assert.equal(encaixeDoPeao.estado.tabuleiro.recebidas[0].pecaId, 'vulto-1');
  const sorteada = encaixeDoPeao.eventos.find(
    (evento) => evento.tipo === 'peca_sorteada' && evento.pecaId === 'vulto-1',
  );
  assert.ok(sorteada, 'esperava peca_sorteada do vulto-1');

  // O lote do posicionamento contém apenas os eventos padrão (peao_posicionado,
  // peca_sorteada, recebimento_gerado, celulas_iluminadas) — nenhum de ataque.
  const padrao = new Set([
    'peao_posicionado',
    'peca_sorteada',
    'recebimento_gerado',
    'celulas_iluminadas',
    'limpeza_aplicada',
  ]);
  assert.ok(
    encaixeDoPeao.eventos.every((evento) => padrao.has(evento.tipo)),
    `lote do posicionamento com eventos fora do padrão: ${encaixeDoPeao.eventos.map((e) => e.tipo).join(', ')}`,
  );
  estado = encaixeDoPeao.estado;

  // O Jogador escolhe a vaga do Monstro (norte da Inicial, célula (2,3)) e o
  // encaixa — a mesma sequência de uma peça comum, sem ataque: o desencadeador
  // é apenas o conjunto de eventos padrão do encaixe.
  const escolha = aplicarComandoDePartida(
    estado,
    escolherVaga('recebida-vulto-1', 'norte'),
    'ana',
  );
  assert.equal(escolha.sucesso, true);
  if (!escolha.sucesso) return;
  assert.deepEqual(escolha.eventos, [
    {
      tipo: 'vaga_da_peca_recebida_escolhida',
      recebidaId: 'recebida-vulto-1',
      borda: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
    },
  ]);
  estado = escolha.estado;

  const encaixeDoMonstro = aplicarComandoDePartida(
    estado,
    posicionar('vulto-1', 2, 3),
    'ana',
  );
  assert.equal(encaixeDoMonstro.sucesso, true);
  if (!encaixeDoMonstro.sucesso) return;
  // Peão em (3,3) e Monstro em (2,3): vizinhos conectados (o Peão está "dentro
  // do raio"), e ainda assim o encaixe emite apenas peca_posicionada.
  assert.deepEqual(encaixeDoMonstro.eventos, [
    {
      tipo: 'peca_posicionada',
      pecaId: 'vulto-1',
      celula: { linha: 2, coluna: 3 },
      orientacao: 0,
    },
  ]);
});

test('monstro encaixado não abre janela de Manipulação e não pode ser girado', () => {
  let estado = estadoComMonstroPendente();

  const escolha = aplicarComandoDeTabuleiro(
    estado,
    escolherVaga('recebida-vulto-1', 'norte'),
  );
  assert.equal(escolha.sucesso, true);
  if (!escolha.sucesso) return;
  estado = escolha.estado;

  const encaixe = aplicarComandoDeTabuleiro(
    estado,
    posicionar('vulto-1', 2, 3),
  );
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  assert.deepEqual(encaixe.eventos, [
    {
      tipo: 'peca_posicionada',
      pecaId: 'vulto-1',
      celula: { linha: 2, coluna: 3 },
      orientacao: 0,
    },
  ]);
  // A regra "sem janela de Manipulação" vale apenas para Monstros neste
  // ticket: Peças Especiais continuam abrindo a janela normalmente.
  assert.equal(encaixe.estado.pecaEmManipulacaoId, null);

  // Sem janela aberta, girar a peça posicionada é recusado — código fechado
  // existente, nenhum código de erro novo.
  assert.equal(
    codigoDaRejeicao(encaixe.estado, girar('vulto-1')),
    'MANIPULACAO_ENCERRADA',
  );
});

test('mover_peao para monstro conectado é rejeitado com PECA_JA_TEM_PEAO', () => {
  let estado = aplicarTabuleiro(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicarTabuleiro(estado, posicionar('inicial-1', 3, 3));
  estado = aplicarTabuleiro(estado, selecionarPeao('peao-branco'));
  estado = aplicarTabuleiro(estado, posicionarPeao('peao-branco', 3, 3));
  // Monstro posicionado na vizinhança conectada da Peça do Peão (norte da
  // Inicial; as quatro bordas abertas garantem a conexão).
  estado = {
    ...estado,
    posicionadas: [
      ...estado.posicionadas,
      {
        pecaId: 'vulto-1',
        tipo: 'vulto',
        orientacao: 0,
        celula: { linha: 2, coluna: 3 },
      },
    ],
    peaoSelecionadoId: 'peao-branco',
    recebidas: [],
  };
  assert.ok(
    vizinhasConectadas(estado, 'inicial-1').some(
      (peca) => peca.pecaId === 'vulto-1',
    ),
    'o Monstro deveria estar conectado à Peça do Peão',
  );

  const antes = estado;
  const resultado = aplicarComandoDeTabuleiro(
    estado,
    moverPeao('peao-branco', 2, 3),
  );
  assert.equal(resultado.sucesso, false);
  if (resultado.sucesso) return;
  // Código fechado existente (precedente da ocupação da #176): nenhum código
  // de erro novo para Monstros.
  assert.equal(resultado.erro.codigo, 'PECA_JA_TEM_PEAO');
  assert.equal(
    resultado.erro.mensagem,
    'A Peça de destino é um Monstro e não aceita Peão.',
  );
  assert.deepEqual(estado, antes);
});

test('limpeza remove monstro fora da iluminação sem retorno à Caixa', () => {
  const inicio = estadoInicialDaPartida(JOGADORES);
  assert.equal(inicio.sucesso, true);
  if (!inicio.sucesso) return;
  let estado = inicio.estado;
  const caixaAntes = estado.tabuleiro.caixa.length;
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  // Monstro fora da iluminação de (3,3).
  estado = comMonstroFora(estado, 'vulto-x', 0, 0);

  const resultado = aplicarComandoDePartida(
    estado,
    posicionarPeao('peao-branco', 3, 3),
    'ana',
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;

  const limpeza = resultado.eventos.find(
    (evento) => evento.tipo === 'limpeza_aplicada',
  );
  assert.ok(limpeza, 'esperava o evento limpeza_aplicada');
  if (limpeza.tipo !== 'limpeza_aplicada') return;
  assert.ok(limpeza.pecasRemovidas.includes('vulto-x'));
  assert.ok(
    !resultado.estado.tabuleiro.posicionadas.some(
      (peca) => peca.pecaId === 'vulto-x',
    ),
  );
  // Sem retorno à Caixa: o tamanho final reflete apenas o consumo do sorteio,
  // nunca uma reposição da peça removida (regra da issue #147).
  const recebimento = resultado.eventos.find(
    (evento) => evento.tipo === 'recebimento_gerado',
  );
  const desenhadas = recebimento
    ? (recebimento.recebidas as readonly unknown[]).length
    : 0;
  assert.equal(
    resultado.estado.tabuleiro.caixa.length,
    caixaAntes - desenhadas,
  );
});