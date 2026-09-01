import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSICAO_DA_CAIXA,
  aplicarComandoDeTabuleiro,
  estadoInicialDaPartida,
  estadoInicialDoTabuleiro,
  sortearDaCaixa,
  type EstadoDoTabuleiro,
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
