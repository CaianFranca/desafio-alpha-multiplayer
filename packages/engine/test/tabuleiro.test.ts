import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LADO_DA_GRADE,
  aplicarComandoDeTabuleiro,
  bordasAbertas,
  estadoInicialDoTabuleiro,
  vizinhos,
  type ComandoDeTabuleiro,
  type CodigoDeErroDeTabuleiro,
  type EstadoDoTabuleiro,
} from '../src/index.ts';

const selecionar = (pecaId: string) =>
  ({ tipo: 'selecionar_peca', pecaId } as const);

const girar = (pecaId: string, sentido: 'horario' | 'anti_horario' = 'horario') =>
  ({ tipo: 'girar_peca', pecaId, sentido } as const);

const posicionar = (pecaId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peca', pecaId, celula: { linha, coluna } } as const);

const finalizar = () => ({ tipo: 'finalizar_manipulacao' } as const);

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

function peçaNasIniciais(estado: EstadoDoTabuleiro, pecaId: string) {
  const peca = estado.iniciais.find((item) => item.pecaId === pecaId);
  if (!peca) {
    throw new Error(`Peça ${pecaId} não está entre as iniciais`);
  }
  return peca;
}

test('estado inicial com N jogadores tem N iniciais e N peões; fora de 2–4 lança', () => {
  const dois = estadoInicialDoTabuleiro({ numeroDeJogadores: 2 });
  assert.deepEqual(
    dois.iniciais.map((peca) => peca.pecaId),
    ['inicial-1', 'inicial-2'],
  );
  assert.deepEqual(
    dois.peoes.map((peao) => peao.peaoId),
    ['peao-branco', 'peao-vermelho'],
  );
  assert.equal(dois.caixa.length, 83);

  const tres = estadoInicialDoTabuleiro({ numeroDeJogadores: 3 });
  assert.deepEqual(
    tres.iniciais.map((peca) => peca.pecaId),
    ['inicial-1', 'inicial-2', 'inicial-3'],
  );
  assert.deepEqual(
    tres.peoes.map((peao) => peao.peaoId),
    ['peao-branco', 'peao-vermelho', 'peao-azul'],
  );

  assert.throws(() => estadoInicialDoTabuleiro({ numeroDeJogadores: 1 }));
  assert.throws(() => estadoInicialDoTabuleiro({ numeroDeJogadores: 5 }));
});

test('estado inicial tem 4 iniciais fora da caixa e a caixa de 83 peças', () => {
  const estado = estadoInicialDoTabuleiro();

  // As 4 Peças Iniciais ficam fora da Caixa (ST-12).
  assert.equal(estado.iniciais.length, 4);
  assert.deepEqual(
    estado.iniciais.map((peca) => peca.pecaId),
    ['inicial-1', 'inicial-2', 'inicial-3', 'inicial-4'],
  );
  for (const peca of estado.iniciais) {
    assert.equal(peca.tipo, 'inicial');
    assert.equal(peca.orientacao, 0);
  }

  // Sem seed, a Caixa permanece na ordem de composição.
  assert.equal(estado.caixa.length, 83);
  const porTipo: Record<string, number> = {};
  for (const peca of estado.caixa) {
    porTipo[peca.tipo] = (porTipo[peca.tipo] ?? 0) + 1;
    assert.equal(peca.orientacao, 0);
    assert.notEqual(peca.tipo, 'inicial');
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
  assert.ok(ids.has('reta-10'));
  assert.ok(ids.has('t-32'));
  assert.ok(ids.has('cruz-12'));
  assert.ok(ids.has('gerador-6'));
  assert.ok(ids.has('sala-do-diretor-3'));
  assert.ok(ids.has('sala-medica-4'));
  assert.ok(ids.has('portao-de-saida-4'));
  assert.ok(ids.has('vulto-6'));
  assert.ok(ids.has('espectro-6'));

  assert.deepEqual(estado.posicionadas, []);
  assert.equal(estado.pecaSelecionadaId, null);
  assert.equal(estado.pecaEmManipulacaoId, null);
});

test('vizinhança considera apenas células que compartilham uma borda', () => {
  assert.deepEqual(vizinhos({ linha: 3, coluna: 3 }), [
    { linha: 2, coluna: 3 },
    { linha: 3, coluna: 4 },
    { linha: 4, coluna: 3 },
    { linha: 3, coluna: 2 },
  ]);

  // Diagonal não é vizinha; as direções avaliadas em ordem fixa (norte,
  // leste, sul, oeste) fazem o canto noroeste expor leste e sul.
  const vizinhas = vizinhos({ linha: 3, coluna: 3 });
  assert.ok(!vizinhas.some((celula) => celula.linha === 2 && celula.coluna === 2));
  assert.ok(!vizinhas.some((celula) => celula.linha === 4 && celula.coluna === 4));
});

test('células nas bordas da grade não expõem vizinhas fora do range', () => {
  assert.equal(LADO_DA_GRADE, 7);

  assert.deepEqual(vizinhos({ linha: 0, coluna: 0 }), [
    { linha: 0, coluna: 1 },
    { linha: 1, coluna: 0 },
  ]);
  assert.deepEqual(vizinhos({ linha: 6, coluna: 6 }), [
    { linha: 5, coluna: 6 },
    { linha: 6, coluna: 5 },
  ]);
  assert.deepEqual(vizinhos({ linha: 0, coluna: 3 }), [
    { linha: 0, coluna: 4 },
    { linha: 1, coluna: 3 },
    { linha: 0, coluna: 2 },
  ]);
});

test('bordas abertas por tipo seguem a orientação base de cada tipo', () => {
  // Inicial: norte + leste (adjacentes).
  assert.deepEqual(bordasAbertas({ tipo: 'inicial', orientacao: 0 }), ['norte', 'leste']);
  // Reta: norte + sul (opostas).
  assert.deepEqual(bordasAbertas({ tipo: 'reta', orientacao: 0 }), ['norte', 'sul']);
  // T: norte + leste + oeste (três bordas).
  assert.deepEqual(bordasAbertas({ tipo: 'T', orientacao: 0 }), ['norte', 'leste', 'oeste']);
  // Cruz: todas abertas.
  assert.deepEqual(bordasAbertas({ tipo: 'cruz', orientacao: 0 }), [
    'norte',
    'leste',
    'sul',
    'oeste',
  ]);
});

test('bordas abertas giram com a orientação em passos horários de 90 graus', () => {
  assert.deepEqual(bordasAbertas({ tipo: 'inicial', orientacao: 90 }), ['leste', 'sul']);
  assert.deepEqual(bordasAbertas({ tipo: 'reta', orientacao: 90 }), ['leste', 'oeste']);
  assert.deepEqual(bordasAbertas({ tipo: 'reta', orientacao: 180 }), ['norte', 'sul']);
  assert.deepEqual(bordasAbertas({ tipo: 'T', orientacao: 90 }), ['norte', 'leste', 'sul']);
  assert.deepEqual(bordasAbertas({ tipo: 'T', orientacao: 270 }), ['norte', 'sul', 'oeste']);
  assert.deepEqual(bordasAbertas({ tipo: 'cruz', orientacao: 270 }), [
    'norte',
    'leste',
    'sul',
    'oeste',
  ]);
});

test('girar peça inicial selecionada altera a orientação fora da caixa em passos de 90 graus', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-2'));

  const primeiroGiro = aplicarComandoDeTabuleiro(estado, girar('inicial-2'));
  assert.equal(primeiroGiro.sucesso, true);
  if (!primeiroGiro.sucesso) return;
  assert.deepEqual(primeiroGiro.eventos, [
    {
      tipo: 'peca_girada',
      pecaId: 'inicial-2',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    },
  ]);

  estado = aplicar(aplicar(estado, girar('inicial-2')), girar('inicial-2'));
  assert.equal(peçaNasIniciais(estado, 'inicial-2').orientacao, 180);

  estado = aplicar(estado, girar('inicial-2'));
  assert.equal(peçaNasIniciais(estado, 'inicial-2').orientacao, 270);
});

test('girar anti-horário faz wrap-around e ambos os sentidos são discretos', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-3'));

  estado = aplicar(estado, girar('inicial-3', 'anti_horario'));
  assert.equal(peçaNasIniciais(estado, 'inicial-3').orientacao, 270);

  estado = aplicar(estado, girar('inicial-3', 'horario'));
  assert.equal(peçaNasIniciais(estado, 'inicial-3').orientacao, 0);

  estado = aplicar(estado, girar('inicial-3', 'anti_horario'));
  estado = aplicar(estado, girar('inicial-3', 'anti_horario'));
  assert.equal(peçaNasIniciais(estado, 'inicial-3').orientacao, 180);
});

test('seleção única: seleciona, troca e deseleção ao clicar na própria seleção', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  assert.equal(estado.pecaSelecionadaId, 'inicial-1');

  const troca = aplicarComandoDeTabuleiro(estado, selecionar('inicial-2'));
  assert.equal(troca.sucesso, true);
  if (!troca.sucesso) return;
  assert.equal(troca.estado.pecaSelecionadaId, 'inicial-2');
  assert.deepEqual(troca.eventos, [{ tipo: 'peca_selecionada', pecaId: 'inicial-2' }]);
  estado = troca.estado;

  const deselecao = aplicarComandoDeTabuleiro(estado, selecionar('inicial-2'));
  assert.equal(deselecao.sucesso, true);
  if (!deselecao.sucesso) return;
  assert.equal(deselecao.estado.pecaSelecionadaId, null);
  assert.deepEqual(deselecao.eventos, [
    { tipo: 'peca_deselecionada', pecaId: 'inicial-2' },
  ]);
});

test('posicionar em célula vazia encaixa a peça e a retira das iniciais', () => {
  const inicial = estadoInicialDoTabuleiro();
  let estado = aplicar(inicial, selecionar('inicial-1'));

  const encaixe = aplicarComandoDeTabuleiro(estado, posicionar('inicial-1', 3, 3));
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;

  assert.equal(encaixe.estado.iniciais.length, inicial.iniciais.length - 1);
  assert.ok(!encaixe.estado.iniciais.some((peca) => peca.pecaId === 'inicial-1'));
  assert.deepEqual(encaixe.estado.posicionadas, [
    { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
  ]);
  // O encaixe consome a seleção e abre a janela de Manipulação.
  assert.equal(encaixe.estado.pecaSelecionadaId, null);
  assert.equal(encaixe.estado.pecaEmManipulacaoId, 'inicial-1');
  assert.deepEqual(encaixe.eventos, [
    {
      tipo: 'peca_posicionada',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
      orientacao: 0,
    },
  ]);
});

test('posicionar em célula ocupada é rejeitado com código fechado', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 3, 3));

  estado = aplicar(estado, selecionar('inicial-2'));
  estado = aplicar(estado, posicionar('inicial-2', 4, 3));

  estado = aplicar(estado, selecionar('inicial-3'));
  assert.equal(codigoDaRejeicao(estado, posicionar('inicial-3', 3, 3)), 'CELULA_JA_OCUPADA');
  // A rejeição preserva o estado sem consumir nada.
  assert.equal(estado.iniciais.some((peca) => peca.pecaId === 'inicial-3'), true);
});

test('após o encaixe, girar a peça posicionada é permitido até a Finalização', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 2, 2));

  const giroNaCelula = aplicarComandoDeTabuleiro(estado, girar('inicial-1'));
  assert.equal(giroNaCelula.sucesso, true);
  if (!giroNaCelula.sucesso) return;
  assert.deepEqual(giroNaCelula.eventos, [
    {
      tipo: 'peca_girada',
      pecaId: 'inicial-1',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    },
  ]);
  estado = giroNaCelula.estado;

  estado = aplicar(estado, girar('inicial-1', 'anti_horario'));
  assert.equal(estado.posicionadas[0].orientacao, 0);
  assert.deepEqual(
    bordasAbertas(estado.posicionadas[0]),
    bordasAbertas({ tipo: 'inicial', orientacao: 0 }),
  );

  // A Finalização pelo próprio comando encerra a janela.
  const fechamento = aplicarComandoDeTabuleiro(estado, finalizar());
  assert.equal(fechamento.sucesso, true);
  if (!fechamento.sucesso) return;
  assert.deepEqual(fechamento.eventos, [
    { tipo: 'manipulacao_finalizada', pecaId: 'inicial-1' },
  ]);
  estado = fechamento.estado;
  assert.equal(estado.pecaEmManipulacaoId, null);

  // Depois da Finalização, girar a peça é rejeitado.
  assert.equal(codigoDaRejeicao(estado, girar('inicial-1')), 'MANIPULACAO_ENCERRADA');
});

test('nova seleção encerra a manipulação anterior', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 2, 2));

  const novaSelecao = aplicarComandoDeTabuleiro(estado, selecionar('inicial-2'));
  assert.equal(novaSelecao.sucesso, true);
  if (!novaSelecao.sucesso) return;
  assert.deepEqual(novaSelecao.eventos, [
    { tipo: 'manipulacao_finalizada', pecaId: 'inicial-1' },
    { tipo: 'peca_selecionada', pecaId: 'inicial-2' },
  ]);
  estado = novaSelecao.estado;
  assert.equal(estado.pecaEmManipulacaoId, null);

  assert.equal(codigoDaRejeicao(estado, girar('inicial-1')), 'MANIPULACAO_ENCERRADA');
});

test('novo posicionamento encerra a janela anterior e abre a própria', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 2, 2));
  estado = aplicar(estado, selecionar('inicial-2'));
  estado = aplicar(estado, posicionar('inicial-2', 5, 5));

  assert.equal(estado.pecaEmManipulacaoId, 'inicial-2');
  assert.equal(codigoDaRejeicao(estado, girar('inicial-1')), 'MANIPULACAO_ENCERRADA');

  const giroNovaPeca = aplicarComandoDeTabuleiro(estado, girar('inicial-2'));
  assert.equal(giroNovaPeca.sucesso, true);
  if (!giroNovaPeca.sucesso) return;
  assert.equal(giroNovaPeca.estado.posicionadas[1].orientacao, 90);
});

test('clique na própria peça posicionada via selecionar_peça encerra a manipulação', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 2, 2));

  const clique = aplicarComandoDeTabuleiro(estado, selecionar('inicial-1'));
  assert.equal(clique.sucesso, true);
  if (!clique.sucesso) return;
  assert.deepEqual(clique.eventos, [
    { tipo: 'manipulacao_finalizada', pecaId: 'inicial-1' },
  ]);
  assert.equal(clique.estado.pecaEmManipulacaoId, null);
  assert.equal(clique.estado.pecaSelecionadaId, null);
});

test('comandos inválidos são rejeitados com códigos fechados', () => {
  const estado = estadoInicialDoTabuleiro();

  // Sem seleção ativa.
  assert.equal(codigoDaRejeicao(estado, girar('inicial-2')), 'PECA_NAO_SELECIONADA');
  assert.equal(
    codigoDaRejeicao(estado, posicionar('inicial-1', 3, 3)),
    'PECA_NAO_SELECIONADA',
  );
  // Peça de caminho está na Caixa (opaca): não pode ser posicionada diretamente
  // (só via Recebimento) nem girada/selecionada.
  assert.equal(
    codigoDaRejeicao(estado, posicionar('reta-1', 3, 3)),
    'PECA_NAO_RECEBIDA',
  );
  assert.equal(codigoDaRejeicao(estado, selecionar('reta-1')), 'PECA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, girar('reta-1')), 'PECA_NAO_ENCONTRADA');

  // Peça inexistente.
  assert.equal(codigoDaRejeicao(estado, selecionar('fantasma-1')), 'PECA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, girar('fantasma-1')), 'PECA_NAO_ENCONTRADA');

  // Peça já posicionada não pode ser selecionada novamente após a Finalização.
  let ocupado = aplicar(estado, selecionar('inicial-1'));
  ocupado = aplicar(ocupado, posicionar('inicial-1', 3, 3));
  ocupado = aplicar(ocupado, finalizar());
  assert.equal(codigoDaRejeicao(ocupado, selecionar('inicial-1')), 'PECA_JA_POSICIONADA');
});

test('peça da caixa não é posicionável nem selecionável; posicionamento só de iniciais', () => {
  const estado = estadoInicialDoTabuleiro();

  // Peça de caminho direto da Caixa: vedada — entra apenas pelo Recebimento.
  assert.equal(
    codigoDaRejeicao(estado, posicionar('cruz-1', 3, 3)),
    'PECA_NAO_RECEBIDA',
  );
  // Peça especial da Caixa: mesma vedação.
  assert.equal(
    codigoDaRejeicao(estado, posicionar('gerador-1', 3, 3)),
    'PECA_NAO_RECEBIDA',
  );
  // Peça inexistente segue PECA_NAO_ENCONTRADA.
  assert.equal(
    codigoDaRejeicao(estado, posicionar('fantasma-1', 3, 3)),
    'PECA_NAO_ENCONTRADA',
  );
});

test('células fora da grade ou malformadas são rejeitadas', () => {
  const estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));

  assert.equal(codigoDaRejeicao(estado, posicionar('inicial-1', -1, 3)), 'CELULA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, posicionar('inicial-1', 3, 7)), 'CELULA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, posicionar('inicial-1', 7, 0)), 'CELULA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, posicionar('inicial-1', 1.5, 3)), 'DADOS_INVALIDOS');
});

test('dados inválidos de identificador e sentido são rejeitados', () => {
  const estado = estadoInicialDoTabuleiro();

  assert.equal(codigoDaRejeicao(estado, selecionar('   ')), 'DADOS_INVALIDOS');
  assert.equal(
    codigoDaRejeicao(estado, girar('reta-1', 'diagonal' as 'horario')),
    'DADOS_INVALIDOS',
  );
});

test('finalizar sem manipulação em andamento é rejeitado', () => {
  assert.equal(
    codigoDaRejeicao(estadoInicialDoTabuleiro(), finalizar()),
    'MANIPULACAO_ENCERRADA',
  );
});
