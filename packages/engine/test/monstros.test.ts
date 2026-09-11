import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BORDA_OPOSTA,
  COMPOSICAO_DA_CAIXA,
  aplicarComandoDePartida,
  aplicarComandoDeTabuleiro,
  bordasAbertas,
  calcularAlcance,
  ehPecaDeMonstro,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  resolverAtaques,
  vizinhasConectadas,
  type AtaqueResolvidoEvento,
  type BordaCardinal,
  type CodigoDeErroDeTabuleiro,
  type ComandoDePartida,
  type ComandoDeTabuleiro,
  type EstadoDaPartida,
  type EstadoDoTabuleiro,
  type EventoDaPartida,
  type JogadorAlvoDoAtaque,
  type Orientacao,
  type PecaPosicionada,
  type TipoDaPeca,
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

const confirmarPosicao = (peaoId: string) =>
  ({ tipo: 'confirmar_posicao_do_peao', peaoId } as const);

const encerrarTurno = () => ({ tipo: 'encerrar_turno' } as const);

const permanecer = (peaoId: string) =>
  ({ tipo: 'permanecer', peaoId } as const);

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

// --- Fixtures do Alcance e do Ataque (issue #172) ---

// Peça posicionada avulsa para montar a topologia do Alcance à mão (mesmo
// padrão de peoes.test.ts nos testes de Conexão).
const peca = (
  pecaId: string,
  tipo: TipoDaPeca,
  orientacao: Orientacao,
  linha: number,
  coluna: number,
): PecaPosicionada => ({
  pecaId,
  tipo,
  orientacao,
  celula: { linha, coluna },
});

// Injetor de peça posicionada com orientação explícita (padrão de comMonstroFora).
function comPeca(
  estado: EstadoDaPartida,
  pecaId: string,
  tipo: TipoDaPeca,
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

// Reposiciona um Peão sobre a Peça indicada por injeção de estado: a camada
// da Partida só desloca peões por Conexão; os fixtures de ataque precisam
// pará-los diretamente sobre as peças do cenário.
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

// Extrai o ataque_resolvido do lote (undefined quando o gatilho não disparou).
function ataqueDoLote(
  eventos: readonly EventoDaPartida[],
): AtaqueResolvidoEvento | undefined {
  const ataque = eventos.find((evento) => evento.tipo === 'ataque_resolvido');
  return ataque?.tipo === 'ataque_resolvido' ? ataque : undefined;
}

function partidaIniciada(): EstadoDaPartida {
  const resultado = estadoInicialDaPartida(JOGADORES);
  if (!resultado.sucesso) {
    throw new Error('roster válido deveria iniciar a Partida');
  }
  return resultado.estado;
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

// Resolve as pendências do Recebimento (mesmo padrão de partida.test.ts):
// primeira borda canônica ainda disponível para a vaga, giro até a borda
// voltada à Peça sob o Peão abrir (encaixe conectado, issue #311 — Monstros
// têm as 4 bordas abertas e nunca giram) e encaixe na célula-alvo.
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
      posicionar(
        escolhida.pecaId,
        escolhida.celulaAlvo.linha,
        escolhida.celulaAlvo.coluna,
      ),
      ator,
    );
  }
  return estado;
}

// Primeiro Turno completo do Jogador Ativo (sem giros): Peça Inicial, Peão,
// Recebimento resolvido e Encerramento.
function concluirPrimeiroTurno(
  estado: EstadoDaPartida,
  celula: { linha: number; coluna: number },
): EstadoDaPartida {
  const ator = estado.jogadorAtivoId;
  const jogador = jogadorAtivo(estado);
  const pecaId = `inicial-${jogador.ordem}`;
  estado = aplicar(estado, selecionar(pecaId), ator);
  estado = aplicar(estado, posicionar(pecaId, celula.linha, celula.coluna), ator);
  estado = aplicar(estado, selecionarPeao(jogador.peaoId), ator);
  estado = aplicar(
    estado,
    posicionarPeao(jogador.peaoId, celula.linha, celula.coluna),
    ator,
  );
  estado = resolverRecebidas(estado, ator);
  return aplicar(estado, encerrarTurno(), ator);
}

// Partida em rodada 2 (vez de ana): peões em (3,3), (0,0), (6,6) e (1,0);
// reta-1..6 encaixadas nas vagas dos Primeiros Turnos — 2+2+1+1, como antes
// da grade toroidal (issue #260): a vaga norte de bruno envolve para (6,0)
// e a de diogo em (6,0) colidiria com ela, então diogo joga em (1,0) (só a
// vaga leste livre, norte ocupada pela inicial-2).
function partidaEmRodada2(): EstadoDaPartida {
  let estado = partidaIniciada();
  estado = concluirPrimeiroTurno(estado, { linha: 3, coluna: 3 });
  estado = concluirPrimeiroTurno(estado, { linha: 0, coluna: 0 });
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });
  return estado;
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

test('mover_peao para monstro é rejeitado com PECA_JA_TEM_PEAO (conectado ou não)', () => {
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

  // Monstro vizinho NÃO conectado (oeste da Inicial, borda fechada): a regra
  // absoluta "Monstro não aceita Peão" vence a conexão — mesma rejeição.
  const comMonstroOeste: EstadoDoTabuleiro = {
    ...estado,
    posicionadas: [
      ...estado.posicionadas,
      {
        pecaId: 'espectro-1',
        tipo: 'espectro',
        orientacao: 0,
        celula: { linha: 3, coluna: 2 },
      },
    ],
  };
  assert.ok(
    !vizinhasConectadas(comMonstroOeste, 'inicial-1').some(
      (peca) => peca.pecaId === 'espectro-1',
    ),
    'o Monstro a oeste deveria estar fora da conexão da Inicial',
  );
  const fora = aplicarComandoDeTabuleiro(
    comMonstroOeste,
    moverPeao('peao-branco', 3, 2),
  );
  assert.equal(fora.sucesso, false);
  if (fora.sucesso) return;
  assert.equal(fora.erro.codigo, 'PECA_JA_TEM_PEAO');
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

// --- Alcance (issue #172) ---

test('alcance do vulto: raios retos ortogonais encadeados por Conexão, distância ilimitada, com retransmissão de monstro (critério 1)', () => {
  const tabuleiro: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      peca('vulto-x', 'vulto', 0, 3, 3),
      // norte: encadeia três peças e envolve a borda — (0,3) conecta ao sul
      // aberto da reta-s2 em (6,3) (wrap toroidal, issue #260); o raio para
      // na célula vazia (5,3) logo depois.
      peca('reta-n1', 'reta', 0, 2, 3),
      peca('reta-n2', 'reta', 0, 1, 3),
      peca('reta-n3', 'reta', 0, 0, 3),
      // leste: o Espectro retransmite o raio como qualquer peça.
      peca('espectro-e', 'espectro', 0, 3, 4),
      peca('reta-l1', 'reta', 90, 3, 5),
      peca('reta-l2', 'reta', 90, 3, 6),
      // sul: a célula vazia (5,3) interrompe o raio sul; reta-s2 entra pelo
      // raio NORTE, via wrap da borda (ver acima).
      peca('reta-s1', 'reta', 0, 4, 3),
      peca('reta-s2', 'reta', 0, 6, 3),
      // oeste: a Inicial conecta (leste aberto) mas sua borda oeste é
      // fechada — o raio para nela; reta-o1 fica fora.
      peca('inicial-o', 'inicial', 0, 3, 2),
      peca('reta-o1', 'reta', 90, 3, 1),
      // diagonais ao vulto: nunca entram.
      peca('reta-d1', 'reta', 0, 2, 2),
      peca('reta-d2', 'reta', 0, 4, 4),
    ],
  };
  // Ordem determinística: por direção (norte, leste, sul, oeste) e distância
  // — reta-s2 vem no raio norte, após o wrap da borda (issue #260).
  assert.deepEqual(
    calcularAlcance(tabuleiro, 'vulto-x').map((peca) => peca.pecaId),
    [
      'reta-n1',
      'reta-n2',
      'reta-n3',
      'reta-s2',
      'espectro-e',
      'reta-l1',
      'reta-l2',
      'reta-s1',
      'inicial-o',
    ],
  );
});

test('calcularAlcance: peça inexistente ou não-monstro tem alcance vazio', () => {
  const tabuleiro: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [peca('reta-1', 'reta', 0, 3, 3)],
  };
  assert.deepEqual(calcularAlcance(tabuleiro, 'reta-1'), []);
  assert.deepEqual(calcularAlcance(tabuleiro, 'fantasma'), []);
});

test('alcance do espectro: apenas peças adjacentes conectadas nas quatro direções ortogonais (critério 2)', () => {
  const tabuleiro: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      peca('espectro-x', 'espectro', 0, 3, 3),
      // norte e leste conectam (borda oposta aberta).
      peca('reta-n', 'reta', 0, 2, 3),
      peca('t-l', 'T', 0, 3, 4),
      // sul: o T girado 180° tem a borda norte fechada — não conecta.
      peca('t-s', 'T', 180, 4, 3),
      // oeste conecta.
      peca('reta-o', 'reta', 90, 3, 2),
      // distância 2 e diagonais ficam fora.
      peca('reta-far', 'reta', 0, 1, 3),
      peca('cruz-d1', 'cruz', 0, 2, 2),
      peca('cruz-d2', 'cruz', 0, 2, 4),
      peca('cruz-d3', 'cruz', 0, 4, 4),
    ],
  };
  assert.deepEqual(
    calcularAlcance(tabuleiro, 'espectro-x').map((peca) => peca.pecaId),
    ['reta-n', 't-l', 'reta-o'],
  );
});

// --- Ataque (issue #172) ---

// Issue #236: a avaliação é centrada no atuante — mover e a movimentação
// desfeita não são gatilhos (só a decisão definitiva vale); a Permanência É
// gatilho, mas fora→fora é silêncio.
test('ataque é avaliado apenas nos gatilhos definitivos: mover e a movimentação desfeita não disparam; permanecer fora do alcance é silêncio (critério 3)', () => {
  let estado = partidaEmRodada2();
  // Espectro ao norte de reta-1 (2,3): mover para lá entra no alcance.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  // Movimentação tentativa (desfazível até a confirmação): nenhum ataque.
  const ida = aplicarComandoDePartida(estado, moverPeao('peao-branco', 2, 3), 'ana');
  assert.equal(ida.sucesso, true);
  if (!ida.sucesso) return;
  assert.equal(ataqueDoLote(ida.eventos), undefined);
  estado = ida.estado;

  // Desfeita pela conexão simétrica: nenhum ataque no retorno.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const volta = aplicarComandoDePartida(estado, moverPeao('peao-branco', 3, 3), 'ana');
  assert.equal(volta.sucesso, true);
  if (!volta.sucesso) return;
  assert.equal(ataqueDoLote(volta.eventos), undefined);
  estado = volta.estado;

  // Permanência com o peão na Peça do início do turno (inicial-1), FORA do
  // alcance: fora→fora é silêncio — mas o gatilho avalia e atualiza o
  // snapshot do Alcance (nenhum peão no alcance do espectro).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const permanencia = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.equal(ataqueDoLote(permanencia.eventos), undefined);
  assert.deepEqual(permanencia.estado.peoesNoAlcance, { 'espectro-x': [] });
});

test('ataque: entrada no alcance atinge todos os peões de jogadores dentro dele (critério 4)', () => {
  let estado = partidaEmRodada2();
  // Espectro em (1,3): reta-y (0,3) ao norte e reta-1 (2,3) ao sul conectadas.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  estado = comPeca(estado, 'reta-y', 'reta', 0, 0, 3);
  // Bruno (vermelho) já está dentro do alcance, parado sobre a reta-y.
  estado = comPeaoSobre(estado, 'peao-vermelho', 'reta-y');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  const ataque = ataqueDoLote(confirmado.eventos);
  assert.ok(ataque, 'a confirmação com entrada no alcance deveria disparar o ataque');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-branco', 'peao-vermelho'] },
  ]);
  // Todos os peões de jogadores dentro do alcance são atingidos — não só o
  // que entrou.
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco', 'peao-vermelho']);
  assert.deepEqual(ataque.protegidos, []);
  assert.deepEqual(confirmado.estado.peoesNoAlcance, {
    'espectro-x': ['peao-branco', 'peao-vermelho'],
  });
});

// Issue #236: a saída é gatilho do ATUANTE — bruno começa o turno na t-x
// (dentro do alcance, via Peça do início do turno) e confirma fora.
test('ataque: saída do alcance dispara sem atingir quem saiu e atingindo quem permanece (critério 4)', () => {
  let estado = partidaEmRodada2();
  // Espectro em (0,3): t-x (1,3) ao sul e reta-y (0,4) a leste conectadas;
  // reta-z (1,4) conecta à t-x para a saída de bruno.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 0, 3);
  estado = comPeca(estado, 't-x', 'T', 90, 1, 3);
  estado = comPeca(estado, 'reta-y', 'reta', 90, 0, 4);
  estado = comPeca(estado, 'reta-z', 'reta', 90, 1, 4);
  estado = comPeaoSobre(estado, 'peao-vermelho', 't-x');
  estado = comPeaoSobre(estado, 'peao-azul', 'reta-y');

  // Ana permanece fora do alcance: fora→fora é silêncio — a saída de bruno
  // é que dispara o ataque do espectro (issue #236).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const anaFora = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(anaFora.sucesso, true);
  if (!anaFora.sucesso) return;
  assert.equal(ataqueDoLote(anaFora.eventos), undefined);
  estado = anaFora.estado;

  // Bruno sai do alcance (t-x → reta-z): dispara, não atinge quem saiu e
  // atinge quem permanece (azul).
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, moverPeao('peao-vermelho', 1, 4), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const segundo = aplicarComandoDePartida(estado, confirmarPosicao('peao-vermelho'), 'bruno');
  assert.equal(segundo.sucesso, true);
  if (!segundo.sucesso) return;
  const ataque2 = ataqueDoLote(segundo.eventos);
  assert.ok(ataque2, 'a saída do alcance deveria disparar o ataque');
  if (!ataque2) return;
  assert.deepEqual(ataque2.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-azul'] },
  ]);
  assert.deepEqual(ataque2.peoesAtingidos, ['peao-azul']);
  assert.deepEqual(segundo.estado.peoesNoAlcance, { 'espectro-x': ['peao-azul'] });
});

test('ataque: saída com ninguém restante ainda dispara o ataque (critério 4 — mesmo que ninguém)', () => {
  let estado = partidaEmRodada2();
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 0, 3);
  estado = comPeca(estado, 't-x', 'T', 90, 1, 3);
  estado = comPeca(estado, 'reta-z', 'reta', 90, 1, 4);
  // reta-luz (0,2) ilumina o espectro de FORA do alcance (leste fechado).
  estado = comPeca(estado, 'reta-luz', 'reta', 0, 0, 2);
  estado = comPeaoSobre(estado, 'peao-vermelho', 't-x');
  estado = comPeaoSobre(estado, 'peao-azul', 'reta-luz');

  // Ana confirma fora→fora: silêncio — o peão de bruno (parado dentro do
  // alcance) não é avaliado por ação de terceiro (issue #236).
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const primeiro = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(primeiro.sucesso, true);
  if (!primeiro.sucesso) return;
  assert.equal(ataqueDoLote(primeiro.eventos), undefined, 'fora→fora do atuante é silêncio');
  assert.deepEqual(primeiro.estado.peoesNoAlcance, { 'espectro-x': ['peao-vermelho'] });
  estado = primeiro.estado;

  estado = aplicar(estado, encerrarTurno(), 'ana');

  // Bruno sai e não sobra ninguém no alcance: o ataque dispara mesmo assim.
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, moverPeao('peao-vermelho', 1, 4), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const segundo = aplicarComandoDePartida(estado, confirmarPosicao('peao-vermelho'), 'bruno');
  assert.equal(segundo.sucesso, true);
  if (!segundo.sucesso) return;
  const ataque2 = ataqueDoLote(segundo.eventos);
  assert.ok(ataque2, 'a saída deveria disparar o ataque mesmo sem atingidos');
  if (!ataque2) return;
  assert.deepEqual(ataque2.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: [] },
  ]);
  assert.deepEqual(ataque2.peoesAtingidos, []);
  assert.deepEqual(segundo.estado.peoesNoAlcance, { 'espectro-x': [] });
});

// Issue #236: o encaixe da Recebida estende o raio do Vulto sob o peão
// parado de ana sem disparar; o ataque acontece quando o ATUANTE age — a
// confirmação fora→fora de terceiro é silêncio (o peão parado não é atingido
// por ação alheia: bug #262 eliminado por construção).
test('posicionamento de peça que estende o alcance não dispara; o ataque ocorre quando o atuante age (critério 5)', () => {
  let estado = partidaEmRodada2();
  // Vulto em (0,3) com o raio sul bloqueado pela célula vazia (1,3); azul
  // ilumina o vulto de (0,2), fora do alcance dele (leste da luz fechado).
  estado = comPeca(estado, 'vulto-x', 'vulto', 0, 0, 3);
  estado = comPeca(estado, 'reta-luz', 'reta', 0, 0, 2);
  estado = comPeaoSobre(estado, 'peao-azul', 'reta-luz');

  // Gatilho 1 (ana confirma em reta-1): raio bloqueado — ana entra fora→fora,
  // sem ataque.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  assert.equal(ataqueDoLote(confirmado.eventos), undefined);
  assert.deepEqual(confirmado.estado.peoesNoAlcance, { 'vulto-x': [] });
  estado = confirmado.estado;

  // O Recebimento (reta-7, vaga norte) encaixa em (1,3) e estende o raio do
  // vulto até reta-1 — onde o peão de ana está PARADO. Escolha de vaga e
  // encaixe não são gatilhos: nenhum ataque.
  const recebida = estado.tabuleiro.recebidas[0];
  assert.equal(recebida.pecaId, 'reta-7');
  const escolha = aplicarComandoDePartida(
    estado,
    escolherVaga(recebida.recebidaId, 'norte'),
    'ana',
  );
  assert.equal(escolha.sucesso, true);
  if (!escolha.sucesso) return;
  assert.equal(ataqueDoLote(escolha.eventos), undefined);
  const encaixe = aplicarComandoDePartida(escolha.estado, posicionar('reta-7', 1, 3), 'ana');
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  assert.equal(ataqueDoLote(encaixe.eventos), undefined);
  estado = encaixe.estado;

  // Ana encerra; bruno e carla permanecem (fora→fora, silêncio); diogo move
  // e confirma FORA do alcance — silêncio: o peão parado de ana não é
  // atingido pela ação de terceiro.
  estado = aplicar(estado, encerrarTurno(), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, permanecer('peao-vermelho'), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-azul'), 'carla');
  estado = aplicar(estado, permanecer('peao-azul'), 'carla');
  estado = aplicar(estado, selecionarPeao('peao-amarelo'), 'diogo');
  // Diogo joga em (1,0) (fixture toroidal, ver partidaEmRodada2): move para a
  // própria recebida em (1,1), fora do alcance do vulto em (0,3).
  estado = aplicar(estado, moverPeao('peao-amarelo', 1, 1), 'diogo');
  estado = aplicar(estado, selecionarPeao('peao-amarelo'), 'diogo');
  const silencio = aplicarComandoDePartida(estado, confirmarPosicao('peao-amarelo'), 'diogo');
  assert.equal(silencio.sucesso, true);
  if (!silencio.sucesso) return;
  assert.equal(
    ataqueDoLote(silencio.eventos),
    undefined,
    'a confirmação fora→fora de terceiro não atinge o peão parado',
  );
  estado = silencio.estado;
  estado = resolverRecebidas(estado, 'diogo');
  estado = aplicar(estado, encerrarTurno(), 'diogo');

  // Rodada 3: a vez volta a ana — o ATUANTE cujo peão está dentro do raio
  // estendido. Permanecer na reta-1 (antes = depois, dentro) dispara.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const gatilho = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLote(gatilho.eventos);
  assert.ok(ataque, 'o atuante dentro do raio estendido dispara ao agir');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'vulto-x', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  assert.deepEqual(gatilho.estado.peoesNoAlcance, { 'vulto-x': ['peao-branco'] });
});

test('ataques simultâneos de vulto e espectro resolvem juntos; a Proteção é consumida uma única vez (critério 6)', () => {
  const tabuleiro: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      peca('vulto-x', 'vulto', 0, 0, 3),
      peca('reta-a', 'reta', 0, 1, 3),
      peca('espectro-x', 'espectro', 0, 3, 3),
      peca('reta-b', 'reta', 0, 4, 3),
    ],
    peoes: [
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-a' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'reta-b' },
    ],
  };
  const jogadores: readonly JogadorAlvoDoAtaque[] = [
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: true },
    { jogadorId: 'carla', peaoId: 'peao-azul', protegido: false },
  ];

  const resolucao = resolverAtaques(tabuleiro, {}, jogadores);
  assert.ok(resolucao.evento);
  if (!resolucao.evento) return;
  // Dois atacantes no MESMO evento: Vulto e Espectro resolvem juntos.
  assert.deepEqual(resolucao.evento.atacantes, [
    { pecaId: 'vulto-x', tipo: 'vulto', peoesNoAlcance: ['peao-vermelho'] },
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-azul'] },
  ]);
  // A Proteção de bruno nega o ataque do Vulto e é consumida UMA única vez;
  // carla (sem Proteção) é atingida normalmente.
  assert.deepEqual(resolucao.evento.peoesAtingidos, ['peao-azul']);
  assert.deepEqual(resolucao.evento.protegidos, ['bruno']);
  assert.deepEqual(resolucao.protegidosConsumidos, ['bruno']);
  // Snapshot atualizado para o próximo gatilho.
  assert.deepEqual(resolucao.peoesNoAlcance, {
    'vulto-x': ['peao-vermelho'],
    'espectro-x': ['peao-azul'],
  });
});

test('resolverAtaques: a Proteção de jogador fora dos atacantes não é consumida', () => {
  const tabuleiro: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      peca('espectro-x', 'espectro', 0, 3, 3),
      peca('reta-b', 'reta', 0, 4, 3),
      peca('reta-c', 'reta', 0, 5, 5),
    ],
    peoes: [
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'reta-b' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-c' },
    ],
  };
  const jogadores: readonly JogadorAlvoDoAtaque[] = [
    { jogadorId: 'bruno', peaoId: 'peao-vermelho', protegido: true },
    { jogadorId: 'carla', peaoId: 'peao-azul', protegido: false },
  ];

  const resolucao = resolverAtaques(tabuleiro, {}, jogadores);
  assert.ok(resolucao.evento);
  if (!resolucao.evento) return;
  // O ataque acontece (azul entrou no alcance), mas bruno não é alvo:
  // a Proteção dele permanece até ser consumida.
  assert.deepEqual(resolucao.evento.peoesAtingidos, ['peao-azul']);
  assert.deepEqual(resolucao.evento.protegidos, []);
  assert.deepEqual(resolucao.protegidosConsumidos, []);
});

test('confirmação sobre a sala médica concede a Proteção após o ataque do gatilho, que a consome no seguinte (critério 6)', () => {
  let estado = partidaEmRodada2();
  // Espectro em (0,3) com escada-1 (0,4) e a Sala Médica (1,3) conectadas;
  // vermelho parado na escada-1.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 0, 3);
  estado = comPeca(estado, 'sala-x', 'sala_medica', 0, 1, 3);
  estado = comPeca(estado, 'escada-1', 'reta', 90, 0, 4);
  estado = comPeca(estado, 'escada-2', 'reta', 90, 0, 5);
  estado = comPeaoSobre(estado, 'peao-vermelho', 'escada-1');
  // Ana abre o turno sobre a reta-1, vizinha da Sala Médica (zona da origem:
  // {reta-1} ∪ conectadas), e confirma SOBRE a Sala em um único salto —
  // dentro do alcance do espectro: o ataque do gatilho a atinge (a Proteção
  // ainda não existe) e a Sala Médica concede a Proteção DEPOIS da resolução.
  estado = comPeaoSobre(estado, 'peao-branco', 'reta-1');
  estado = { ...estado, pecaDoInicioDoTurnoId: 'reta-1' };

  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  const ataque1 = ataqueDoLote(confirmado.eventos);
  assert.ok(ataque1, 'a confirmação dentro do alcance deveria disparar o ataque');
  if (!ataque1) return;
  assert.deepEqual(ataque1.peoesAtingidos, ['peao-branco', 'peao-vermelho']);
  assert.deepEqual(ataque1.protegidos, []);
  const ana = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, true);
  estado = confirmado.estado;

  estado = resolverRecebidas(estado, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');

  // Bruno sai do alcance (escada-1 → escada-2): o ataque dispara, mira ana
  // (que permanece) e a Proteção a nega — consumida uma única vez.
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, moverPeao('peao-vermelho', 0, 5), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const segundo = aplicarComandoDePartida(estado, confirmarPosicao('peao-vermelho'), 'bruno');
  assert.equal(segundo.sucesso, true);
  if (!segundo.sucesso) return;
  const ataque2 = ataqueDoLote(segundo.eventos);
  assert.ok(ataque2, 'a saída deveria disparar o ataque contra quem permanece');
  if (!ataque2) return;
  assert.deepEqual(ataque2.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque2.peoesAtingidos, []);
  assert.deepEqual(ataque2.protegidos, ['ana']);
  const anaDepois = segundo.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(anaDepois?.protegido, false);
});

// Issue #227: o posicao_confirmada carrega o protegido RESULTANTE do ator no
// gatilho completo — o eco observável da Proteção no canal (o snapshot leva o
// estado por Jogador como baseline de reconexão). Onde a Proteção vive: engine
// (concessão na Confirmação, consumo no ATAQUE_RESOLVIDO.protegidos) →
// snapshot (baseline). ATAQUE_RESOLVIDO.protegidos já cobria o lado do
// consumo; aqui o estado resultante viaja na Confirmação.
test('a Confirmação sobre a Sala Médica emite posicao_confirmada com protegido: true (issue #227)', () => {
  let estado = partidaEmRodada2();
  estado = comPeca(estado, 'sala-x', 'sala_medica', 0, 1, 3);
  // Ana abre o turno sobre a reta-1, vizinha da Sala Médica (zona da origem:
  // {reta-1} ∪ conectadas), e confirma SOBRE ela em um único salto — sem
  // Monstro no cenário: a concessão acontece e o evento carrega o estado
  // resultante.
  estado = comPeaoSobre(estado, 'peao-branco', 'reta-1');
  estado = { ...estado, pecaDoInicioDoTurnoId: 'reta-1' };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  // Ordem do lote preservada (issue #227): posicao_confirmada em PRIMEIRO,
  // antes de peca_sorteada/recebimento_gerado/celulas_iluminadas.
  assert.equal(confirmado.eventos[0].tipo, 'posicao_confirmada');
  assert.deepEqual(confirmado.eventos[0], {
    tipo: 'posicao_confirmada',
    jogadorId: 'ana',
    peaoId: 'peao-branco',
    pecaId: 'sala-x',
    protegido: true,
  });
  const ana = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, true);
});

test('a Confirmação sem Sala Médica emite posicao_confirmada com protegido: false (issue #227)', () => {
  let estado = partidaEmRodada2();
  // Ana confirma sobre a reta-1 (mudança de peça comum): nenhuma concessão e
  // nenhuma Proteção prévia — o estado resultante é false.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  assert.equal(confirmado.eventos[0].tipo, 'posicao_confirmada');
  assert.deepEqual(confirmado.eventos[0], {
    tipo: 'posicao_confirmada',
    jogadorId: 'ana',
    peaoId: 'peao-branco',
    pecaId: 'reta-1',
    protegido: false,
  });
  const ana = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, false);
});

test('a Confirmação cujo ataque consumiu a Proteção prévia emite protegido: false sem Sala Médica (issue #227)', () => {
  let estado = partidaEmRodada2();
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 0, 3);
  estado = comPeca(estado, 'reta-nova', 'reta', 0, 1, 3);
  // Ana abre o turno sobre a reta-1, vizinha da reta-nova (zona da origem:
  // {reta-1} ∪ conectadas), e entra no alcance do espectro em um único salto.
  estado = comPeaoSobre(estado, 'peao-branco', 'reta-1');
  estado = { ...estado, pecaDoInicioDoTurnoId: 'reta-1' };
  // Ana já chegou à Confirmação COM Proteção (concedida por gatilho anterior).
  estado = {
    ...estado,
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === 'ana' ? { ...jogador, protegido: true } : jogador,
    ),
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 1, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  // O ataque do MESMO gatilho dispara (delta do alcance) e CONSOME a Proteção
  // de ana (sem Sala Médica no destino para restaurá-la): o estado resultante
  // do ator no fim do gatilho completo é false — é o que o evento carrega.
  const ataque = ataqueDoLote(confirmado.eventos);
  assert.ok(ataque, 'a entrada no alcance do espectro deveria disparar o ataque');
  if (!ataque) return;
  assert.deepEqual(ataque.protegidos, ['ana']);
  assert.deepEqual(ataque.peoesAtingidos, []);
  assert.equal(confirmado.eventos[0].tipo, 'posicao_confirmada');
  assert.deepEqual(confirmado.eventos[0], {
    tipo: 'posicao_confirmada',
    jogadorId: 'ana',
    peaoId: 'peao-branco',
    pecaId: 'reta-nova',
    protegido: false,
  });
  const ana = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, false);
});

test('a Confirmação preserva Proteção prévia não consumida: evento emite protegido: true (issue #227)', () => {
  let estado = partidaEmRodada2();
  // Ana já chegou à Confirmação COM Proteção (gatilho anterior) e o destino
  // não é a Sala Médica — sem Monstro, o ataque não dispara e a Proteção
  // permanece: o estado resultante do ator é true, e é o que o evento carrega.
  estado = {
    ...estado,
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === 'ana' ? { ...jogador, protegido: true } : jogador,
    ),
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  assert.equal(confirmado.eventos[0].tipo, 'posicao_confirmada');
  assert.deepEqual(confirmado.eventos[0], {
    tipo: 'posicao_confirmada',
    jogadorId: 'ana',
    peaoId: 'peao-branco',
    pecaId: 'reta-1',
    protegido: true,
  });
  assert.equal(ataqueDoLote(confirmado.eventos), undefined);
  const ana = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, true);
});

// Issue #236: o encaixe do Monstro não dispara — e o Primeiro Turno de
// terceiro (fora→fora) também não atinge o peão parado; o ataque ocorre
// quando o atuante cujo peão está no alcance age.
test('posicionar monstro não dispara ataque, mesmo com peão no alcance; o ataque ocorre quando o atuante age (critério 7)', () => {
  const inicio = estadoInicialDaPartida(JOGADORES);
  assert.equal(inicio.sucesso, true);
  if (!inicio.sucesso) return;
  let estado = comVultoPrimeiroNaCaixa(inicio.estado);
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');

  // Gatilho do Primeiro Turno: o vulto ainda está na Caixa — sem ataque.
  const encaixeDoPeao = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(encaixeDoPeao.sucesso, true);
  if (!encaixeDoPeao.sucesso) return;
  assert.equal(ataqueDoLote(encaixeDoPeao.eventos), undefined);
  estado = encaixeDoPeao.estado;

  // O vulto é encaixado ao norte da Inicial: o peão fica DENTRO do alcance
  // (conectados) e ainda assim o encaixe do monstro não dispara ataque.
  estado = aplicar(estado, escolherVaga('recebida-vulto-1', 'norte'), 'ana');
  const encaixeDoMonstro = aplicarComandoDePartida(estado, posicionar('vulto-1', 2, 3), 'ana');
  assert.equal(encaixeDoMonstro.sucesso, true);
  if (!encaixeDoMonstro.sucesso) return;
  assert.equal(ataqueDoLote(encaixeDoMonstro.eventos), undefined);
  estado = encaixeDoMonstro.estado;

  estado = resolverRecebidas(estado, 'ana');
  estado = aplicar(estado, encerrarTurno(), 'ana');

  // O Primeiro Turno de bruno posiciona o peão dele FORA do alcance do
  // vulto: fora→fora é silêncio — o peão de ana, parado dentro do alcance
  // desde o encaixe, NÃO é atingido pela ação de terceiro (issue #262).
  estado = aplicar(estado, selecionar('inicial-2'), 'bruno');
  estado = aplicar(estado, posicionar('inicial-2', 0, 0), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  const silencio = aplicarComandoDePartida(estado, posicionarPeao('peao-vermelho', 0, 0), 'bruno');
  assert.equal(silencio.sucesso, true);
  if (!silencio.sucesso) return;
  assert.equal(ataqueDoLote(silencio.eventos), undefined);
  // O snapshot avalia o alcance mesmo no silêncio: o peão de ana está dentro.
  assert.deepEqual(silencio.estado.peoesNoAlcance, { 'vulto-1': ['peao-branco'] });
  estado = silencio.estado;
  estado = resolverRecebidas(estado, 'bruno');
  estado = aplicar(estado, encerrarTurno(), 'bruno');
  // Carla e diogo posicionam fora do alcance: silêncio igual (diogo em
  // (1,0): a vaga norte de bruno envolve para (6,0) na grade toroidal).
  estado = concluirPrimeiroTurno(estado, { linha: 6, coluna: 6 });
  estado = concluirPrimeiroTurno(estado, { linha: 1, coluna: 0 });

  // Rodada 2: a vez volta a ana — o ATUANTE cujo peão está dentro do
  // alcance do vulto. Permanecer na Inicial (antes = depois, dentro) dispara
  // e atinge o próprio peão.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const gatilho = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLote(gatilho.eventos);
  assert.ok(ataque, 'o atuante dentro do alcance dispara ao agir');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  assert.deepEqual(gatilho.estado.peoesNoAlcance, { 'vulto-1': ['peao-branco'] });
});

test('estado persistido sem os campos novos não quebra a resolução do ataque (binário anterior)', () => {
  let estado = partidaEmRodada2();
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  // Simula o JSON de um binário anterior à #172: sem peoesNoAlcance no estado
  // e sem protegido nos jogadores.
  let antigo = {
    ...estado,
    peoesNoAlcance: undefined,
    jogadores: estado.jogadores.map((jogador) => ({
      jogadorId: jogador.jogadorId,
      ordem: jogador.ordem,
      cor: jogador.cor,
      peaoId: jogador.peaoId,
      primeiroTurnoPendente: jogador.primeiroTurnoPendente,
      sanidade: jogador.sanidade,
    })),
  } as unknown as EstadoDaPartida;

  antigo = aplicar(antigo, selecionarPeao('peao-branco'), 'ana');
  antigo = aplicar(antigo, moverPeao('peao-branco', 2, 3), 'ana');
  antigo = aplicar(antigo, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(antigo, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  const ataque = ataqueDoLote(confirmado.eventos);
  assert.ok(ataque, 'o ataque deveria resolver normalmente no estado antigo');
  if (!ataque) return;
  // Snapshot ausente é tratado como vazio e ninguém como protegido.
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  assert.deepEqual(ataque.protegidos, []);
  assert.deepEqual(confirmado.estado.peoesNoAlcance, { 'espectro-x': ['peao-branco'] });
});

// --- Fiação na Partida (issue #236 — avaliação centrada no atuante) ---

// PERMANECER é gatilho: permanecer DENTRO do Alcance (antes = depois = Peça
// do início do turno) dispara, com ataque_resolvido antes de turno_encerrado
// no lote.
test('PERMANECER dentro do alcance dispara o ataque antes de turno_encerrado (issue #236)', () => {
  let estado = partidaEmRodada2();
  // Espectro em (1,3): reta-1 (2,3) ao sul conectada.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  // Rodada 2: ana confirma SOBRE a reta-1 — entrada, atinge a própria.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const entrada = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(entrada.sucesso, true);
  if (!entrada.sucesso) return;
  const ataqueEntrada = ataqueDoLote(entrada.eventos);
  assert.ok(ataqueEntrada, 'a entrada na Confirmação dispara');
  if (!ataqueEntrada) return;
  assert.deepEqual(ataqueEntrada.peoesAtingidos, ['peao-branco']);
  estado = entrada.estado;
  // Reta-1 não gera pendências (norte é o próprio espectro, sul a Inicial).
  estado = aplicar(estado, encerrarTurno(), 'ana');
  // Bruno, carla e diogo permanecem fora do alcance: silêncio.
  estado = aplicar(estado, selecionarPeao('peao-vermelho'), 'bruno');
  estado = aplicar(estado, permanecer('peao-vermelho'), 'bruno');
  estado = aplicar(estado, selecionarPeao('peao-azul'), 'carla');
  estado = aplicar(estado, permanecer('peao-azul'), 'carla');
  estado = aplicar(estado, selecionarPeao('peao-amarelo'), 'diogo');
  estado = aplicar(estado, permanecer('peao-amarelo'), 'diogo');

  // Rodada 3: ana permanece na reta-1 — dentro→dentro dispara.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const gatilho = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLote(gatilho.eventos);
  assert.ok(ataque, 'permanecer dentro deveria disparar');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  // Ordem do lote: ataque_resolvido ANTES de turno_encerrado (issue #236).
  const indiceAtaque = gatilho.eventos.findIndex((evento) => evento.tipo === 'ataque_resolvido');
  const indiceEncerramento = gatilho.eventos.findIndex((evento) => evento.tipo === 'turno_encerrado');
  assert.ok(indiceAtaque >= 0 && indiceAtaque < indiceEncerramento);
  // Snapshot atualizado pela Permanência.
  assert.deepEqual(gatilho.estado.peoesNoAlcance, { 'espectro-x': ['peao-branco'] });
  // Penalidade: Espectro drena de novo (3 → 2 na entrada, 2 → 1 aqui).
  const ana = gatilho.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.sanidade, 1);
});

// Fora→fora do atuante é silêncio MESMO com peão de terceiro parado dentro
// do Alcance — o delta global do legado (causa do bug #262) não existe mais.
test('mover e confirmar fora→fora é silêncio mesmo com peão de terceiro dentro do alcance (issue #236)', () => {
  let estado = partidaEmRodada2();
  // Espectro em (1,3): reta-y (0,3) ao norte e reta-1 (2,3) ao sul conectadas;
  // vermelho (bruno) já dentro, parado sobre a reta-y.
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  estado = comPeca(estado, 'reta-y', 'reta', 0, 0, 3);
  estado = comPeaoSobre(estado, 'peao-vermelho', 'reta-y');
  // Substitui a reta-2 (3,4) por uma Cruz (quatro bordas abertas) — reta de
  // orientação 0 não conecta à Inicial pelo leste (mesmo truque de
  // sanidade.test.ts no cenarioDeAtaque).
  estado = {
    ...estado,
    tabuleiro: {
      ...estado.tabuleiro,
      posicionadas: [
        ...estado.tabuleiro.posicionadas.filter((item) => item.pecaId !== 'reta-2'),
        { pecaId: 'cruz-y', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 4 } },
      ],
    },
  };
  // Ana move de inicial-1 (3,3) para a cruz (3,4) — fora do alcance — e
  // confirma: fora→fora é silêncio.
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  estado = aplicar(estado, moverPeao('peao-branco', 3, 4), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const confirmado = aplicarComandoDePartida(estado, confirmarPosicao('peao-branco'), 'ana');
  assert.equal(confirmado.sucesso, true);
  if (!confirmado.sucesso) return;
  assert.equal(ataqueDoLote(confirmado.eventos), undefined);
  // O snapshot avalia o Alcance atual: vermelho dentro; sanidade intacta.
  assert.deepEqual(confirmado.estado.peoesNoAlcance, { 'espectro-x': ['peao-vermelho'] });
  const bruno = confirmado.estado.jogadores.find((jogador) => jogador.jogadorId === 'bruno');
  assert.equal(bruno?.sanidade, 3);
});

// O posicionamento do Peão no Primeiro Turno é ENTRADA: a Peça do início do
// turno é null (≡ fora) e a Peça decidida é a recém-ocupada.
test('Primeiro Turno: posicionar o peão dentro do alcance é entrada (issue #236)', () => {
  let estado = partidaIniciada();
  // Espectro a leste da célula (3,3): a Inicial entra no alcance dele quando
  // o peão for posicionado (inicial com leste aberto + espectro oeste aberto).
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 3, 4);
  estado = aplicar(estado, selecionar('inicial-1'), 'ana');
  estado = aplicar(estado, posicionar('inicial-1', 3, 3), 'ana');
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const encaixe = aplicarComandoDePartida(estado, posicionarPeao('peao-branco', 3, 3), 'ana');
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  const ataque = ataqueDoLote(encaixe.eventos);
  assert.ok(ataque, 'posicionar o peão dentro do alcance no Primeiro Turno é entrada');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  // Penalidade #170 com eco #173: Espectro drena 3 → 2.
  assert.deepEqual(ataque.estadosAplicados, [
    { jogadorId: 'ana', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
  ]);
  assert.deepEqual(encaixe.estado.peoesNoAlcance, { 'espectro-x': ['peao-branco'] });
});

// A Proteção é consumida UMA única vez também na Permanência — permanecer
// dentro dispara, a Proteção nega e é consumida.
test('PERMANECER dentro do alcance: a Proteção é consumida uma única vez e nega o ataque (issue #236)', () => {
  let estado = partidaEmRodada2();
  estado = comPeca(estado, 'espectro-x', 'espectro', 0, 1, 3);
  // Estado injetado (mesmo padrão da Proteção prévia da #227): o peão de ana
  // está na reta-1 desde a Confirmação do turno anterior e ela chegou com a
  // Proteção ainda não consumida.
  estado = comPeaoSobre(estado, 'peao-branco', 'reta-1');
  estado = {
    ...estado,
    pecaDoInicioDoTurnoId: 'reta-1',
    jogadores: estado.jogadores.map((jogador) =>
      jogador.jogadorId === 'ana' ? { ...jogador, protegido: true } : jogador,
    ),
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const gatilho = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLote(gatilho.eventos);
  assert.ok(ataque, 'permanecer dentro deveria disparar');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'espectro-x', tipo: 'espectro', peoesNoAlcance: ['peao-branco'] },
  ]);
  // Protegida: atingida no ataque (negado), Proteção consumida, sem
  // penalidade — fora do estadosAplicados.
  assert.deepEqual(ataque.peoesAtingidos, []);
  assert.deepEqual(ataque.protegidos, ['ana']);
  assert.deepEqual(ataque.estadosAplicados, []);
  const ana = gatilho.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.protegido, false);
  assert.equal(ana?.sanidade, 3);
  // Ordem do lote: ataque_resolvido antes de turno_encerrado.
  const indiceAtaque = gatilho.eventos.findIndex((evento) => evento.tipo === 'ataque_resolvido');
  const indiceEncerramento = gatilho.eventos.findIndex((evento) => evento.tipo === 'turno_encerrado');
  assert.ok(indiceAtaque >= 0 && indiceAtaque < indiceEncerramento);
});

// A Permanência não gera Limpeza (ADR-0005); se o Vulto impor Baixa
// Iluminação nova, a Iluminação é recalculada e a Limpeza reaplicada no
// MESMO gatilho — o Vulto, fora da luz, ainda ataca antes de ser removido.
test('PERMANECER dentro do alcance do Vulto: Baixa Iluminação nova reaplica a Iluminação e Limpa (issue #236)', () => {
  let estado = partidaEmRodada2();
  // Vulto em (1,3): raio sul passa por reta-1 (2,3) e inicial-1 (3,3) — ana
  // permanece DENTRO.
  estado = comPeca(estado, 'vulto-x', 'vulto', 0, 1, 3);
  estado = aplicar(estado, selecionarPeao('peao-branco'), 'ana');
  const gatilho = aplicarComandoDePartida(estado, permanecer('peao-branco'), 'ana');
  assert.equal(gatilho.sucesso, true);
  if (!gatilho.sucesso) return;
  const ataque = ataqueDoLote(gatilho.eventos);
  assert.ok(ataque, 'permanecer dentro do raio do Vulto deveria disparar');
  if (!ataque) return;
  assert.deepEqual(ataque.atacantes, [
    { pecaId: 'vulto-x', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] },
  ]);
  assert.deepEqual(ataque.peoesAtingidos, ['peao-branco']);
  assert.deepEqual(ataque.estadosAplicados, [
    { jogadorId: 'ana', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
  ]);
  // Baixa nova encolhe a luz de ana à própria célula: reta-1 (2,3), reta-2
  // (3,4) e o Vulto (1,3) saem da Iluminação — LIMPEZA reaplicada no mesmo
  // gatilho, depois do ataque_resolvido.
  const indiceAtaque = gatilho.eventos.findIndex((evento) => evento.tipo === 'ataque_resolvido');
  const indiceLimpeza = gatilho.eventos.findIndex((evento) => evento.tipo === 'limpeza_aplicada');
  assert.ok(indiceAtaque >= 0 && indiceAtaque < indiceLimpeza);
  const limpeza = gatilho.eventos[indiceLimpeza];
  assert.ok(limpeza && limpeza.tipo === 'limpeza_aplicada');
  if (!limpeza || limpeza.tipo !== 'limpeza_aplicada') return;
  assert.deepEqual(
    [...limpeza.pecasRemovidas].sort(),
    ['reta-1', 'reta-2', 'vulto-x'].sort(),
  );
  const ana = gatilho.estado.jogadores.find((jogador) => jogador.jogadorId === 'ana');
  assert.equal(ana?.emBaixaIluminacao, true);
});