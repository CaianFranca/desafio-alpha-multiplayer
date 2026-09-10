import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSICAO_DA_CAIXA,
  aplicarComandoDeTabuleiro,
  ehPecaDeMonstro,
  ehPecaEspecial,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  sortearDaCaixa,
  type EstadoDoTabuleiro,
  type TipoDePecaDaCaixa,
} from '../src/index.ts';

function estadoInicial(): EstadoDoTabuleiro {
  return estadoInicialDoTabuleiro();
}

function ordemDaCaixa(estado: EstadoDoTabuleiro): string[] {
  return estado.caixa.map((peca) => peca.pecaId);
}

test('a composição da caixa soma 83 peças com a proporção fixa do ST-12', () => {
  const total = COMPOSICAO_DA_CAIXA.reduce(
    (soma, entrada) => soma + entrada.quantidade,
    0,
  );
  assert.equal(total, 83);
  assert.deepEqual(
    COMPOSICAO_DA_CAIXA.map((entrada) => ({ ...entrada })),
    [
      { tipo: 'reta', quantidade: 10 },
      { tipo: 'T', quantidade: 32 },
      { tipo: 'cruz', quantidade: 12 },
      { tipo: 'gerador', quantidade: 6 },
      { tipo: 'sala_do_diretor', quantidade: 3 },
      { tipo: 'sala_medica', quantidade: 4 },
      { tipo: 'portao_de_saida', quantidade: 4 },
      { tipo: 'vulto', quantidade: 6 },
      { tipo: 'espectro', quantidade: 6 },
    ],
  );
});

test('a caixa nasce com a composição fixa completa e ids determinísticos', () => {
  const estado = estadoInicial();

  assert.equal(estado.caixa.length, 83);
  const porTipo: Record<string, number> = {};
  for (const peca of estado.caixa) {
    porTipo[peca.tipo] = (porTipo[peca.tipo] ?? 0) + 1;
  }
  assert.deepEqual(porTipo, {
    reta: 10,
    T: 32,
    cruz: 12,
    gerador: 6,
    sala_do_diretor: 3,
    sala_medica: 4,
    portao_de_saida: 4,
    vulto: 6,
    espectro: 6,
  });

  const ids = new Set(estado.caixa.map((peca) => peca.pecaId));
  assert.equal(ids.size, 83);
  for (const [tipo, quantidade] of [
    ['reta', 'reta'],
    ['T', 't'],
    ['cruz', 'cruz'],
    ['gerador', 'gerador'],
    ['sala_do_diretor', 'sala-do-diretor'],
    ['sala_medica', 'sala-medica'],
    ['portao_de_saida', 'portao-de-saida'],
    ['vulto', 'vulto'],
    ['espectro', 'espectro'],
  ] as const) {
    for (let indice = 1; indice <= porTipo[tipo]; indice++) {
      assert.ok(ids.has(`${quantidade}-${indice}`));
    }
  }
});

test('as 4 peças iniciais ficam fora da caixa', () => {
  const estado = estadoInicial();

  assert.equal(estado.iniciais.length, 4);
  assert.deepEqual(
    estado.iniciais.map((peca) => [peca.pecaId, peca.tipo]),
    [
      ['inicial-1', 'inicial'],
      ['inicial-2', 'inicial'],
      ['inicial-3', 'inicial'],
      ['inicial-4', 'inicial'],
    ],
  );
  // Nenhuma inicial dentro da Caixa (o tipo TipoDePecaDaCaixa já veda
  // 'inicial'; o id é a garantia em runtime).
  assert.ok(estado.caixa.every((peca) => !peca.pecaId.startsWith('inicial')));
});

test('sem seed a caixa permanece na ordem de composição (determinismo dos testes)', () => {
  // Sufixo de id por tipo, contrato fixado pelos ids determinísticos.
  const sufixo: Record<string, string> = {
    reta: 'reta',
    T: 't',
    cruz: 'cruz',
    gerador: 'gerador',
    sala_do_diretor: 'sala-do-diretor',
    sala_medica: 'sala-medica',
    portao_de_saida: 'portao-de-saida',
    vulto: 'vulto',
    espectro: 'espectro',
  };
  const esperado: string[] = [];
  for (const entrada of COMPOSICAO_DA_CAIXA) {
    for (let indice = 1; indice <= entrada.quantidade; indice++) {
      esperado.push(`${sufixo[entrada.tipo]}-${indice}`);
    }
  }

  assert.deepEqual(ordemDaCaixa(estadoInicial()), esperado);
});

test('a mesma seed produz exatamente a mesma ordem da caixa', () => {
  const primeira = estadoInicialDoTabuleiro({ seed: 20260831 });
  const segunda = estadoInicialDoTabuleiro({ seed: 20260831 });

  assert.notDeepEqual(ordemDaCaixa(primeira), ordemDaCaixa(estadoInicial()));
  assert.deepEqual(ordemDaCaixa(primeira), ordemDaCaixa(segunda));
  // A composição é preservada: apenas a ordem muda.
  const porTipo: Record<string, number> = {};
  for (const peca of primeira.caixa) {
    porTipo[peca.tipo] = (porTipo[peca.tipo] ?? 0) + 1;
  }
  assert.deepEqual(porTipo, {
    reta: 10,
    T: 32,
    cruz: 12,
    gerador: 6,
    sala_do_diretor: 3,
    sala_medica: 4,
    portao_de_saida: 4,
    vulto: 6,
    espectro: 6,
  });
});

test('seeds diferentes produzem ordens diferentes', () => {
  const comSeed1 = estadoInicialDoTabuleiro({ seed: 1 });
  const comSeed2 = estadoInicialDoTabuleiro({ seed: 2 });
  const semSeed = estadoInicial();

  assert.notDeepEqual(ordemDaCaixa(comSeed1), ordemDaCaixa(comSeed2));
  assert.notDeepEqual(ordemDaCaixa(comSeed1), ordemDaCaixa(semSeed));
});

test('a seed propagada pela partida embaralha a caixa de forma determinística', () => {
  const primeira = estadoInicialDaPartida(['ana', 'bruno', 'carla', 'diogo'], {
    seed: 42,
  });
  const segunda = estadoInicialDaPartida(['ana', 'bruno', 'carla', 'diogo'], {
    seed: 42,
  });
  assert.equal(primeira.sucesso, true);
  assert.equal(segunda.sucesso, true);
  if (!primeira.sucesso || !segunda.sucesso) return;

  assert.deepEqual(
    ordemDaCaixa(primeira.estado.tabuleiro),
    ordemDaCaixa(segunda.estado.tabuleiro),
  );
  assert.notDeepEqual(
    ordemDaCaixa(primeira.estado.tabuleiro),
    ordemDaCaixa(estadoInicial()),
  );
});

test('o sorteio retira exatamente a primeira peça, sem reposição', () => {
  const estado = estadoInicial();
  const primeira = estado.caixa[0];

  const sorteio = sortearDaCaixa(estado);
  assert.equal(sorteio.sucesso, true);
  if (!sorteio.sucesso) return;

  assert.deepEqual(sorteio.eventos, [
    {
      tipo: 'peca_sorteada',
      pecaId: primeira.pecaId,
      tipoDaPeca: primeira.tipo,
      orientacao: primeira.orientacao,
    },
  ]);
  assert.equal(sorteio.estado.caixa.length, estado.caixa.length - 1);
  assert.deepEqual(
    ordemDaCaixa(sorteio.estado),
    ordemDaCaixa(estado).slice(1),
  );

  // Sorteios seguintes continuam retirando a primeira peça restante.
  const segundoSorteio = sortearDaCaixa(sorteio.estado);
  assert.equal(segundoSorteio.sucesso, true);
  if (!segundoSorteio.sucesso) return;
  const segunda = sorteio.estado.caixa[0];
  assert.equal(segundoSorteio.estado.caixa.length, estado.caixa.length - 2);
  assert.deepEqual(segundoSorteio.eventos, [
    {
      tipo: 'peca_sorteada',
      pecaId: segunda.pecaId,
      tipoDaPeca: segunda.tipo,
      orientacao: segunda.orientacao,
    },
  ]);
  // Nenhuma peça é reposta: 83 sorteados esvaziam a caixa com peças únicas.
  const idsSorteados = new Set<string>();
  let atual: EstadoDoTabuleiro = estado;
  while (atual.caixa.length > 0) {
    const resultado = sortearDaCaixa(atual);
    assert.equal(resultado.sucesso, true);
    if (!resultado.sucesso) return;
    for (const evento of resultado.eventos) {
      if (evento.tipo === 'peca_sorteada') {
        idsSorteados.add(evento.pecaId);
      }
    }
    atual = resultado.estado;
  }
  assert.equal(idsSorteados.size, 83);
});

test('a caixa esgotada rejeita o sorteio com CAIXA_ESGOTADA e preserva o estado', () => {
  let estado = estadoInicial();
  while (estado.caixa.length > 0) {
    const resultado = sortearDaCaixa(estado);
    assert.equal(resultado.sucesso, true);
    if (!resultado.sucesso) return;
    estado = resultado.estado;
  }

  const esgotado = sortearDaCaixa(estado);
  assert.equal(esgotado.sucesso, false);
  if (esgotado.sucesso) return;
  assert.equal(esgotado.erro.codigo, 'CAIXA_ESGOTADA');
  assert.deepEqual(esgotado.erro, {
    tipo: 'erro_de_dominio',
    codigo: 'CAIXA_ESGOTADA',
    mensagem: 'A Caixa não possui mais Peças.',
  });
  // O estado segue intacto (caixa vazia, nada reposto).
  assert.deepEqual(estado.caixa, []);
});

// Estratificação da Caixa (issue #265, PR #347): invariantes sobre N seeds —
// sem estes testes o fallback best-effort violava as regras em ~1 a cada 7
// partidas sem o CI perceber (B1). Uma sondagem local em 500 seeds deu zero
// violações; a suíte fixa 120 para manter o tempo sob controle.
const SEEDS_DA_ESTRATIFICACAO = Array.from({ length: 120 }, (_, i) => i + 1);

function tiposComSeed(seed: number): TipoDePecaDaCaixa[] {
  return estadoInicialDoTabuleiro({ seed }).caixa.map((peca) => peca.tipo);
}

test('as 10 primeiras trazem só caminho + exatamente 1 sala_do_diretor', () => {
  // Issue #265: "apenas peças de caminho + 1 peça de cartão (sala_do_diretor)".
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const dezPrimeiras = tiposComSeed(seed).slice(0, 10);
    const cartoes = dezPrimeiras.filter((tipo) => tipo === 'sala_do_diretor');
    assert.equal(
      cartoes.length,
      1,
      `seed ${seed}: esperado 1 sala_do_diretor nas 10 primeiras, achou ${cartoes.length} (${dezPrimeiras.join(',')})`,
    );
    for (const tipo of dezPrimeiras) {
      assert.ok(
        !ehPecaDeMonstro(tipo),
        `seed ${seed}: monstro nas 10 primeiras (${tipo})`,
      );
      assert.notEqual(tipo, 'gerador', `seed ${seed}: gerador nas 10 primeiras`);
      assert.notEqual(
        tipo,
        'sala_medica',
        `seed ${seed}: sala_medica nas 10 primeiras`,
      );
      assert.notEqual(
        tipo,
        'portao_de_saida',
        `seed ${seed}: portao_de_saida nas 10 primeiras`,
      );
      assert.ok(
        tipo === 'sala_do_diretor' ||
          (!ehPecaEspecial(tipo) && !ehPecaDeMonstro(tipo)),
        `seed ${seed}: tipo inesperado nas 10 primeiras (${tipo})`,
      );
    }
  }
});

test('após as 10 primeiras, nunca mais de 5 caminhos seguidos (ritmo espaçado)', () => {
  // Issue #265: "1 monstro/peça especial a cada 4-5 caminhos".
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const tipos = tiposComSeed(seed);
    let caminhosSeguidos = 0;
    for (let i = 10; i < tipos.length; i++) {
      const tipo = tipos[i];
      if (!ehPecaEspecial(tipo) && !ehPecaDeMonstro(tipo)) {
        caminhosSeguidos++;
        assert.ok(
          caminhosSeguidos <= 5,
          `seed ${seed}: ${caminhosSeguidos} caminhos seguidos até ${i}`,
        );
      } else {
        caminhosSeguidos = 0;
      }
    }
  }
});

test('monstros do mesmo tipo mantêm 4 cartas entre si', () => {
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const tipos = tiposComSeed(seed);
    const ultimaPosicao = new Map<string, number>();
    for (let i = 0; i < tipos.length; i++) {
      const tipo = tipos[i];
      if (!ehPecaDeMonstro(tipo)) continue;
      const anterior = ultimaPosicao.get(tipo);
      assert.ok(
        anterior === undefined || i - anterior >= 5,
        `seed ${seed}: ${tipo} em ${anterior} e ${i} (4 cartas entre exigidas)`,
      );
      ultimaPosicao.set(tipo, i);
    }
  }
});

test('a caixa nunca emenda 3 peças especiais seguidas', () => {
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const tipos = tiposComSeed(seed);
    for (let i = 2; i < tipos.length; i++) {
      const trio = [tipos[i - 2], tipos[i - 1], tipos[i]].every((tipo) =>
        ehPecaEspecial(tipo),
      );
      assert.ok(!trio, `seed ${seed}: 3 especiais seguidos em ${i - 2}..${i}`);
    }
  }
});

test('especiais do mesmo tipo mantêm 2 cartas entre si (diferença >= 3)', () => {
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const tipos = tiposComSeed(seed);
    const ultimaPosicao = new Map<string, number>();
    for (let i = 0; i < tipos.length; i++) {
      const tipo = tipos[i];
      if (!ehPecaEspecial(tipo)) continue;
      const anterior = ultimaPosicao.get(tipo);
      assert.ok(
        anterior === undefined || i - anterior >= 3,
        `seed ${seed}: ${tipo} em ${anterior} e ${i} (2 cartas entre exigidas)`,
      );
      ultimaPosicao.set(tipo, i);
    }
  }
});

test('a janela de especiais aceita a distância exata de 3 (sem off-by-one)', () => {
  // Regressão do B3: com a janela `indice - 3` nenhuma seed repetia o mesmo
  // especial a distância 3; com a janela `indice - 2` isso é rotina
  // (130/200 seeds na sondagem). Se este teste falhar, a regra voltou a ser
  // mais restritiva que a issue.
  let comDistanciaExata3 = 0;
  for (const seed of SEEDS_DA_ESTRATIFICACAO) {
    const tipos = tiposComSeed(seed);
    const ultimaPosicao = new Map<string, number>();
    for (let i = 0; i < tipos.length; i++) {
      const tipo = tipos[i];
      if (!ehPecaEspecial(tipo)) continue;
      if (ultimaPosicao.get(tipo) === i - 3) {
        comDistanciaExata3++;
        break;
      }
      ultimaPosicao.set(tipo, i);
    }
  }
  assert.ok(
    comDistanciaExata3 > 0,
    'nenhuma seed repetiu o mesmo especial a distância 3: janela restritiva demais?',
  );
});

test('a seed 28 estratifica sem colar geradores (caso do review)', () => {
  // O review mediu `gerador` em 80 e 82 na seed 28 (distância 2, violação);
  // após a garantia, a mesma seed precisa sair limpa e determinística.
  const tipos = tiposComSeed(28);
  assert.equal(tipos.length, 83);
  assert.deepEqual(tipos, tiposComSeed(28));
  const posicoes = tipos
    .map((tipo, i) => (tipo === 'gerador' ? i : -1))
    .filter((i) => i >= 0);
  assert.equal(posicoes.length, 6);
  for (let k = 1; k < posicoes.length; k++) {
    assert.ok(posicoes[k] - posicoes[k - 1] >= 3);
  }
});
