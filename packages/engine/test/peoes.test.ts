import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aplicarComandoDeTabuleiro,
  estadoInicialDoTabuleiro,
  gerarRecebidas,
  vizinhasConectadas,
  type BordaCardinal,
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

const selecionarPeao = (peaoId: string) =>
  ({ tipo: 'selecionar_peao', peaoId } as const);

const posicionarPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'posicionar_peao', peaoId, celula: { linha, coluna } } as const);

const escolherVaga = (recebidaId: string, borda: BordaCardinal) =>
  ({ tipo: 'escolher_vaga_da_peca_recebida', recebidaId, borda } as const);

const moverPeao = (peaoId: string, linha: number, coluna: number) =>
  ({ tipo: 'mover_peao', peaoId, celula: { linha, coluna } } as const);

const desselecionarPeao = (peaoId: string) =>
  ({ tipo: 'desselecionar_peao', peaoId } as const);

const permanecer = (peaoId: string) =>
  ({ tipo: 'permanecer', peaoId } as const);

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

// Peão branco selecionado sobre a Peça Inicial em (3,3), com as recebidas da
// primeira sequência ainda pendentes (vagas nulas). O Recebimento é montado
// via literal do estado: desde a ST-11, a seleção não gera mais Recebimento —
// a geração pertence à camada da Partida. Desde a #138, cada pendência já
// carrega a Peça sorteada (reta-1 e t-1, retiradas da Caixa) e a vaga só é
// fixada por escolher_vaga_da_peca_recebida.
function estadoComRecebidasPendentes(): EstadoDoTabuleiro {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 3, 3));
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3));
  return {
    ...estado,
    peaoSelecionadoId: 'peao-branco',
    caixa: estado.caixa.filter(
      (peca) => peca.pecaId !== 'reta-1' && peca.pecaId !== 't-1',
    ),
    recebidas: [
      {
        recebidaId: 'recebida-reta-1',
        pecaId: 'reta-1',
        tipo: 'reta',
        orientacao: 0,
        vaga: null,
        celulaAlvo: null,
      },
      {
        recebidaId: 'recebida-t-1',
        pecaId: 't-1',
        tipo: 'T',
        orientacao: 0,
        vaga: null,
        celulaAlvo: null,
      },
    ],
  };
}

// Peão branco selecionado sobre a Peça Inicial em (3,3), com as duas
// recebidas da primeira sequência já resolvidas: reta-1 em (2,3) (vaga norte,
// orientação 0, conectada) e t-1 em (3,4) (vaga leste, orientação 0,
// conectada). O peão ainda está sobre a Peça Inicial, pronto para mover ou
// permanecer.
function estadoComPendenciasResolvidas(): EstadoDoTabuleiro {
  let estado = estadoComRecebidasPendentes();
  estado = aplicar(estado, escolherVaga('recebida-reta-1', 'norte'));
  estado = aplicar(estado, posicionar('reta-1', 2, 3));
  estado = aplicar(estado, escolherVaga('recebida-t-1', 'leste'));
  estado = aplicar(estado, posicionar('t-1', 3, 4));
  return estado;
}

test('estado inicial tem 4 peões com cores canônicas sobre a Mesa', () => {
  const estado = estadoInicialDoTabuleiro();

  assert.deepEqual(estado.peoes, [
    { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
    { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
    { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
    { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
  ]);
  assert.equal(estado.peaoSelecionadoId, null);
  assert.deepEqual(estado.recebidas, []);
});

test('primeiro posicionamento do peão só é aceito sobre a Peça Inicial', () => {
  // Vizinhas norte e leste da inicial em (3,3) ocupadas: re-selecionar o peão
  // posicionado não gera recebimento, isolando a guarda de já posicionado.
  const estadoComCaminho: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
      { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0, celula: { linha: 2, coluna: 3 } },
      { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 4 } },
      { pecaId: 'cruz-1', tipo: 'cruz', orientacao: 0, celula: { linha: 0, coluna: 0 } },
    ],
  };

  // Sem peão selecionado, o encaixe nem começa a ser avaliado.
  assert.equal(
    codigoDaRejeicao(estadoComCaminho, posicionarPeao('peao-branco', 3, 3)),
    'PEAO_NAO_SELECIONADO',
  );

  const selecionado = aplicar(estadoComCaminho, selecionarPeao('peao-branco'));

  // Célula vazia.
  assert.equal(
    codigoDaRejeicao(selecionado, posicionarPeao('peao-branco', 5, 5)),
    'CELULA_SEM_PECA',
  );
  // Peça de caminho não serve de entrada no ciclo.
  assert.equal(
    codigoDaRejeicao(selecionado, posicionarPeao('peao-branco', 0, 0)),
    'PECA_INICIAL_EXIGIDA',
  );
  let estado = aplicar(selecionado, posicionarPeao('peao-branco', 3, 3));
  assert.equal(estado.peoes[0].pecaId, 'inicial-1');

  // Depois de posicionado, o peão só muda de lugar por movimentação; o encaixe
  // deseleciona o peão, então a nova tentativa exige selecioná-lo de novo.
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeao('peao-branco', 0, 0)),
    'PEAO_JA_POSICIONADO',
  );
});

test('uma peça aceita no máximo um peão', () => {
  const estadoComCaminho: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
    ],
  };
  let estado = aplicar(estadoComCaminho, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3));

  // O encaixe deseleciona o peão branco; o vermelho precisa ser selecionado
  // antes de tentar se encaixar na mesma peça.
  estado = aplicar(estado, selecionarPeao('peao-vermelho'));
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeao('peao-vermelho', 3, 3)),
    'PECA_JA_TEM_PEAO',
  );
  // A rejeição preserva o estado.
  assert.equal(estado.peoes[1].pecaId, null);
});

test('conexões exigem bordas abertas voltadas uma para a outra, com orientação', () => {
  const estado: EstadoDoTabuleiro = {
    ...estadoInicialDoTabuleiro(),
    posicionadas: [
      // Inicial em (3,3) com bordas norte+leste abertas.
      { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
      // Reta ao norte, orientação 0 (norte+sul): conectada.
      { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 2, coluna: 3 } },
      // T ao leste, orientação 0 (norte+leste+oeste): conectada pela oeste.
      { pecaId: 't-1', tipo: 'T', orientacao: 0, celula: { linha: 3, coluna: 4 } },
      // Reta ao oeste: a inicial não tem borda oeste aberta.
      { pecaId: 'reta-2', tipo: 'reta', orientacao: 0, celula: { linha: 3, coluna: 2 } },
      // Reta ao sul girada 90° (leste+oeste): a borda voltada à inicial
      // (norte da reta) está fechada.
      { pecaId: 'reta-3', tipo: 'reta', orientacao: 90, celula: { linha: 4, coluna: 3 } },
    ],
  };

  // Ordem canônica: norte (reta-1) e leste (t-1).
  assert.deepEqual(
    vizinhasConectadas(estado, 'inicial-1').map((peca) => peca.pecaId),
    ['reta-1', 't-1'],
  );
  // A reta ao norte enxerga a inicial pela borda sul dela.
  assert.deepEqual(
    vizinhasConectadas(estado, 'reta-1').map((peca) => peca.pecaId),
    ['inicial-1'],
  );

  // Girar a reta para 90° fecha a borda sul e quebra a conexão.
  const girada: EstadoDoTabuleiro = {
    ...estado,
    posicionadas: estado.posicionadas.map((peca) =>
      peca.pecaId === 'reta-1' ? { ...peca, orientacao: 90 } : peca,
    ),
  };
  assert.deepEqual(
    vizinhasConectadas(girada, 'inicial-1').map((peca) => peca.pecaId),
    ['t-1'],
  );

  // Peça fora do Tabuleiro não tem vizinhas conectadas.
  assert.deepEqual(vizinhasConectadas(estado, 'inicial-2'), []);
});

test('selecionar peão sobre a Mesa não gera recebimento', () => {
  const resultado = aplicarComandoDeTabuleiro(
    estadoInicialDoTabuleiro(),
    selecionarPeao('peao-branco'),
  );
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) return;
  assert.deepEqual(resultado.eventos, [
    { tipo: 'peao_selecionado', peaoId: 'peao-branco' },
  ]);
  assert.equal(resultado.estado.peaoSelecionadoId, 'peao-branco');
  assert.deepEqual(resultado.estado.recebidas, []);
});

test('selecionar peão posicionado não gera recebimento (ST-11)', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 3, 3));
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3));

  // Peça Inicial em (3,3), orientação 0: bordas norte e leste abertas com
  // vizinhas vazias — mesmo assim a seleção não emite recebimento_gerado nem
  // cria recebidas.
  const selecao = aplicarComandoDeTabuleiro(estado, selecionarPeao('peao-branco'));
  assert.equal(selecao.sucesso, true);
  if (!selecao.sucesso) return;
  assert.deepEqual(selecao.eventos, [
    { tipo: 'peao_selecionado', peaoId: 'peao-branco' },
  ]);
  assert.deepEqual(selecao.estado.recebidas, []);
  assert.equal(selecao.estado.peaoSelecionadoId, 'peao-branco');
});

test('gerarRecebidas considera apenas células dentro da grade', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 0, 0));

  // A borda norte cai fora da grade; só o leste vazio vira vaga — e a
  // quantidade de peças sorteadas segue as vagas disponíveis.
  const peca = estado.posicionadas.find((item) => item.pecaId === 'inicial-1');
  assert.ok(peca);
  const sorteio = gerarRecebidas(estado, peca);
  assert.deepEqual(
    sorteio.recebidas.map((recebida) => recebida.recebidaId),
    ['recebida-reta-1'],
  );
  assert.equal(sorteio.recebidas[0].pecaId, 'reta-1');
  assert.equal(sorteio.recebidas[0].vaga, null);
  assert.equal(sorteio.recebidas[0].celulaAlvo, null);
  assert.deepEqual(sorteio.eventos, [
    { tipo: 'peca_sorteada', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 },
  ]);
  assert.equal(sorteio.estado.caixa.length, estado.caixa.length - 1);
});

test('o recebimento sorteia min(vagas, caixa) peças, uma a uma, e nunca é erro', () => {
  const base = estadoComRecebidasPendentes();
  const peca = base.posicionadas.find((item) => item.pecaId === 'inicial-1');
  assert.ok(peca);

  // Caixa insuficiente: com uma peça restante e duas vagas, o Jogador recebe
  // apenas a restante — não é erro.
  const comCaixaCurta: EstadoDoTabuleiro = {
    ...base,
    caixa: [{ pecaId: 'cruz-1', tipo: 'cruz', orientacao: 0 }],
  };
  const curto = gerarRecebidas(comCaixaCurta, peca);
  assert.deepEqual(
    curto.recebidas.map((recebida) => recebida.recebidaId),
    ['recebida-cruz-1'],
  );
  assert.equal(curto.recebidas[0].tipo, 'cruz');
  assert.deepEqual(curto.estado.caixa, []);

  // Caixa vazia: zero pendências e nenhum evento — também não é erro.
  const semCaixa: EstadoDoTabuleiro = { ...base, caixa: [] };
  const vazio = gerarRecebidas(semCaixa, peca);
  assert.deepEqual(vazio.recebidas, []);
  assert.deepEqual(vazio.eventos, []);
  assert.deepEqual(vazio.estado.caixa, []);
});

test('a mesma seed sorteia exatamente as mesmas peças no recebimento', () => {
  const montar = () => {
    let estado = aplicar(
      estadoInicialDoTabuleiro({ seed: 20260831 }),
      selecionar('inicial-1'),
    );
    estado = aplicar(estado, posicionar('inicial-1', 3, 3));
    return estado;
  };
  const pecaPrimeira = montar().posicionadas.find(
    (item) => item.pecaId === 'inicial-1',
  );
  const pecaSegunda = montar().posicionadas.find(
    (item) => item.pecaId === 'inicial-1',
  );
  assert.ok(pecaPrimeira && pecaSegunda);
  const primeiro = gerarRecebidas(montar(), pecaPrimeira);
  const segundo = gerarRecebidas(montar(), pecaSegunda);
  assert.deepEqual(primeiro.recebidas, segundo.recebidas);
  assert.deepEqual(primeiro.eventos, segundo.eventos);
});

test('escolher vaga fixa a borda, deriva a célula-alvo e seleciona a peça sorteada', () => {
  const estado = estadoComRecebidasPendentes();

  const escolha = aplicarComandoDeTabuleiro(
    estado,
    escolherVaga('recebida-reta-1', 'norte'),
  );
  assert.equal(escolha.sucesso, true);
  if (!escolha.sucesso) return;
  assert.equal(escolha.estado.recebidas[0].vaga, 'norte');
  assert.deepEqual(escolha.estado.recebidas[0].celulaAlvo, { linha: 2, coluna: 3 });
  assert.equal(escolha.estado.pecaSelecionadaId, 'reta-1');
  // A Caixa já foi consumida no sorteio: a escolha da vaga não a reconsome.
  assert.equal(escolha.estado.caixa.length, estado.caixa.length);
  assert.deepEqual(escolha.eventos, [
    {
      tipo: 'vaga_da_peca_recebida_escolhida',
      recebidaId: 'recebida-reta-1',
      borda: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
    },
  ]);
});

test('vaga inválida, já escolhida ou reescolhida é rejeitada com DADOS_INVALIDOS', () => {
  const estado = estadoComRecebidasPendentes();

  // Borda não aberta da Peça sob o Peão (a inicial só abre norte e leste).
  assert.equal(
    codigoDaRejeicao(estado, escolherVaga('recebida-reta-1', 'sul')),
    'DADOS_INVALIDOS',
  );
  // Borda fora do vocabulário fechado.
  assert.equal(
    codigoDaRejeicao(estado, escolherVaga('recebida-reta-1', 'diagonal' as BordaCardinal)),
    'DADOS_INVALIDOS',
  );

  // Norte escolhido pela primeira pendência deixa de ser vaga: a segunda
  // pendência não pode escolher a mesma borda (vaga já ocupada por outra
  // pendência).
  const comNorte = aplicar(estado, escolherVaga('recebida-reta-1', 'norte'));
  assert.equal(
    codigoDaRejeicao(comNorte, escolherVaga('recebida-t-1', 'norte')),
    'DADOS_INVALIDOS',
  );
  // A própria pendência com vaga já escolhida não é reescolhível.
  assert.equal(
    codigoDaRejeicao(comNorte, escolherVaga('recebida-reta-1', 'leste')),
    'DADOS_INVALIDOS',
  );
});

test('recebida só posiciona na célula-alvo da vaga escolhida, com orientação livre e sem exigência de conexão', () => {
  let estado = estadoComRecebidasPendentes();

  // Encaixe antes da escolha da vaga é rejeitado: a célula-alvo ainda não
  // existe (ela deriva da vaga).
  assert.equal(
    codigoDaRejeicao(estado, posicionar('t-1', 2, 3)),
    'DADOS_INVALIDOS',
  );

  // T escolhida para a vaga norte e mantida na orientação 0 (bordas
  // norte+leste+oeste): a borda sul, voltada à Peça geradora, está fechada —
  // sem conexão, e mesmo assim o encaixe na célula-alvo é aceito.
  estado = aplicar(estado, escolherVaga('recebida-t-1', 'norte'));

  const foraDoAlvo = aplicarComandoDeTabuleiro(estado, posicionar('t-1', 0, 0));
  assert.equal(foraDoAlvo.sucesso, false);
  if (!foraDoAlvo.sucesso) {
    assert.equal(foraDoAlvo.erro.codigo, 'PECA_FORA_DO_ALVO');
  }

  estado = aplicar(estado, posicionar('t-1', 2, 3));
  assert.equal(estado.recebidas.length, 1);
  assert.ok(estado.posicionadas.some(
    (peca) => peca.pecaId === 't-1' && peca.celula.linha === 2 && peca.celula.coluna === 3,
  ));

  // Resolve a pendência restante com uma reta também sem conexão (reta 0° tem
  // bordas norte+sul; voltada à geradora fica a oeste, fechada).
  estado = aplicar(estado, escolherVaga('recebida-reta-1', 'leste'));
  estado = aplicar(estado, posicionar('reta-1', 3, 4));

  // Nenhuma das vizinhas é conectada: movimentação rejeitada.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 2, 3)),
    'MOVIMENTO_NAO_CONECTADO',
  );
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 4)),
    'MOVIMENTO_NAO_CONECTADO',
  );
});

test('girar recebida segue o padrão da seleção única', () => {
  let parcial = estadoComRecebidasPendentes();
  parcial = aplicar(parcial, escolherVaga('recebida-reta-1', 'norte'));

  const giro = aplicarComandoDeTabuleiro(parcial, girar('reta-1'));
  assert.equal(giro.sucesso, true);
  if (!giro.sucesso) return;
  assert.deepEqual(giro.eventos, [
    {
      tipo: 'peca_girada',
      pecaId: 'reta-1',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    },
  ]);
  assert.equal(giro.estado.recebidas[0].orientacao, 90);
  let estado = giro.estado;

  // Escolhida a vaga da outra recebida, a seleção muda: girar a anterior é
  // rejeitado, mas o encaixe dela segue aceito (orientação é livre).
  estado = aplicar(estado, escolherVaga('recebida-t-1', 'leste'));
  assert.equal(codigoDaRejeicao(estado, girar('reta-1')), 'PECA_NAO_SELECIONADA');
  estado = aplicar(estado, posicionar('reta-1', 2, 3));
  assert.equal(estado.posicionadas.some(
    (peca) => peca.pecaId === 'reta-1' && peca.orientacao === 90,
  ), true);
});

test('recebida nasce com orientação 0; a caixa é opaca e não é manipulável', () => {
  let estado = estadoComRecebidasPendentes();

  // A Caixa é opaca (ST-12): peça de caminho não é selecionável — e a
  // Recebida só é girável depois de selecionada pela escolha da vaga.
  assert.equal(codigoDaRejeicao(estado, selecionar('reta-1')), 'PECA_NAO_ENCONTRADA');
  assert.equal(codigoDaRejeicao(estado, girar('reta-1')), 'PECA_NAO_SELECIONADA');

  estado = aplicar(estado, escolherVaga('recebida-reta-1', 'norte'));
  assert.equal(estado.recebidas[0].pecaId, 'reta-1');
  assert.equal(estado.recebidas[0].orientacao, 0);
});

test('girar recebida posicionada vai pela janela de Manipulação, sem seleção', () => {
  let estado = estadoComRecebidasPendentes();
  estado = aplicar(estado, escolherVaga('recebida-reta-1', 'norte'));
  estado = aplicar(estado, posicionar('reta-1', 2, 3));

  // O encaixe limpa a seleção e abre a Manipulação em reta-1; girar continua
  // funcionando pela janela, sem depender de pecaSelecionadaId.
  assert.equal(estado.pecaSelecionadaId, null);
  assert.equal(estado.pecaEmManipulacaoId, 'reta-1');

  const giro = aplicarComandoDeTabuleiro(estado, girar('reta-1'));
  assert.equal(giro.sucesso, true);
  if (!giro.sucesso) return;
  assert.deepEqual(giro.eventos, [
    {
      tipo: 'peca_girada',
      pecaId: 'reta-1',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    },
  ]);
  assert.equal(giro.estado.posicionadas.some(
    (peca) => peca.pecaId === 'reta-1' && peca.orientacao === 90,
  ), true);
});

test('pendências bloqueiam mover, permanecer e selecionar outro peão', () => {
  const estado = estadoComRecebidasPendentes();

  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 2, 3)),
    'PENDENCIA_NAO_RESOLVIDA',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco')),
    'PENDENCIA_NAO_RESOLVIDA',
  );
  assert.equal(
    codigoDaRejeicao(estado, selecionarPeao('peao-vermelho')),
    'PENDENCIA_NAO_RESOLVIDA',
  );
});

test('sub-fluxo do recebimento fora de ordem é rejeitado sem órfar pendências', () => {
  const pendentes = estadoComRecebidasPendentes();

  // Encaixe do próprio peão com pendências abertas.
  assert.equal(
    codigoDaRejeicao(pendentes, posicionarPeao('peao-branco', 5, 5)),
    'PENDENCIA_NAO_RESOLVIDA',
  );
  // Encaixe de outro peão, sem seleção: bloqueado antes de zerar a seleção e
  // órfar as pendências do peão em sequência.
  assert.equal(
    codigoDaRejeicao(pendentes, posicionarPeao('peao-vermelho', 3, 3)),
    'PEAO_NAO_SELECIONADO',
  );
  // As pendências seguem intactas após as rejeições.
  assert.equal(pendentes.recebidas.length, 2);
  assert.equal(pendentes.peaoSelecionadoId, 'peao-branco');

  // Escolha de vaga sem peão selecionado: estado construído diretamente — a
  // fronteira pode receber comandos fora de ordem e o domínio defende a
  // sequência mesmo assim.
  const semSequencia: EstadoDoTabuleiro = { ...pendentes, peaoSelecionadoId: null };
  assert.equal(
    codigoDaRejeicao(semSequencia, escolherVaga('recebida-reta-1', 'norte')),
    'PEAO_NAO_SELECIONADO',
  );

  // Encaixe de recebida sem a vaga escolhida, com peão selecionado: a
  // célula-alvo ainda não existe, então o encaixe é rejeitado.
  assert.equal(
    codigoDaRejeicao(pendentes, posicionar('reta-1', 2, 3)),
    'DADOS_INVALIDOS',
  );

  // Encaixe de recebida com a vaga já escolhida, mas sem peão selecionado.
  const comVaga = aplicar(pendentes, escolherVaga('recebida-reta-1', 'norte'));
  const comVagaSemSequencia: EstadoDoTabuleiro = { ...comVaga, peaoSelecionadoId: null };
  assert.equal(
    codigoDaRejeicao(comVagaSemSequencia, posicionar('reta-1', 2, 3)),
    'PEAO_NAO_SELECIONADO',
  );
});

test('re-seleção do mesmo peão é idempotente, sem novo recebimento', () => {
  const estado = estadoComRecebidasPendentes();

  const reSelecao = aplicarComandoDeTabuleiro(estado, selecionarPeao('peao-branco'));
  assert.equal(reSelecao.sucesso, true);
  if (!reSelecao.sucesso) return;
  assert.deepEqual(reSelecao.eventos, []);
  assert.equal(reSelecao.estado.recebidas.length, 2);
  assert.equal(reSelecao.estado.peaoSelecionadoId, 'peao-branco');
});

test('mover para vizinha conectada é aceito e encerra a sequência', () => {
  const estado = estadoComPendenciasResolvidas();

  const movimento = aplicarComandoDeTabuleiro(estado, moverPeao('peao-branco', 2, 3));
  assert.equal(movimento.sucesso, true);
  if (!movimento.sucesso) return;
  // Inicial (3,3) tem norte aberto; reta-1 (2,3) em 0° tem sul aberto.
  assert.deepEqual(movimento.eventos, [
    {
      tipo: 'peao_movido',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    },
  ]);
  assert.equal(movimento.estado.peaoSelecionadoId, null);
  assert.equal(movimento.estado.peoes[0].pecaId, 'reta-1');
});

test('mover para peça ocupada por outro peão é rejeitado; destino conectado vazio é aceito', () => {
  let estado = estadoComPendenciasResolvidas();

  // O peão branco ocupa a reta-1 (2,3), vizinha conectada da inicial-1.
  estado = aplicar(estado, moverPeao('peao-branco', 2, 3));

  // Segunda Peça Inicial ao norte da reta-1, com borda sul aberta (180°),
  // recebendo o peão vermelho.
  estado = aplicar(estado, selecionar('inicial-2'));
  estado = aplicar(estado, posicionar('inicial-2', 1, 3));
  estado = aplicar(estado, girar('inicial-2'));
  estado = aplicar(estado, girar('inicial-2'));
  estado = aplicar(estado, selecionarPeao('peao-vermelho'));
  estado = aplicar(estado, posicionarPeao('peao-vermelho', 1, 3));

  // Recebimento de inicial-2 (180°: bordas sul+oeste) montado via literal
  // (ST-11): o sul aponta para a reta-1 ocupada e não vira pendência; o oeste
  // tem célula vazia e fica pendente. A peça sorteada da pendência é cruz-1.
  estado = {
    ...estado,
    peaoSelecionadoId: 'peao-vermelho',
    caixa: estado.caixa.filter((peca) => peca.pecaId !== 'cruz-1'),
    recebidas: [
      {
        recebidaId: 'recebida-cruz-1',
        pecaId: 'cruz-1',
        tipo: 'cruz',
        orientacao: 0,
        vaga: null,
        celulaAlvo: null,
      },
    ],
  };
  estado = aplicar(estado, escolherVaga('recebida-cruz-1', 'oeste'));
  estado = aplicar(estado, posicionar('cruz-1', 1, 2));

  // (2,3) é vizinha conectada (sul da inicial-2 aberto, norte da reta-1
  // aberto), mas está ocupada pelo peão branco.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-vermelho', 2, 3)),
    'PECA_JA_TEM_PEAO',
  );

  // (1,2) é conectada (oeste da inicial-2, leste da cruz) e vazia.
  const movimento = aplicarComandoDeTabuleiro(estado, moverPeao('peao-vermelho', 1, 2));
  assert.equal(movimento.sucesso, true);
  if (!movimento.sucesso) return;
  assert.equal(movimento.estado.peoes[1].pecaId, 'cruz-1');
  assert.equal(movimento.estado.peaoSelecionadoId, null);
});

test('permanecer é aceito quando não há pendências e encerra a sequência', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionar('inicial-1'));
  estado = aplicar(estado, posicionar('inicial-1', 3, 3));

  // Vizinhas do norte e do leste ocupadas por Peças Iniciais posicionadas
  // diretamente: o recebimento não gera pendências.
  estado = aplicar(estado, selecionar('inicial-2'));
  estado = aplicar(estado, posicionar('inicial-2', 2, 3));
  estado = aplicar(estado, selecionar('inicial-3'));
  estado = aplicar(estado, posicionar('inicial-3', 3, 4));

  estado = aplicar(estado, selecionarPeao('peao-branco'));
  estado = aplicar(estado, posicionarPeao('peao-branco', 3, 3));

  const sequencia = aplicarComandoDeTabuleiro(estado, selecionarPeao('peao-branco'));
  assert.equal(sequencia.sucesso, true);
  if (!sequencia.sucesso) return;
  assert.deepEqual(sequencia.eventos, [
    { tipo: 'peao_selecionado', peaoId: 'peao-branco' },
  ]);
  estado = sequencia.estado;

  const permanencia = aplicarComandoDeTabuleiro(estado, permanecer('peao-branco'));
  assert.equal(permanencia.sucesso, true);
  if (!permanencia.sucesso) return;
  assert.deepEqual(permanencia.eventos, [
    { tipo: 'peao_permaneceu', peaoId: 'peao-branco', pecaId: 'inicial-1' },
  ]);
  assert.equal(permanencia.estado.peaoSelecionadoId, null);
  assert.equal(permanencia.estado.peoes[0].pecaId, 'inicial-1');
});

test('peça inicial pode ser posicionada em qualquer célula vazia com peças e peões presentes', () => {
  const estado = estadoComPendenciasResolvidas();

  const encaixe = aplicarComandoDeTabuleiro(estado, selecionar('inicial-4'));
  assert.equal(encaixe.sucesso, true);
  if (!encaixe.sucesso) return;
  const final = aplicar(encaixe.estado, posicionar('inicial-4', 6, 6));
  assert.ok(final.posicionadas.some(
    (peca) => peca.pecaId === 'inicial-4' && peca.celula.linha === 6 && peca.celula.coluna === 6,
  ));
});

test('peça de caminho direto da Caixa é rejeitada com PECA_NAO_RECEBIDA', () => {
  let estado = estadoInicialDoTabuleiro();
  assert.equal(
    codigoDaRejeicao(estado, posicionar('reta-1', 3, 3)),
    'PECA_NAO_RECEBIDA',
  );

  // Mesmo com uma Peça Inicial selecionada, o caminho direto da Caixa é vedado.
  estado = aplicar(estado, selecionar('inicial-1'));
  estado = aplicar(estado, girar('inicial-1'));
  assert.equal(
    codigoDaRejeicao(estado, posicionar('reta-1', 3, 3)),
    'PECA_NAO_RECEBIDA',
  );
});

test('comandos inválidos de peões e recebidas são rejeitados com códigos fechados', () => {
  let estado = estadoInicialDoTabuleiro();

  // Identificadores inválidos e peões inexistentes.
  assert.equal(codigoDaRejeicao(estado, selecionarPeao('   ')), 'DADOS_INVALIDOS');
  assert.equal(codigoDaRejeicao(estado, selecionarPeao('fantasma')), 'PEAO_NAO_ENCONTRADO');
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeao('fantasma', 3, 3)),
    'PEAO_NAO_ENCONTRADO',
  );
  assert.equal(codigoDaRejeicao(estado, permanecer('fantasma')), 'PEAO_NAO_ENCONTRADO');
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3)),
    'PEAO_NAO_SELECIONADO',
  );

  // Células malformadas ou fora da grade (validadas antes da seleção).
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeao('peao-branco', 1.5, 3)),
    'DADOS_INVALIDOS',
  );
  assert.equal(
    codigoDaRejeicao(estado, posicionarPeao('peao-branco', 7, 0)),
    'CELULA_NAO_ENCONTRADA',
  );
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 7, 0)),
    'CELULA_NAO_ENCONTRADA',
  );

  // Peão selecionado sobre a Mesa não participa de mover/permanecer.
  estado = aplicar(estado, selecionarPeao('peao-branco'));
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-branco', 3, 3)),
    'PEAO_NAO_SELECIONADO',
  );
  assert.equal(
    codigoDaRejeicao(estado, permanecer('peao-branco')),
    'PEAO_NAO_SELECIONADO',
  );
  // Peão errado para a sequência.
  assert.equal(
    codigoDaRejeicao(estado, moverPeao('peao-vermelho', 3, 3)),
    'PEAO_NAO_SELECIONADO',
  );

  // Recebidas inexistentes e vagas inválidas.
  assert.equal(
    codigoDaRejeicao(estado, escolherVaga('recebida-fantasma', 'norte')),
    'RECEBIDA_NAO_ENCONTRADA',
  );
  // Borda indisponível (inicial-1 ainda não posicionada: sem Peça sob o Peão,
  // não há vagas a escolher) e borda fora do vocabulário.
  const comPendencias = estadoComRecebidasPendentes();
  assert.equal(
    codigoDaRejeicao(
      comPendencias,
      escolherVaga('recebida-reta-1', 'diagonal' as BordaCardinal),
    ),
    'DADOS_INVALIDOS',
  );
});

test('desselecionar_peao limpa a seleção vigente e emite peao_desselecionado (issue #249)', () => {
  let estado = aplicar(estadoInicialDoTabuleiro(), selecionarPeao('peao-branco'));
  assert.equal(estado.peaoSelecionadoId, 'peao-branco');
  const resultado = aplicarComandoDeTabuleiro(estado, desselecionarPeao('peao-branco'));
  assert.equal(resultado.sucesso, true);
  if (!resultado.sucesso) throw new Error('inacessível');
  assert.equal(resultado.estado.peaoSelecionadoId, null);
  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ['peao_desselecionado'],
  );
});

test('desselecionar_peao é idempotente sem eventos (já desselecionado ou outro peão, #249)', () => {
  // Sem seleção vigente: no-op.
  const semSelecao = estadoInicialDoTabuleiro();
  const vazio = aplicarComandoDeTabuleiro(semSelecao, desselecionarPeao('peao-branco'));
  assert.equal(vazio.sucesso, true);
  if (!vazio.sucesso) throw new Error('inacessível');
  assert.equal(vazio.estado.peaoSelecionadoId, null);
  assert.deepEqual(vazio.eventos, []);
  // Outro peão em sequência: não rouba a sequência alheia.
  const comSelecao = aplicar(semSelecao, selecionarPeao('peao-branco'));
  const alheia = aplicarComandoDeTabuleiro(comSelecao, desselecionarPeao('peao-vermelho'));
  assert.equal(alheia.sucesso, true);
  if (!alheia.sucesso) throw new Error('inacessível');
  assert.equal(alheia.estado.peaoSelecionadoId, 'peao-branco');
  assert.deepEqual(alheia.eventos, []);
});

test('desselecionar_peao sob Recebidas pendentes rejeita PENDENCIA_NAO_RESOLVIDA (#249)', () => {
  const estado = estadoComRecebidasPendentes();
  assert.equal(
    codigoDaRejeicao(estado, desselecionarPeao('peao-branco')),
    'PENDENCIA_NAO_RESOLVIDA',
  );
  // Estado preservado: a seleção segue vigente.
  assert.equal(estado.peaoSelecionadoId, 'peao-branco');
});

test('desselecionar_peao de peão inexistente rejeita PEAO_NAO_ENCONTRADO', () => {
  const estado = estadoInicialDoTabuleiro();
  assert.equal(
    codigoDaRejeicao(estado, desselecionarPeao('fantasma')),
    'PEAO_NAO_ENCONTRADO',
  );
  assert.equal(codigoDaRejeicao(estado, desselecionarPeao('   ')), 'DADOS_INVALIDOS');
});
