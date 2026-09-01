// Domínio puro dos Peões, conexões, Recebimento e ciclo da sequência
// (ST-10 / issue #89), refinado pela ST-11 (issue #114): a seleção do Peão
// deixa de gerar Recebimento — o Recebimento do Peão já posicionado passou a
// pertencer à camada da Partida (partida.ts), via gerarRecebidas exportada —
// e pela ST-12 / issue #138: o Recebimento sorteia as peças da Caixa (uma a
// uma) e o Jogador escolhe a vaga de cada peça sorteada
// (escolher_vaga_da_peca_recebida), sem escolha de tipo no domínio.
//
// Handlers do ciclo do Peão, extraídos de tabuleiro.ts (W2 da review #107):
// o estado, os tipos de comando/evento/erro e o dispatch
// aplicarComandoDeTabuleiro permanecem em tabuleiro.ts, que importa daqui os
// handlers. A dependência em runtime é única — tabuleiro.ts → peoes.ts —
// então este módulo importa apenas TIPOS de tabuleiro.ts e hospeda a camada
// base compartilhada por ambos (resultado, rejeição, validação, grade,
// rotação, bordas abertas e busca de peças posicionadas). Domínio puro e
// imutável: nenhum contrato wire, Redis ou Express vive aqui.

import type {
  BordaCardinal,
  Celula,
  CodigoDeErroDeTabuleiro,
  EscolherVagaDaPecaRecebidaComando,
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
} from './tabuleiro.ts';

export const LADO_DA_GRADE = 7;

// Bordas abertas da Orientação base (0°), por tipo: Inicial norte+leste
// (adjacentes), Reta norte+sul (opostas), T norte+leste+oeste, Cruz, as
// Especiais (ST-12) e os Monstros (ST-15 / issue #169) todas as quatro
// abertas.
const BORDAS_BASE: Record<TipoDaPeca, readonly BordaCardinal[]> = {
  inicial: ['norte', 'leste'],
  reta: ['norte', 'sul'],
  T: ['norte', 'leste', 'oeste'],
  cruz: ['norte', 'leste', 'sul', 'oeste'],
  gerador: ['norte', 'leste', 'sul', 'oeste'],
  sala_do_diretor: ['norte', 'leste', 'sul', 'oeste'],
  sala_medica: ['norte', 'leste', 'sul', 'oeste'],
  portao_de_saida: ['norte', 'leste', 'sul', 'oeste'],
  vulto: ['norte', 'leste', 'sul', 'oeste'],
  espectro: ['norte', 'leste', 'sul', 'oeste'],
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

// Monstros (ST-15 / issue #169): categoria própria de peça da Caixa — não
// entram em TipoDePecaEspecial. São sorteados e posicionados pelo fluxo do
// Recebimento como peça comum, sem janela de Manipulação e sem aceitar Peão.
export function ehPecaDeMonstro(tipo: TipoDaPeca): boolean {
  return tipo === 'vulto' || tipo === 'espectro';
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

// Vagas de Recebimento (ST-12 / issue #138): bordas abertas da Peça geradora
// cuja célula vizinha está vazia (dentro da grade), excluindo as já escolhidas
// pelas pendências informadas. Em ordem canônica (norte, leste, sul, oeste).
export function vagasDisponiveis(
  estado: EstadoDoTabuleiro,
  peca: PecaPosicionada,
  recebidas: readonly PecaRecebida[] = [],
): { borda: BordaCardinal; celula: Celula }[] {
  const vagas: { borda: BordaCardinal; celula: Celula }[] = [];
  for (const borda of bordasAbertas(peca)) {
    if (recebidas.some((item) => item.vaga === borda)) {
      continue;
    }
    const celula = celulaVizinhaNaBorda(peca.celula, borda);
    if (!celula || encontrarPosicionadaPorCelula(estado, celula)) {
      continue;
    }
    vagas.push({ borda, celula });
  }
  return vagas;
}

export interface RecebimentoGerado {
  // Estado com a Caixa já consumida pelo sorteio.
  readonly estado: EstadoDoTabuleiro;
  // Uma pendência por peça sorteada, com vaga nula até a escolha.
  readonly recebidas: PecaRecebida[];
  // Um peca_sorteada por peça retirada da Caixa, em ordem de sorteio.
  readonly eventos: EventoDoTabuleiro[];
}

// Recebimento (ST-12 / issue #138): sorteia N = min(vagas, caixa) peças da
// Caixa — uma a uma, consumindo a primeira peça restante N vezes — e cria uma
// pendência por peça sorteada, sem vaga: a escolha da vaga de cada peça é o
// comando escolher_vaga_da_peca_recebida. Caixa vazia ou insuficiente NÃO é
// erro: N apenas diminui (o Jogador recebe as restantes; sem Caixa, nenhuma).
// Exportada para a camada da Partida (ST-11), que decide quando o Recebimento
// acontece. O consumo da primeira peça espelha a primitiva sortearDaCaixa
// (tabuleiro.ts) — a dependência em runtime é única (tabuleiro.ts → peoes.ts),
// então o sorteio é refeito aqui em sequência.
export function gerarRecebidas(
  estado: EstadoDoTabuleiro,
  peca: PecaPosicionada,
): RecebimentoGerado {
  const quantidade = Math.min(
    vagasDisponiveis(estado, peca).length,
    estado.caixa.length,
  );
  const eventos: EventoDoTabuleiro[] = [];
  let caixa = estado.caixa;
  const recebidas: PecaRecebida[] = [];
  for (let indice = 0; indice < quantidade; indice++) {
    const [sorteada, ...resto] = caixa;
    // A quantidade é limitada pela Caixa: a primeira peça sempre existe.
    caixa = resto;
    eventos.push({
      tipo: 'peca_sorteada',
      pecaId: sorteada.pecaId,
      tipoDaPeca: sorteada.tipo,
      orientacao: sorteada.orientacao,
    });
    recebidas.push({
      recebidaId: `recebida-${sorteada.pecaId}`,
      pecaId: sorteada.pecaId,
      tipo: sorteada.tipo,
      orientacao: sorteada.orientacao,
      vaga: null,
      celulaAlvo: null,
    });
  }
  return { estado: { ...estado, caixa }, recebidas, eventos };
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

// Escolha da vaga (issue #138): o Jogador escolhe, POR peça sorteada, a vaga
// que ela ocupa — uma borda aberta da Peça sob o Peão com célula vizinha
// vazia, ainda não escolhida por outra pendência. Fixa a borda e a célula-alvo
// da pendência e seleciona a Peça sorteada (mesmo padrão da escolha do tipo
// do legado ST-10).
export function escolherVagaDaPecaRecebida(
  estado: EstadoDoTabuleiro,
  comando: EscolherVagaDaPecaRecebidaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.recebidaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  // A escolha da vaga pertence à sequência do Peão selecionado: todo
  // sub-fluxo do Recebimento exige um Peão em sequência.
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

  if (recebida.vaga !== null) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'A Peça Recebida indicada já tem a vaga escolhida.',
    );
  }

  // A vaga deriva da Peça sob o Peão selecionado: é dela que as bordas
  // abertas com célula vizinha vazia são calculadas.
  const peao = estado.peoes.find(
    (item) => item.peaoId === estado.peaoSelecionadoId,
  );
  const pecaSobOPeao = peao?.pecaId
    ? encontrarPosicionada(estado, peao.pecaId)
    : undefined;
  if (!pecaSobOPeao) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'O Peão selecionado não está sobre uma Peça; não há vagas a escolher.',
    );
  }

  const vaga = vagasDisponiveis(estado, pecaSobOPeao, estado.recebidas).find(
    (candidata) => candidata.borda === comando.borda,
  );
  if (!vaga) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'A borda indicada não é uma vaga disponível: deve ser borda aberta da Peça sob o Peão, com célula vizinha vazia e ainda não escolhida.',
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
    tipo: 'vaga_da_peca_recebida_escolhida',
    recebidaId: recebida.recebidaId,
    borda: vaga.borda,
    celulaAlvo: vaga.celula,
  });

  // A escolha torna a Peça sorteada a "selecionada" (reuso da Seleção única
  // da ST-09), para que girar_peca funcione com o mesmo padrão das Iniciais.
  return sucesso(
    {
      ...estado,
      recebidas: estado.recebidas.map((item) =>
        item.recebidaId === recebida.recebidaId
          ? { ...item, vaga: vaga.borda, celulaAlvo: vaga.celula }
          : item,
      ),
      pecaSelecionadaId: recebida.pecaId,
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

  // Monstros (ST-15 / issue #169) não aceitam Peão: a regra é absoluta — a
  // rejeição ocorre antes da consulta de vizinhança, aplicando-se mesmo a um
  // Monstro fora da conexão — com o código fechado existente PECA_JA_TEM_PEAO
  // (mesmo precedente da ocupação do Portão da issue #176); nenhum código de
  // erro novo. O estado permanece inalterado.
  if (ehPecaDeMonstro(alvo.tipo)) {
    return rejeitar(
      'PECA_JA_TEM_PEAO',
      'A Peça de destino é um Monstro e não aceita Peão.',
    );
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

  // Ocupação (issue #176): a peça de destino portao_de_saida aceita até 4
  // peões (a reunião deles no Portão é condição de vitória); as demais
  // peças continuam no máximo 1. Com 4 peões no jogo, o teto do portão é
  // inalcançável — nenhum código de erro novo; peça comum ocupada segue
  // PECA_JA_TEM_PEAO. O peão em movimento ainda aponta para a origem, então
  // não se conta a si mesmo.
  const ocupantes = estado.peoes.filter(
    (item) => item.pecaId === alvo.pecaId,
  ).length;
  const teto = alvo.tipo === 'portao_de_saida' ? 4 : 1;
  if (ocupantes >= teto) {
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

// Encaixe de Peça Recebida: a célula é fixa (a célula-alvo derivada da vaga
// escolhida), com Orientação livre e SEM exigência de conexão com a Peça
// geradora (ST-10). A Recebida sai da lista de pendências e a janela de
// Manipulação da ST-09 abre como em qualquer Encaixe — girar a peça
// posicionada vai pela janela, sem consultar a seleção. A seleção é limpa no
// encaixe; a próxima escolha de vaga seleciona a próxima Recebida. Exceção
// (ST-15 / issue #169): Monstros NÃO abrem janela de Manipulação —
// pecaEmManipulacaoId permanece null no novo estado.
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

  // Roteamento por pecaId alcança pendências com e sem vaga: encaixe sem a
  // vaga escolhida é rejeição de domínio (a célula-alvo ainda não existe).
  if (recebida.vaga === null || recebida.celulaAlvo === null) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'A Peça Recebida ainda não tem a vaga escolhida; escolha a vaga antes de encaixar.',
    );
  }

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
    // Monstros (ST-15 / issue #169) não têm janela de Manipulação: o encaixe
    // não abre a janela; Peças de caminho e Especiais mantêm o comportamento
    // atual (abrem a janela da peça posicionada).
    pecaEmManipulacaoId: ehPecaDeMonstro(posicionada.tipo)
      ? null
      : posicionada.pecaId,
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
