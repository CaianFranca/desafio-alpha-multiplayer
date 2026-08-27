// Domínio puro do Tabuleiro (ST-09 / issue #82).
//
// Seam único das regras de tabuleiro: grade fixa 7x7 (ADR-0004), Reserva,
// Seleção única e janela de Manipulação, expostos por um aplicarComando que
// produz eventos de domínio e rejeições com códigos fechados — no mesmo padrão
// do domínio do lobby (lobby.ts). Nenhum contrato wire, Redis ou Express vive
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

// `pecaSelecionadaId` aponta para uma peça da Reserva (Seleção única).
// `pecaEmManipulacaoId` aponta para a última peça posicionada enquanto sua
// janela de Manipulação está aberta; Finalização (nova seleção, novo
// posicionamento ou clique na própria peça posicionada) fecha a janela.
export interface EstadoDoTabuleiro {
  readonly reserva: readonly PecaDaReserva[];
  readonly posicionadas: readonly PecaPosicionada[];
  readonly pecaSelecionadaId: string | null;
  readonly pecaEmManipulacaoId: string | null;
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

export type ComandoDeTabuleiro =
  | SelecionarPecaComando
  | GirarPecaComando
  | PosicionarPecaComando
  | FinalizarManipulacaoComando;

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

export type EventoDoTabuleiro =
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | ManipulacaoFinalizadaEvento;

export type CodigoDeErroDeTabuleiro =
  | 'DADOS_INVALIDOS'
  | 'PECA_NAO_ENCONTRADA'
  | 'PECA_NAO_SELECIONADA'
  | 'RESERVA_ESGOTADA'
  | 'CELULA_NAO_ENCONTRADA'
  | 'CELULA_JA_OCUPADA'
  | 'PECA_JA_POSICIONADA'
  | 'MANIPULACAO_ENCERRADA';

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
    default:
      return rejeitar('DADOS_INVALIDOS', 'O comando de domínio é inválido.');
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
  } else if (estado.pecaSelecionadaId === comando.pecaId) {
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

  if (estado.reserva.length === 0) {
    return rejeitar('RESERVA_ESGOTADA', 'A Reserva não possui mais Peças.');
  }

  if (!encontrarNaReserva(estado, comando.pecaId)) {
    if (encontrarPosicionada(estado, comando.pecaId)) {
      return rejeitar(
        'PECA_JA_POSICIONADA',
        'A Peça já foi posicionada no Tabuleiro.',
      );
    }
    return rejeitar('PECA_NAO_ENCONTRADA', 'A Peça não foi encontrada.');
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

  const peca = encontrarNaReserva(estado, comando.pecaId)!;
  const posicionada: PecaPosicionada = {
    pecaId: peca.pecaId,
    tipo: peca.tipo,
    orientacao: peca.orientacao,
    celula: comando.celula,
  };
  const novoEstado: EstadoDoTabuleiro = {
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
