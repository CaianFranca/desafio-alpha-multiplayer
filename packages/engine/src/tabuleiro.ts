// Domínio puro do Tabuleiro (ST-09 / issue #82 e ST-10 / issue #89).
//
// Seam único das regras de tabuleiro: grade fixa 7x7 (ADR-0004), Reserva,
// Seleção única e janela de Manipulação (ST-09), Peões, conexões, Recebimento
// e o ciclo da sequência (ST-10), expostos por um aplicarComando que produz
// eventos de domínio e rejeições com códigos fechados — no mesmo padrão do
// domínio do lobby (lobby.ts). Nenhum contrato wire, Redis ou Express vive
// aqui: este módulo é domínio puro e imutável.

export const LADO_DA_GRADE = 7;

export type TipoDaPeca = 'inicial' | 'reta' | 'T' | 'cruz';
export type Orientacao = 0 | 90 | 180 | 270;
export type SentidoDeRotacao = 'horario' | 'anti_horario';
export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

export interface Celula {
  readonly linha: number;
  readonly coluna: number;
}

export interface PecaDaReserva {
  readonly pecaId: string;
  readonly tipo: TipoDaPeca;
  readonly orientacao: Orientacao;
}

export interface PecaPosicionada {
  readonly pecaId: string;
  readonly tipo: TipoDaPeca;
  readonly orientacao: Orientacao;
  readonly celula: Celula;
}

export type CorDoPeao = 'branco' | 'vermelho' | 'azul' | 'amarelo';

// Peças de caminho (reta, T, cruz) — a Peça Inicial nunca é Recebida.
export type TipoDePecaDeCaminho = Exclude<TipoDaPeca, 'inicial'>;

// O Peão é um elemento simples: cor e posição — sobre a Mesa (pecaId null) ou
// sobre exatamente uma Peça posicionada (uma Peça aceita no máximo um Peão).
export interface Peao {
  readonly peaoId: string;
  readonly cor: CorDoPeao;
  readonly pecaId: string | null;
}

// Slot do Recebimento (ST-10): criado ao selecionar um Peão posicionado, um
// para cada borda aberta com célula vizinha vazia. Não contém Peça até a
// escolha do tipo (escolher_tipo_da_peca_recebida), que atribui pecaId e tipo
// a partir da Reserva.
export interface PecaRecebida {
  readonly recebidaId: string;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
  readonly pecaId: string | null;
  readonly tipo: TipoDePecaDeCaminho | null;
  readonly orientacao: Orientacao;
}

// `pecaSelecionadaId` aponta para uma peça da Reserva (Seleção única) ou, no
// ciclo do Peão, para a Peça atribuída à Recebida escolhida mais recentemente.
// `pecaEmManipulacaoId` aponta para a última peça posicionada enquanto sua
// janela de Manipulação está aberta; Finalização (nova seleção, novo
// posicionamento ou clique na própria peça posicionada) fecha a janela.
export interface EstadoDoTabuleiro {
  readonly reserva: readonly PecaDaReserva[];
  readonly posicionadas: readonly PecaPosicionada[];
  readonly pecaSelecionadaId: string | null;
  readonly pecaEmManipulacaoId: string | null;
  // ST-10: Peões, o Peão em sequência e as pendências do Recebimento.
  readonly peoes: readonly Peao[];
  readonly peaoSelecionadoId: string | null;
  readonly recebidas: readonly PecaRecebida[];
}

export interface SelecionarPecaComando {
  readonly tipo: 'selecionar_peca';
  readonly pecaId: string;
}

export interface GirarPecaComando {
  readonly tipo: 'girar_peca';
  readonly pecaId: string;
  readonly sentido: SentidoDeRotacao;
}

export interface PosicionarPecaComando {
  readonly tipo: 'posicionar_peca';
  readonly pecaId: string;
  readonly celula: Celula;
}

export interface FinalizarManipulacaoComando {
  readonly tipo: 'finalizar_manipulacao';
}

export interface SelecionarPeaoComando {
  readonly tipo: 'selecionar_peao';
  readonly peaoId: string;
}

export interface PosicionarPeaoComando {
  readonly tipo: 'posicionar_peao';
  readonly peaoId: string;
  readonly celula: Celula;
}

export interface EscolherTipoDaPecaRecebidaComando {
  readonly tipo: 'escolher_tipo_da_peca_recebida';
  readonly recebidaId: string;
  // O discriminador da união ocupa o nome "tipo"; o tipo da Peça de caminho
  // escolhido na Reserva vem em "tipoDaPeca".
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

export interface MoverPeaoComando {
  readonly tipo: 'mover_peao';
  readonly peaoId: string;
  readonly celula: Celula;
}

export interface PermanecerComando {
  readonly tipo: 'permanecer';
  readonly peaoId: string;
}

export type ComandoDeTabuleiro =
  | SelecionarPecaComando
  | GirarPecaComando
  | PosicionarPecaComando
  | FinalizarManipulacaoComando
  | SelecionarPeaoComando
  | PosicionarPeaoComando
  | EscolherTipoDaPecaRecebidaComando
  | MoverPeaoComando
  | PermanecerComando;

export interface PecaSelecionadaEvento {
  readonly tipo: 'peca_selecionada';
  readonly pecaId: string;
}

export interface PecaDeselecionadaEvento {
  readonly tipo: 'peca_deselecionada';
  readonly pecaId: string;
}

export interface PecaGiradaEvento {
  readonly tipo: 'peca_girada';
  readonly pecaId: string;
  readonly orientacaoAnterior: Orientacao;
  readonly orientacao: Orientacao;
  readonly sentido: SentidoDeRotacao;
}

export interface PecaPosicionadaEvento {
  readonly tipo: 'peca_posicionada';
  readonly pecaId: string;
  readonly celula: Celula;
  readonly orientacao: Orientacao;
}

export interface ManipulacaoFinalizadaEvento {
  readonly tipo: 'manipulacao_finalizada';
  readonly pecaId: string;
}

export interface PeaoSelecionadoEvento {
  readonly tipo: 'peao_selecionado';
  readonly peaoId: string;
}

// Pendências geradas pelo Recebimento: um slot por borda aberta com célula
// vizinha vazia, com a célula-alvo já fixada.
export interface PendenciaDeRecebimento {
  readonly recebidaId: string;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
}

export interface RecebimentoGeradoEvento {
  readonly tipo: 'recebimento_gerado';
  readonly recebidas: readonly PendenciaDeRecebimento[];
}

export interface PeaoPosicionadoEvento {
  readonly tipo: 'peao_posicionado';
  readonly peaoId: string;
  readonly pecaId: string;
  readonly celula: Celula;
}

export interface TipoDaPecaRecebidaEscolhidoEvento {
  readonly tipo: 'tipo_da_peca_recebida_escolhido';
  readonly recebidaId: string;
  readonly pecaId: string;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

export interface PeaoMovidoEvento {
  readonly tipo: 'peao_movido';
  readonly peaoId: string;
  readonly pecaIdDe: string;
  readonly pecaIdPara: string;
  readonly celula: Celula;
}

export interface PeaoPermaneceuEvento {
  readonly tipo: 'peao_permaneceu';
  readonly peaoId: string;
  readonly pecaId: string;
}

export type EventoDoTabuleiro =
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | ManipulacaoFinalizadaEvento
  | PeaoSelecionadoEvento
  | RecebimentoGeradoEvento
  | PeaoPosicionadoEvento
  | TipoDaPecaRecebidaEscolhidoEvento
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento;

export type CodigoDeErroDeTabuleiro =
  | 'DADOS_INVALIDOS'
  | 'PECA_NAO_ENCONTRADA'
  | 'PECA_NAO_SELECIONADA'
  | 'RESERVA_ESGOTADA'
  | 'CELULA_NAO_ENCONTRADA'
  | 'CELULA_JA_OCUPADA'
  | 'PECA_JA_POSICIONADA'
  | 'MANIPULACAO_ENCERRADA'
  | 'PEAO_NAO_ENCONTRADO'
  | 'PEAO_JA_POSICIONADO'
  | 'PEAO_NAO_SELECIONADO'
  | 'PECA_INICIAL_EXIGIDA'
  | 'CELULA_SEM_PECA'
  | 'PECA_JA_TEM_PEAO'
  | 'PENDENCIA_NAO_RESOLVIDA'
  | 'MOVIMENTO_NAO_CONECTADO'
  | 'PECA_NAO_RECEBIDA'
  | 'PECA_FORA_DO_ALVO'
  | 'RECEBIDA_NAO_ENCONTRADA';

export interface ErroDeDominioDoTabuleiro {
  readonly tipo: 'erro_de_dominio';
  readonly codigo: CodigoDeErroDeTabuleiro;
  readonly mensagem: string;
}

export interface OperacaoBemSucedidaDoTabuleiro {
  readonly sucesso: true;
  readonly estado: EstadoDoTabuleiro;
  readonly eventos: readonly EventoDoTabuleiro[];
}

export interface OperacaoRejeitadaDoTabuleiro {
  readonly sucesso: false;
  readonly erro: ErroDeDominioDoTabuleiro;
}

export type ResultadoDoTabuleiro =
  | OperacaoBemSucedidaDoTabuleiro
  | OperacaoRejeitadaDoTabuleiro;

// Bordas abertas da Orientação base (0°), por tipo: Inicial norte+leste
// (adjacentes), Reta norte+sul (opostas), T norte+leste+oeste, Cruz todas.
const BORDAS_BASE: Record<TipoDaPeca, readonly BordaCardinal[]> = {
  inicial: ['norte', 'leste'],
  reta: ['norte', 'sul'],
  T: ['norte', 'leste', 'oeste'],
  cruz: ['norte', 'leste', 'sul', 'oeste'],
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

// Cores canônicas (placeholder) dos 4 Peões; ids determinísticos por cor.
const CORES_DOS_PEOES: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
];

const COMPOSICAO_INICIAL_DA_RESERVA: readonly {
  readonly tipo: TipoDaPeca;
  readonly quantidade: number;
}[] = [
  { tipo: 'inicial', quantidade: 4 },
  { tipo: 'reta', quantidade: 6 },
  { tipo: 'T', quantidade: 6 },
  { tipo: 'cruz', quantidade: 6 },
];

// Reserva de partida: 4 Peças Iniciais + 6 de cada tipo de caminho
// (reta, T, cruz); ids determinísticos por tipo.
export function estadoInicialDoTabuleiro(): EstadoDoTabuleiro {
  const reserva: PecaDaReserva[] = [];
  for (const entrada of COMPOSICAO_INICIAL_DA_RESERVA) {
    for (let indice = 1; indice <= entrada.quantidade; indice++) {
      reserva.push({
        pecaId: `${entrada.tipo.toLowerCase()}-${indice}`,
        tipo: entrada.tipo,
        orientacao: 0,
      });
    }
  }
  return {
    reserva,
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Os 4 Peões começam sobre a Mesa, sem Peça.
    peoes: CORES_DOS_PEOES.map((cor) => ({
      peaoId: `peao-${cor}`,
      cor,
      pecaId: null,
    })),
    peaoSelecionadoId: null,
    recebidas: [],
  };
}

// Vizinhança ortogonal (ADR-0004): apenas células que compartilham uma borda;
// diagonais não são vizinhas. As quatro direções são avaliadas em ordem fixa
// (norte, leste, sul, oeste) e as que caem fora da grade são descartadas.
export function vizinhos(celula: Celula): Celula[] {
  const candidatas: Celula[] = [
    { linha: celula.linha - 1, coluna: celula.coluna },
    { linha: celula.linha, coluna: celula.coluna + 1 },
    { linha: celula.linha + 1, coluna: celula.coluna },
    { linha: celula.linha, coluna: celula.coluna - 1 },
  ];
  return candidatas.filter((vizinha) =>
    estaDentroDaGrade(vizinha.linha) && estaDentroDaGrade(vizinha.coluna),
  );
}

// Bordas abertas derivadas do tipo e da Orientação: parte-se da base do tipo
// e aplica-se a rotação horária correspondente aos passos de 90° da
// Orientação. Resultado em ordem canônica para determinismo.
export function bordasAbertas(
  peca: Pick<PecaDaReserva, 'tipo' | 'orientacao'>,
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
  const origem = estado.posicionadas.find((peca) => peca.pecaId === pecaId);
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

export function aplicarComandoDeTabuleiro(
  estado: EstadoDoTabuleiro,
  comando: ComandoDeTabuleiro,
): ResultadoDoTabuleiro {
  switch (comando.tipo) {
    case 'selecionar_peca':
      return selecionarPeca(estado, comando);
    case 'girar_peca':
      return girarPeca(estado, comando);
    case 'posicionar_peca':
      return posicionarPeca(estado, comando);
    case 'finalizar_manipulacao':
      return finalizarManipulacao(estado);
    case 'selecionar_peao':
      return selecionarPeao(estado, comando);
    case 'posicionar_peao':
      return posicionarPeao(estado, comando);
    case 'escolher_tipo_da_peca_recebida':
      return escolherTipoDaPecaRecebida(estado, comando);
    case 'mover_peao':
      return moverPeao(estado, comando);
    case 'permanecer':
      return permanecer(estado, comando);
    default: {
      // Exaustividade: um novo ComandoDeTabuleiro sem case próprio falha a
      // compilação aqui; em runtime, entrada externa pode bypassar tipos.
      const _comandoExaustivo: never = comando;
      return rejeitar('DADOS_INVALIDOS', 'O comando de domínio é inválido.');
    }
  }
}

function selecionarPeca(
  estado: EstadoDoTabuleiro,
  comando: SelecionarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  // Clique na própria peça posicionada encerra a Manipulação (Finalização).
  if (estado.pecaEmManipulacaoId === comando.pecaId) {
    return fecharManipulacao(estado);
  }

  const peca = encontrarNaReserva(estado, comando.pecaId);
  if (peca) {
    if (
      estado.pecaSelecionadaId !== null &&
      estado.pecaSelecionadaId === comando.pecaId
    ) {
      // Clicar na própria selecionada desfaz a seleção.
      return sucesso(
        { ...estado, pecaSelecionadaId: null },
        [{ tipo: 'peca_deselecionada', pecaId: comando.pecaId }],
      );
    }

    // Nova seleção também encerra qualquer Manipulação em aberto.
    const eventos: EventoDoTabuleiro[] = [];
    if (estado.pecaEmManipulacaoId !== null) {
      eventos.push({
        tipo: 'manipulacao_finalizada',
        pecaId: estado.pecaEmManipulacaoId,
      });
    }
    eventos.push({ tipo: 'peca_selecionada', pecaId: comando.pecaId });
    return sucesso({ ...estado, pecaSelecionadaId: comando.pecaId, pecaEmManipulacaoId: null }, eventos);
  }

  if (encontrarPosicionada(estado, comando.pecaId)) {
    return rejeitar(
      'PECA_JA_POSICIONADA',
      'A Peça já foi posicionada no Tabuleiro.',
    );
  }

  return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
}

function girarPeca(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  if (
    comando.sentido !== 'horario' &&
    comando.sentido !== 'anti_horario'
  ) {
    return rejeitar(
      'DADOS_INVALIDOS',
      'O sentido deve ser "horario" ou "anti_horario".',
    );
  }

  // Janela de Manipulação aberta: apenas a própria peça posicionada pode ser
  // girada, até a Finalização.
  if (estado.pecaEmManipulacaoId !== null) {
    if (estado.pecaEmManipulacaoId === comando.pecaId) {
      return girarPosicionada(estado, comando);
    }
    if (encontrarNaReserva(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_NAO_SELECIONADA',
        'Há uma Manipulação em andamento; finalize-a antes de selecionar outra Peça.',
      );
    }
  }

  // Peça Recebida segue o mesmo padrão da Reserva: só a selecionada gira.
  const recebida = encontrarRecebidaPorPeca(estado, comando.pecaId);
  if (recebida) {
    if (estado.pecaSelecionadaId !== comando.pecaId) {
      return rejeitar(
        'PECA_NAO_SELECIONADA',
        'A Peça Recebida indicada não é a selecionada.',
      );
    }
    return girarRecebida(estado, recebida, comando);
  }

  if (estado.pecaSelecionadaId === comando.pecaId) {
    // Seleção ativa de peça da Reserva: gira nos dois sentidos.
    return girarDaReserva(estado, comando);
  }

  if (encontrarPosicionada(estado, comando.pecaId)) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'A Manipulação da Peça já foi finalizada; ela não pode mais ser girada.',
    );
  }

  if (encontrarNaReserva(estado, comando.pecaId)) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'A Peça indicada não é a selecionada.',
    );
  }

  return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
}

function posicionarPeca(
  estado: EstadoDoTabuleiro,
  comando: PosicionarPecaComando,
): ResultadoDoTabuleiro {
  const dadosInvalidos = validarTexto(comando.pecaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const celulaInvalida = exigirCelulaNoAlcance(comando.celula);
  if (celulaInvalida) {
    return celulaInvalida;
  }

  // Peças Recebidas têm fluxo próprio: célula-alvo fixa da borda geradora.
  const recebida = encontrarRecebidaPorPeca(estado, comando.pecaId);
  if (recebida) {
    return posicionarRecebida(estado, recebida, comando);
  }

  if (estado.reserva.length === 0) {
    return rejeitar('RESERVA_ESGOTADA', 'A Reserva não possui mais Peças.');
  }

  const pecaNaReserva = encontrarNaReserva(estado, comando.pecaId);
  if (!pecaNaReserva) {
    if (encontrarPosicionada(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_JA_POSICIONADA',
        'A Peça já foi posicionada no Tabuleiro.',
      );
    }
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  // ST-10: Peças de caminho só entram pelo Recebimento; apenas a Peça Inicial
  // é posicionável diretamente, em qualquer célula vazia.
  if (pecaNaReserva.tipo !== 'inicial') {
    return rejeitar(
      'PECA_NAO_RECEBIDA',
      'Peças de caminho só podem entrar pelo Recebimento.',
    );
  }

  if (estado.pecaSelecionadaId !== comando.pecaId) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'A Peça indicada não é a selecionada.',
    );
  }

  if (encontrarPosicionadaPorCelula(estado, comando.celula)) {
    return rejeitar(
      'CELULA_JA_OCUPADA',
      'A Célula já está ocupada por outra Peça.',
    );
  }

  const posicionada: PecaPosicionada = {
    pecaId: pecaNaReserva.pecaId,
    tipo: pecaNaReserva.tipo,
    orientacao: pecaNaReserva.orientacao,
    celula: comando.celula,
  };
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    reserva: estado.reserva.filter((item) => item.pecaId !== comando.pecaId),
    posicionadas: [...estado.posicionadas, posicionada],
    pecaSelecionadaId: null,
    // O Encaixe abre a janela de Manipulação da peça posicionada (e substitui
    // a de qualquer peça anterior, sempre fechada antes pela nova Seleção ou
    // pelo próprio encaixe).
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

function finalizarManipulacao(estado: EstadoDoTabuleiro): ResultadoDoTabuleiro {
  if (estado.pecaEmManipulacaoId === null) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'Não há Manipulação em andamento.',
    );
  }
  return fecharManipulacao(estado);
}

function fecharManipulacao(estado: EstadoDoTabuleiro): ResultadoDoTabuleiro {
  const pecaId = estado.pecaEmManipulacaoId;
  if (pecaId === null) {
    return rejeitar(
      'MANIPULACAO_ENCERRADA',
      'Não há Manipulação em andamento.',
    );
  }
  return sucesso(
    { ...estado, pecaEmManipulacaoId: null },
    [{ tipo: 'manipulacao_finalizada', pecaId }],
  );
}

function selecionarPeao(
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

  // Peão sobre a Mesa: a seleção não gera Recebimento.
  if (peao.pecaId === null) {
    return sucesso(
      { ...estado, peaoSelecionadoId: comando.peaoId, pecaEmManipulacaoId },
      eventos,
    );
  }

  const peca = encontrarPosicionada(estado, peao.pecaId);
  if (!peca) {
    // Estado inconsistente: o Peão aponta para uma Peça fora do Tabuleiro.
    return rejeitar('PEAO_NAO_ENCONTRADO', 'A Peça do Peão não foi encontrada.');
  }

  const recebidas = gerarRecebidas(estado, peca);
  // O evento de Recebimento só é emitido quando há pendências para resolver,
  // e carrega apenas a projeção da pendência (recebidaId, bordaGeradora e
  // celulaAlvo), sem os campos internos do slot.
  if (recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: recebidas.map(({ recebidaId, bordaGeradora, celulaAlvo }) => ({
        recebidaId,
        bordaGeradora,
        celulaAlvo,
      })),
    });
  }
  return sucesso(
    { ...estado, peaoSelecionadoId: comando.peaoId, pecaEmManipulacaoId, recebidas },
    eventos,
  );
}

// Recebimento (ST-10): um slot para cada borda aberta da Peça sob o Peão cuja
// célula vizinha está vazia (dentro da grade). A célula-alvo é fixada na
// criação; o tipo só é escolhido depois, consumindo a Reserva.
function gerarRecebidas(
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

function posicionarPeao(
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
  // O encaixe deseleciona o Peão: a sequência (e o Recebimento) só começa
  // quando o Peão já posicionado é selecionado.
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

function escolherTipoDaPecaRecebida(
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

  // Consumo determinístico: a primeira Peça do tipo na Reserva, que deixa a
  // Reserva e passa a pertencer ao slot da Recebida.
  const peca = estado.reserva.find((item) => item.tipo === comando.tipoDaPeca);
  if (!peca) {
    return rejeitar(
      'RESERVA_ESGOTADA',
      `A Reserva não possui Peças do tipo "${comando.tipoDaPeca}".`,
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
  // da ST-09), para que girar_peca funcione com o mesmo padrão da Reserva.
  return sucesso(
    {
      ...estado,
      reserva: estado.reserva.filter((item) => item.pecaId !== peca.pecaId),
      recebidas: estado.recebidas.map((item) =>
        item.recebidaId === recebida.recebidaId
          ? { ...item, pecaId: peca.pecaId, tipo: comando.tipoDaPeca, orientacao: peca.orientacao }
          : item,
      ),
      pecaSelecionadaId: peca.pecaId,
      pecaEmManipulacaoId,
    },
    eventos,
  );
}

function moverPeao(
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
  // Recebimento da Peça recém-ocupada ocorre no início da próxima sequência.
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

function permanecer(
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
// Manipulação da ST-09 abre como em qualquer Encaixe. A seleção permanece na
// Recebida escolhida mais recentemente — a próxima escolha de tipo a renova —
// para que girar_peca siga funcionando nas pendências restantes.
function posicionarRecebida(
  estado: EstadoDoTabuleiro,
  recebida: PecaRecebida,
  comando: PosicionarPecaComando,
): ResultadoDoTabuleiro {
  if (!recebida.pecaId || !recebida.tipo) {
    // Inalcançável pelos comandos: o tipo é escolhido antes de haver pecaId
    // para referenciar; guarda defensiva.
    return rejeitar(
      'RECEBIDA_NAO_ENCONTRADA',
      'A Peça Recebida ainda não tem o tipo escolhido.',
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

function girarRecebida(
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

function girarDaReserva(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const pecaSelecionadaId = estado.pecaSelecionadaId;
  if (pecaSelecionadaId === null) {
    return rejeitar(
      'PECA_NAO_SELECIONADA',
      'Nenhuma Peça está selecionada.',
    );
  }
  const peca = encontrarNaReserva(estado, pecaSelecionadaId);
  if (!peca) {
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  const orientacaoNova = rotacionar(peca.orientacao, comando.sentido);
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    reserva: estado.reserva.map((item) =>
      item.pecaId === peca.pecaId ? { ...item, orientacao: orientacaoNova } : item,
    ),
  };
  return sucesso(novoEstado, [
    {
      tipo: 'peca_girada',
      pecaId: peca.pecaId,
      orientacaoAnterior: peca.orientacao,
      orientacao: orientacaoNova,
      sentido: comando.sentido,
    },
  ]);
}

function girarPosicionada(
  estado: EstadoDoTabuleiro,
  comando: GirarPecaComando,
): ResultadoDoTabuleiro {
  const peca = encontrarPosicionada(estado, comando.pecaId);
  if (!peca) {
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
  }

  const orientacaoNova = rotacionar(peca.orientacao, comando.sentido);
  const novoEstado: EstadoDoTabuleiro = {
    ...estado,
    posicionadas: estado.posicionadas.map((item) =>
      item.pecaId === peca.pecaId ? { ...item, orientacao: orientacaoNova } : item,
    ),
  };
  return sucesso(novoEstado, [
    {
      tipo: 'peca_girada',
      pecaId: peca.pecaId,
      orientacaoAnterior: peca.orientacao,
      orientacao: orientacaoNova,
      sentido: comando.sentido,
    },
  ]);
}

// Rotação em passos discretos de 90° com wrap-around (270° +90 volta a 0°).
function rotacionar(
  orientacao: Orientacao,
  sentido: SentidoDeRotacao,
): Orientacao {
  const passo = sentido === 'horario' ? 90 : 270;
  return ((orientacao + passo) % 360) as Orientacao;
}

function estaDentroDaGrade(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0 && valor < LADO_DA_GRADE;
}

function exigirCelulaNoAlcance(
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

function encontrarNaReserva(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaDaReserva | undefined {
  return estado.reserva.find((peca) => peca.pecaId === pecaId);
}

function encontrarPosicionada(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaPosicionada | undefined {
  return estado.posicionadas.find((peca) => peca.pecaId === pecaId);
}

function encontrarPosicionadaPorCelula(
  estado: EstadoDoTabuleiro,
  celula: Celula,
): PecaPosicionada | undefined {
  return estado.posicionadas.find(
    (peca) =>
      peca.celula.linha === celula.linha &&
      peca.celula.coluna === celula.coluna,
  );
}

function encontrarRecebidaPorPeca(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaRecebida | undefined {
  return estado.recebidas.find((item) => item.pecaId === pecaId);
}

function validarTexto(
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

function sucesso(
  estado: EstadoDoTabuleiro,
  eventos: readonly EventoDoTabuleiro[],
): OperacaoBemSucedidaDoTabuleiro {
  return { sucesso: true, estado, eventos };
}

function rejeitar(
  codigo: CodigoDeErroDeTabuleiro,
  mensagem: string,
): OperacaoRejeitadaDoTabuleiro {
  return {
    sucesso: false,
    erro: { tipo: 'erro_de_dominio', codigo, mensagem },
  };
}
