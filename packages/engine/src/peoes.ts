// Domínio puro dos Peões, conexões, Recebimento e ciclo da sequência
// (ST-10 / issue #89), refinado pela ST-11 (issue #114): a seleção do Peão
// deixa de gerar Recebimento — o Recebimento do Peão já posicionado passou a
// pertencer à camada da Partida (partida.ts), via gerarRecebidas exportada.
//
// Handlers do ciclo do Peão, extraídos de tabuleiro.ts (W2 da review #107):
// o estado, os tipos de comando/evento/erro e o dispatch
// aplicarComandoDeTabuleiro permanecem em tabuleiro.ts, que importa daqui os
// handlers. A dependência em runtime é única — tabuleiro.ts → peoes.ts —
// então este módulo importa apenas TIPOS de tabuleiro.ts e hospeda a camada
// base compartilhada por ambos (resultado, rejeição, validação, grade,
// rotação, bordas abertas e busca de peças posicionadas). Domínio puro e
// imutável: nenhum contrato wire, Redis ou Express vive aqui.

import assert from 'node:assert/strict';

import type {
  BordaCardinal,
  Celula,
  CodigoDeErroDeTabuleiro,
  EscolherTipoDaPecaRecebidaComando,
  EstadoDoTabuleiro,
  EventoDoTabuleiro,
  GirarPecaComando,
  MoverPeaoComando,
  OperacaoBemSucedidaDoTabuleiro,
  OperacaoRejeitadaDoTabuleiro,
  Orientacao,
  PecaPosicionada,
  PecaRecebida,
  PermanecerComando,
  PosicionarPecaComando,
  PosicionarPeaoComando,
  ResultadoDoTabuleiro,
  SelecionarPeaoComando,
  SentidoDeRotacao,
  TipoDaPeca,
  TipoDePecaDeCaminho,
} from './tabuleiro.ts';

export const LADO_DA_GRADE = 7;

// Bordas abertas da Orientação base (0°), por tipo: Inicial norte+leste
// (adjacentes), Reta norte+sul (opostas), T norte+leste+oeste, Cruz e as
// Especiais (ST-12) todas as quatro abertas.
const BORDAS_BASE: Record<TipoDaPeca, readonly BordaCardinal[]> = {
  inicial: ['norte', 'leste'],
  reta: ['norte', 'sul'],
  T: ['norte', 'leste', 'oeste'],
  cruz: ['norte', 'leste', 'sul', 'oeste'],
  gerador: ['norte', 'leste', 'sul', 'oeste'],
  sala_do_diretor: ['norte', 'leste', 'sul', 'oeste'],
  sala_medica: ['norte', 'leste', 'sul', 'oeste'],
  portao_de_saida: ['norte', 'leste', 'sul', 'oeste'],
};

const ORDEM_CANONICA_DAS_BORDAS: readonly BordaCardinal[] = [
  'norte',
  'leste',
  'sul',
  'oeste',
];

const ROTACAO_HORARIA_DA_BORDA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'leste',
  leste: 'sul',
  sul: 'oeste',
  oeste: 'norte',
};

const BORDA_OPOSTA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'sul',
  sul: 'norte',
  leste: 'oeste',
  oeste: 'leste',
};

const DESLOCAMENTO_DA_BORDA: Record<BordaCardinal, Celula> = {
  norte: { linha: -1, coluna: 0 },
  leste: { linha: 0, coluna: 1 },
  sul: { linha: 1, coluna: 0 },
  oeste: { linha: 0, coluna: -1 },
};

// Bordas abertas derivadas do tipo e da Orientação: parte-se da base do tipo
// e aplica-se a rotação horária correspondente aos passos de 90° da
// Orientação. Resultado em ordem canônica para determinismo.
export function bordasAbertas(
  peca: Pick<PecaPosicionada, 'tipo' | 'orientacao'>,
): BordaCardinal[] {
  let bordas = BORDAS_BASE[peca.tipo];
  for (let passos = peca.orientacao / 90; passos > 0; passos--) {
    bordas = bordas.map((borda) => ROTACAO_HORARIA_DA_BORDA[borda]);
  }
  return ORDEM_CANONICA_DAS_BORDAS.filter((borda) => bordas.includes(borda));
}

// Célula vizinha na direção da borda, ou null quando cai fora da grade.
function celulaVizinhaNaBorda(
  celula: Celula,
  borda: BordaCardinal,
): Celula | null {
  const deslocamento = DESLOCAMENTO_DA_BORDA[borda];
  const vizinha: Celula = {
    linha: celula.linha + deslocamento.linha,
    coluna: celula.coluna + deslocamento.coluna,
  };
  if (!estaDentroDaGrade(vizinha.linha) || !estaDentroDaGrade(vizinha.coluna)) {
    return null;
  }
  return vizinha;
}

// Conexões (ST-10): Peças posicionadas vizinhas cujas bordas abertas estão
// voltadas uma para a outra — a borda da origem e a borda oposta da vizinha.
// Consulta pura, em ordem canônica (norte, leste, sul, oeste); Peça fora do
// Tabuleiro não tem vizinhas.
export function vizinhasConectadas(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaPosicionada[] {
  const origem = encontrarPosicionada(estado, pecaId);
  if (!origem) {
    return [];
  }
  const conectadas: PecaPosicionada[] = [];
  for (const borda of bordasAbertas(origem)) {
    const celulaVizinha = celulaVizinhaNaBorda(origem.celula, borda);
    if (!celulaVizinha) {
      continue;
    }
    const vizinha = encontrarPosicionadaPorCelula(estado, celulaVizinha);
    if (!vizinha || !bordasAbertas(vizinha).includes(BORDA_OPOSTA[borda])) {
      continue;
    }
    conectadas.push(vizinha);
  }
  return conectadas;
}

export function selecionarPeao(
  estado: EstadoDoTabuleiro,
  comando: SelecionarPeaoComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.peaoId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const peao = estado.peoes.find((item) => item.peaoId === comando.peaoId);
  if (!peao) {
    return rejeitar('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }

  // Re-seleção do mesmo Peão é idempotente: não reabre o Recebimento nem
  // reemite eventos — a sequência continua exatamente como estava.
  if (estado.peaoSelecionadoId === comando.peaoId) {
    return sucesso(estado, []);
  }

  // Pendências do Peão em sequência bloqueiam a seleção de outro Peão.
  if (estado.recebidas.length > 0) {
    return rejeitar(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; posicione-as antes de selecionar outro Peão.',
    );
  }

  // Nova seleção também encerra qualquer Manipulação em aberto.
  const eventos: EventoDoTabuleiro[] = [];
  let pecaEmManipulacaoId = estado.pecaEmManipulacaoId;
  if (pecaEmManipulacaoId !== null) {
    eventos.push({
      tipo: 'manipulacao_finalizada',
      pecaId: pecaEmManipulacaoId,
    });
    pecaEmManipulacaoId = null;
  }
  eventos.push({ tipo: 'peao_selecionado', peaoId: comando.peaoId });

  // ST-11: a seleção nunca gera Recebimento — nem sobre a Mesa, nem sobre
  // Peça. Re-selecionar o próprio Peão posicionado reentra na sequência sem
  // novo Recebimento; a geração das pendências cabe à camada da Partida
  // (posicionar_peao do Primeiro Turno e confirmar_posicao_do_peao).
  return sucesso(
    { ...estado, peaoSelecionadoId: comando.peaoId, pecaEmManipulacaoId },
    eventos,
  );
}

// Recebimento (ST-10): um slot para cada borda aberta da Peça sob o Peão cuja
// célula vizinha está vazia (dentro da grade). A célula-alvo é fixada na
// criação; o tipo só é escolhido depois, consumindo a Caixa. Exportada para
// a camada da Partida (ST-11), que decide quando o Recebimento acontece.
export function gerarRecebidas(
  estado: EstadoDoTabuleiro,
  peca: PecaPosicionada,
): PecaRecebida[] {
  const recebidas: PecaRecebida[] = [];
  for (const borda of bordasAbertas(peca)) {
    const celulaAlvo = celulaVizinhaNaBorda(peca.celula, borda);
    if (!celulaAlvo || encontrarPosicionadaPorCelula(estado, celulaAlvo)) {
      continue;
    }
    recebidas.push({
      recebidaId: `recebida-${peca.pecaId}-${borda}`,
      bordaGeradora: borda,
      celulaAlvo,
      pecaId: null,
      tipo: null,
      orientacao: 0,
    });
  }
  return recebidas;
}

export function posicionarPeao(
  estado: EstadoDoTabuleiro,
  comando: PosicionarPeaoComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.peaoId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const celulaInvalida = exigirCelulaNoAlcance(comando.celula);
  if (celulaInvalida) {
    return celulaInvalida;
  }

  const peao = estado.peoes.find((item) => item.peaoId === comando.peaoId);
  if (!peao) {
    return rejeitar('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }

  // O encaixe pertence à sequência do Peão: só o Peão selecionado se encaixa,
  // e sem pendências em aberto — comando fora de ordem não pode órfanar as
  // pendências de outro Peão (mesmo padrão de mover/permanecer).
  if (estado.peaoSelecionadoId !== peao.peaoId) {
    return rejeitar('PEAO_NAO_SELECIONADO', 'O Peão indicado não é o selecionado.');
  }
  if (estado.recebidas.length > 0) {
    return rejeitar(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; resolva-as antes de posicionar o Peão.',
    );
  }

  // O primeiro posicionamento é a entrada do Peão no ciclo; depois, a posição
  // muda apenas por movimentação entre Peças conectadas.
  if (peao.pecaId !== null) {
    return rejeitar(
      'PEAO_JA_POSICIONADO',
      'O Peão já está posicionado sobre uma Peça.',
    );
  }

  const peca = encontrarPosicionadaPorCelula(estado, comando.celula);
  if (!peca) {
    return rejeitar('CELULA_SEM_PECA', 'A Célula não contém uma Peça.');
  }

  // O primeiro posicionamento só é aceito sobre a Peça Inicial.
  if (peca.tipo !== 'inicial') {
    return rejeitar(
      'PECA_INICIAL_EXIGIDA',
      'O primeiro posicionamento do Peão deve ser sobre a Peça Inicial.',
    );
  }

  if (estado.peoes.some((item) => item.pecaId === peca.pecaId)) {
    return rejeitar('PECA_JA_TEM_PEAO', 'A Peça já abriga outro Peão.');
  }

  const peoes = estado.peoes.map((item) =>
    item.peaoId === peao.peaoId ? { ...item, pecaId: peca.pecaId } : item,
  );
  // O encaixe deseleciona o Peão: a sequência só começa quando o Peão já
  // posicionado é re-selecionado (sem Recebimento na seleção, ST-11).
  return sucesso(
    { ...estado, peoes, peaoSelecionadoId: null },
    [
      {
        tipo: 'peao_posicionado',
        peaoId: peao.peaoId,
        pecaId: peca.pecaId,
        celula: comando.celula,
      },
    ],
  );
}

export function escolherTipoDaPecaRecebida(
  estado: EstadoDoTabuleiro,
  comando: EscolherTipoDaPecaRecebidaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.recebidaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  if (
    comando.tipoDaPeca !== 'reta' &&
    comando.tipoDaPeca !== 'T' &&
    comando.tipoDaPeca !== 'cruz'
  ) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'O tipo da Peça Recebida deve ser "reta", "T" ou "cruz".',
    );
  }

  // A escolha do tipo pertence à sequência do Peão selecionado: todo sub-fluxo
  // do Recebimento exige um Peão em sequência.
  if (estado.peaoSelecionadoId === null) {
    return rejeitar(
      'PEAO_NAO_SELECIONADO',
      'Nenhum Peão está selecionado; o Recebimento pertence à sequência dele.',
    );
  }

  const recebida = estado.recebidas.find(
    (item) => item.recebidaId === comando.recebidaId,
  );
  if (!recebida) {
    return rejeitar(
      'RECEBIDA_NAO_ENCONTRADA',
      'A Peça Recebida não foi encontrada.',
    );
  }

  if (recebida.pecaId !== null) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'A Peça Recebida indicada já tem o tipo escolhido.',
    );
  }

  // Consumo determinístico da Caixa (ST-12): a primeira Peça do tipo pedido,
  // que deixa a Caixa e passa a pertencer ao slot da Recebida. Fluxo legado
  // do Recebimento (ST-10) — o sorteio unitário da #139 substituirá a escolha
  // do tipo.
  const peca = estado.caixa.find((item) => item.tipo === comando.tipoDaPeca);
  if (!peca) {
    return rejeitar(
      'CAIXA_ESGOTADA',
      `A Caixa não possui Peças do tipo "${comando.tipoDaPeca}".`,
    );
  }

  // A escolha também encerra qualquer Manipulação em aberto.
  const eventos: EventoDoTabuleiro[] = [];
  let pecaEmManipulacaoId = estado.pecaEmManipulacaoId;
  if (pecaEmManipulacaoId !== null) {
    eventos.push({
      tipo: 'manipulacao_finalizada',
      pecaId: pecaEmManipulacaoId,
    });
    pecaEmManipulacaoId = null;
  }
  eventos.push({
    tipo: 'tipo_da_peca_recebida_escolhido',
    recebidaId: recebida.recebidaId,
    pecaId: peca.pecaId,
    tipoDaPeca: comando.tipoDaPeca,
  });

  // A escolha torna a Peça atribuída a "selecionada" (reuso da Seleção única
  // da ST-09), para que girar_peca funcione com o mesmo padrão das Iniciais.
  return sucesso(
    {
      ...estado,
      caixa: estado.caixa.filter((item) => item.pecaId !== peca.pecaId),
      recebidas: estado.recebidas.map((item) =>
        item.recebidaId === recebida.recebidaId
          ? // A Recebida nasce na Orientação base (0°): a Caixa é opaca e a
            // orientação da Peça consumida é sempre a de composição; o giro
            // deliberado da Recebida fica em girar_peca.
            { ...item, pecaId: peca.pecaId, tipo: comando.tipoDaPeca, orientacao: 0 }
          : item,
      ),
      pecaSelecionadaId: peca.pecaId,
      pecaEmManipulacaoId,
    },
    eventos,
  );
}

export function moverPeao(
  estado: EstadoDoTabuleiro,
  comando: MoverPeaoComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.peaoId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const celulaInvalida = exigirCelulaNoAlcance(comando.celula);
  if (celulaInvalida) {
    return celulaInvalida;
  }

  const peao = estado.peoes.find((item) => item.peaoId === comando.peaoId);
  if (!peao) {
    return rejeitar('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }

  // Mover pertence à sequência: o Peão indicado deve ser o selecionado e
  // estar sobre uma Peça (Peão sobre a Mesa não está em sequência).
  if (estado.peaoSelecionadoId !== peao.peaoId) {
    return rejeitar('PEAO_NAO_SELECIONADO', 'O Peão indicado não é o selecionado.');
  }
  if (peao.pecaId === null) {
    return rejeitar(
      'PEAO_NAO_SELECIONADO',
      'O Peão está sobre a Mesa; posicione-o antes de movê-lo.',
    );
  }

  if (estado.recebidas.length > 0) {
    return rejeitar(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; posicione-as antes de mover o Peão.',
    );
  }

  const origem = encontrarPosicionada(estado, peao.pecaId);
  if (!origem) {
    return rejeitar('PEAO_NAO_SELECIONADO', 'A Peça do Peão não foi encontrada.');
  }

  const alvo = encontrarPosicionadaPorCelula(estado, comando.celula);
  if (!alvo) {
    return rejeitar('CELULA_SEM_PECA', 'A Célula de destino não contém uma Peça.');
  }

  if (
    !vizinhasConectadas(estado, origem.pecaId).some(
      (item) => item.pecaId === alvo.pecaId,
    )
  ) {
    return rejeitar(
      'MOVIMENTO_NAO_CONECTADO',
      'A Peça de destino não é uma vizinha conectada à Peça do Peão.',
    );
  }

  if (estado.peoes.some((item) => item.pecaId === alvo.pecaId)) {
    return rejeitar('PECA_JA_TEM_PEAO', 'A Peça de destino já abriga outro Peão.');
  }

  const peoes = estado.peoes.map((item) =>
    item.peaoId === peao.peaoId ? { ...item, pecaId: alvo.pecaId } : item,
  );
  // Mover encerra a sequência implicitamente e deseleciona o Peão; o
  // Recebimento da Peça recém-ocupada (quando houve mudança de Peça) cabe à
  // camada da Partida, na Confirmação de Posição (ST-11).
  return sucesso(
    { ...estado, peoes, peaoSelecionadoId: null },
    [
      {
        tipo: 'peao_movido',
        peaoId: peao.peaoId,
        pecaIdDe: origem.pecaId,
        pecaIdPara: alvo.pecaId,
        celula: comando.celula,
      },
    ],
  );
}

export function permanecer(
  estado: EstadoDoTabuleiro,
  comando: PermanecerComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.peaoId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const peao = estado.peoes.find((item) => item.peaoId === comando.peaoId);
  if (!peao) {
    return rejeitar('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }

  // Permanecer pertence à sequência, como mover.
  if (estado.peaoSelecionadoId !== peao.peaoId) {
    return rejeitar('PEAO_NAO_SELECIONADO', 'O Peão indicado não é o selecionado.');
  }
  if (peao.pecaId === null) {
    return rejeitar(
      'PEAO_NAO_SELECIONADO',
      'O Peão está sobre a Mesa; posicione-o antes de permanecer.',
    );
  }

  if (estado.recebidas.length > 0) {
    return rejeitar(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; posicione-as antes de permanecer.',
    );
  }

  // Permanecer encerra a sequência implicitamente e deseleciona o Peão.
  return sucesso(
    { ...estado, peaoSelecionadoId: null },
    [{ tipo: 'peao_permaneceu', peaoId: peao.peaoId, pecaId: peao.pecaId }],
  );
}

// Encaixe de Peça Recebida: a célula é fixa (a célula-alvo fixada no
// Recebimento), com Orientação livre e SEM exigência de conexão com a Peça
// geradora (ST-10). A Recebida sai da lista de pendências e a janela de
// Manipulação da ST-09 abre como em qualquer Encaixe — girar a peça
// posicionada vai pela janela, sem consultar a seleção. A seleção é limpa no
// encaixe; a próxima escolha de tipo seleciona a próxima Recebida.
export function posicionarRecebida(
  estado: EstadoDoTabuleiro,
  recebida: PecaRecebida,
  comando: PosicionarPecaComando,
): ResultadoDoTabuleiro {
  // O encaixe da Recebida pertence à sequência do Peão selecionado.
  if (estado.peaoSelecionadoId === null) {
    return rejeitar(
      'PEAO_NAO_SELECIONADO',
      'Nenhum Peão está selecionado; o Recebimento pertence à sequência dele.',
    );
  }

  // Invariante do roteamento: encontrarRecebidaPorPeca só alcança Recebidas
  // com o tipo já escolhido; o assert estreita os tipos sem rejeição morta.
  assert.ok(
    recebida.pecaId !== null && recebida.tipo !== null,
    'Recebida sem tipo escolhido alcançou o encaixe.',
  );

  if (
    comando.celula.linha !== recebida.celulaAlvo.linha ||
    comando.celula.coluna !== recebida.celulaAlvo.coluna
  ) {
    return rejeitar(
      'PECA_FORA_DO_ALVO',
      'A Peça Recebida só pode ser posicionada na célula-alvo da borda que a gerou.',
    );
  }

  if (encontrarPosicionadaPorCelula(estado, comando.celula)) {
    return rejeitar(
      'CELULA_JA_OCUPADA',
      'A Célula já está ocupada por outra Peça.',
    );
  }

  const posicionada: PecaPosicionada = {
    pecaId: recebida.pecaId,
    tipo: recebida.tipo,
    orientacao: recebida.orientacao,
    celula: comando.celula,
  };
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    recebidas: estado.recebidas.filter(
      (item) => item.recebidaId !== recebida.recebidaId,
    ),
    posicionadas: [...estado.posicionadas, posicionada],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: posicionada.pecaId,
  };
  return sucesso(novoEstado, [
    {
      tipo: 'peca_posicionada',
      pecaId: posicionada.pecaId,
      celula: posicionada.celula,
      orientacao: posicionada.orientacao,
    },
  ]);
}

export function girarRecebida(
  estado: EstadoDoTabuleiro,
  recebida: PecaRecebida,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const orientacaoNova = rotacionar(recebida.orientacao, comando.sentido);
  const recebidas = estado.recebidas.map((item) =>
    item.recebidaId === recebida.recebidaId
      ? { ...item, orientacao: orientacaoNova }
      : item,
  );
  return sucesso(
    { ...estado, recebidas },
    [
      {
        tipo: 'peca_girada',
        pecaId: comando.pecaId,
        orientacaoAnterior: recebida.orientacao,
        orientacao: orientacaoNova,
        sentido: comando.sentido,
      },
    ],
  );
}

export function encontrarRecebidaPorPeca(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaRecebida | undefined {
  return estado.recebidas.find((item) => item.pecaId === pecaId);
}

// Rotação em passos discretos de 90° com wrap-around (270° +90 volta a 0°).
export function rotacionar(
  orientacao: Orientacao,
  sentido: SentidoDeRotacao,
): Orientacao {
  const passo = sentido === 'horario' ? 90 : 270;
  return ((orientacao + passo) % 360) as Orientacao;
}

export function estaDentroDaGrade(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0 && valor < LADO_DA_GRADE;
}

export function exigirCelulaNoAlcance(
  celula: Celula,
): OperacaoRejeitadaDoTabuleiro | undefined {
  if (!Number.isInteger(celula.linha) || !Number.isInteger(celula.coluna)) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'Linha e coluna da Célula devem ser números inteiros.',
    );
  }
  if (!estaDentroDaGrade(celula.linha) || !estaDentroDaGrade(celula.coluna)) {
    return rejeitar(
      'CELULA_NAO_ENCONTRADA',
      'A Célula está fora da grade 7x7 do Tabuleiro.',
    );
  }
  return undefined;
}

export function encontrarPosicionada(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaPosicionada | undefined {
  return estado.posicionadas.find((peca) => peca.pecaId === pecaId);
}

export function encontrarPosicionadaPorCelula(
  estado: EstadoDoTabuleiro,
  celula: Celula,
): PecaPosicionada | undefined {
  return estado.posicionadas.find(
    (peca) =>
      peca.celula.linha === celula.linha &&
      peca.celula.coluna === celula.coluna,
  );
}

export function validarTexto(
  ...valores: readonly string[]
): OperacaoRejeitadaDoTabuleiro | undefined {
  if (valores.every((valor) => typeof valor === 'string' && valor.trim().length > 0)) {
    return undefined;
  }
  return rejeitar(
    'DADOS_INVALIDOS',
    'O identificador da Peça é obrigatório.',
  );
}

export function sucesso(
  estado: EstadoDoTabuleiro,
  eventos: readonly EventoDoTabuleiro[],
): OperacaoBemSucedidaDoTabuleiro {
  return { sucesso: true, estado, eventos };
}

export function rejeitar(
  codigo: CodigoDeErroDeTabuleiro,
  mensagem: string,
): OperacaoRejeitadaDoTabuleiro {
  return {
    sucesso: false,
    erro: { tipo: 'erro_de_dominio', codigo, mensagem },
  };
}
