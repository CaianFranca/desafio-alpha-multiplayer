import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDeTabuleiro,
  bordasAbertas,
  calcularAlcance,
  calcularIluminacao,
  estadoInicialDoTabuleiro,
  normalizarCelula,
  normalizarCoordenada,
  vagasDisponiveis,
  vizinhasConectadas,
  vizinhos,
  type ComandoDeTabuleiro,
  type EstadoDoTabuleiro,
  type PecaPosicionada,
} from '../src/index.ts';
import { celulaVizinhaNaBorda } from '../src/tabuleiro.ts';

// Grade toroidal 7x7 (issue #260 / ADR-0012): norte da linha 0 é a linha 6
// (e vice-versa), leste da coluna 6 é a coluna 0 (e vice-versa) — não existe
// "fora": iluminação, vagas, movimento e alcance atravessam a borda.

function aplicar(
  estado: EstadoDoTabuleiro,
  comando: ComandoDeTabuleiro,
): EstadoDoTabuleiro {
  const resultado = aplicarComandoDeTabuleiro(estado, comando);
  if (!resultado.sucesso) {
    throw new Error(`${resultado.erro.codigo}: ${resultado.erro.mensagem}`);
  }
  return resultado.estado;
}

const selecionar = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const posicionar = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const peca = (
  pecaId: string,
  tipo: PecaPosicionada['tipo'],
  orientacao: PecaPosicionada['orientacao'],
  linha: number,
  coluna: number,
): PecaPosicionada => ({ pecaId, tipo, orientacao, celula: { linha, coluna } });

test('normalizarCoordenada envolve negativos e valores acima de 6', () => {
  assert.equal(normalizarCoordenada(0), 0);
  assert.equal(normalizarCoordenada(6), 6);
  assert.equal(normalizarCoordenada(7), 0);
  assert.equal(normalizarCoordenada(-1), 6);
  assert.equal(normalizarCoordenada(-8), 6);
  assert.equal(normalizarCoordenada(13), 6);
  assert.deepEqual(normalizarCelula({ linha: -1, coluna: 7 }), {
    linha: 6,
    coluna: 0,
  });
});

test('celulaVizinhaNaBorda envolve nas quatro bordas', () => {
  assert.deepEqual(celulaVizinhaNaBorda({ linha: 0, coluna: 0 }, 'norte'), {
    linha: 6,
    coluna: 0,
  });
  assert.deepEqual(celulaVizinhaNaBorda({ linha: 6, coluna: 3 }, 'sul'), {
    linha: 0,
    coluna: 3,
  });
  assert.deepEqual(celulaVizinhaNaBorda({ linha: 2, coluna: 6 }, 'leste'), {
    linha: 2,
    coluna: 0,
  });
  assert.deepEqual(celulaVizinhaNaBorda({ linha: 4, coluna: 0 }, 'oeste'), {
    linha: 4,
    coluna: 6,
  });
  // Interior inalterado.
  assert.deepEqual(celulaVizinhaNaBorda({ linha: 3, coluna: 3 }, 'norte'), {
    linha: 2,
    coluna: 3,
  });
});

test('vizinhos da borda incluem o lado oposto, sempre 4', () => {
  assert.deepEqual(vizinhos({ linha: 0, coluna: 0 }), [
    { linha: 6, coluna: 0 },
    { linha: 0, coluna: 1 },
    { linha: 1, coluna: 0 },
    { linha: 0, coluna: 6 },
  ]);
  assert.equal(vizinhos({ linha: 0, coluna: 3 }).length, 4);
  assert.equal(vizinhos({ linha: 3, coluna: 3 }).length, 4);
});

test('vizinhasConectadas atravessam a borda quando as bordas se encaram', () => {
  const estado: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      // inicial-1 em (0,3): norte+leste abertas.
      peca('inicial-1', 'inicial', 0, 0, 3),
      // reta em (6,3) com sul aberto: encara o norte da inicial-1 via wrap.
      peca('reta-1', 'reta', 0, 6, 3),
      // reta em (0,5) com oeste fechado para a inicial-1: sem conexão.
      peca('reta-2', 'reta', 0, 0, 4),
    ],
  };
  const conectadas = vizinhasConectadas(estado, 'inicial-1').map(
    (item) => item.pecaId,
  );
  assert.ok(conectadas.includes('reta-1'));
  assert.ok(!conectadas.includes('reta-2'));
  // Simetria: a reta-1 também enxerga a inicial-1 pelo sul.
  assert.deepEqual(
    vizinhasConectadas(estado, 'reta-1').map((item) => item.pecaId),
    ['inicial-1'],
  );
});

test('vagasDisponiveis na borda geram célula do lado oposto', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 0, 6));
  const origem = estado.posicionadas.find(
    (item) => item.pecaId === 'inicial-1',
  );
  assert.ok(origem);
  // inicial orient 0 em (0,6): norte envolve para (6,6), leste para (0,0).
  assert.deepEqual(
    vagasDisponiveis(estado, origem).map((vaga) => [vaga.borda, vaga.celula]),
    [
      ['norte', { linha: 6, coluna: 6 }],
      ['leste', { linha: 0, coluna: 0 }],
    ],
  );
});

test('mover_peao cruza a borda entre peças conectadas', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 0, 3));
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 0, 3));
  // Peça destino injetada em (6,3), conectada pelo wrap (mesmo padrão dos
  // fixtures de alcance de monstros.test.ts).
  estado = {
    ...estado,
    posicionadas: [
      ...estado.posicionadas,
      peca('reta-1', 'reta', 0, 6, 3),
    ],
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, moverPeao('peao-branco', 6, 3));
  assert.equal(
    estado.peoes.find((item) => item.peaoId === 'peao-branco')?.pecaId,
    'reta-1',
  );
});

test('mover_peao com coordenada fora de 0–6 normaliza para o alvo', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 0, 3));
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 0, 3));
  estado = {
    ...estado,
    posicionadas: [
      ...estado.posicionadas,
      peca('reta-1', 'reta', 0, 6, 3),
    ],
  };
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  // (13,3) normaliza para (6,3): o peão cruza a borda pelo comando envolvido.
  estado = aplicar(estado, moverPeao('peao-branco', 13, 3));
  assert.equal(
    estado.peoes.find((item) => item.peaoId === 'peao-branco')?.pecaId,
    'reta-1',
  );
});

test('calcularIluminacao atravessa a borda', () => {
  const estado: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [peca('inicial-1', 'inicial', 0, 0, 0)],
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ],
  };
  assert.deepEqual(calcularIluminacao(estado), [
    { linha: 0, coluna: 0 },
    { linha: 0, coluna: 1 },
    { linha: 0, coluna: 6 },
    { linha: 1, coluna: 0 },
    { linha: 6, coluna: 0 },
  ]);
});

test('alcance do vulto envolve a borda e nunca repete nem trava em anel', () => {
  // Anel toroidal na coluna 3: o raio norte do vulto dá a volta na grade e
  // reencontra a origem — visitados encerram sem duplicadas.
  const coluna: PecaPosicionada[] = [];
  for (let linha = 0; linha < 7; linha++) {
    if (linha === 3) continue;
    coluna.push(peca(`cruz-${linha}`, 'cruz', 0, linha, 3));
  }
  const estado: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [peca('vulto-x', 'vulto', 0, 3, 3), ...coluna],
  };
  const alcance = calcularAlcance(estado, 'vulto-x').map(
    (item) => item.pecaId,
  );
  // Raio norte dá a volta e para antes de revisitar o vulto; o sul faz o
  // caminho inverso — cada raio sem repetição interna (visitados por raio) e
  // o cálculo termina (este teste completa). Raios opostos sobrepõem peças,
  // como antes em linhas retas com retransmissão; o consumo a jusante usa
  // conjuntos (resolverAtaques), sem contagem dupla.
  assert.deepEqual(alcance, [
    'cruz-2',
    'cruz-1',
    'cruz-0',
    'cruz-6',
    'cruz-5',
    'cruz-4',
    'cruz-4',
    'cruz-5',
    'cruz-6',
    'cruz-0',
    'cruz-1',
    'cruz-2',
  ]);
  assert.ok(!alcance.includes('vulto-x'));
  // Bordas abertas da origem seguem intactas no cálculo.
  assert.deepEqual(bordasAbertas({ tipo: 'vulto', orientacao: 0 }), [
    'norte',
    'leste',
    'sul',
    'oeste',
  ]);
});
