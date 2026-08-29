// Domínio puro do Tabuleiro (ST-09 / issue #82 e ST-10 / issue #89).
//
// Seam único das regras de tabuleiro: grade fixa 7x7 (ADR-0004), Reserva,
// Seleção única e janela de Manipulação (ST-09), e os tipos do ciclo de Peões
// com o dispatch aplicarComandoDeTabuleiro (ST-10) — que produz eventos de
// domínio e rejeições com códigos fechados, no mesmo padrão do domínio do
// lobby (lobby.ts). Os handlers de Peões, conexões, Recebimento e ciclo, e a
// camada base compartilhada (resultado, validação, grade, rotação, bordas),
// vivem em peoes.ts — a dependência em runtime é única: tabuleiro.ts →
// peoes.ts. Nenhum contrato wire, Redis ou Express vive aqui: este módulo é
// domínio puro e imutável.

import {
  exigirCelulaNoAlcance,
  escolherTipoDaPecaRecebida,
  estaDentroDaGrade,
  encontrarPosicionada,
  encontrarPosicionadaPorCelula,
  encontrarRecebidaPorPeca,
  girarRecebida,
  moverPeao,
  permanecer,
  posicionarPeao,
  posicionarRecebida,
  rejeitar,
  rotacionar,
  selecionarPeao,
  sucesso,
  validarTexto,
} from './peoes.ts';

export {
  LADO_DA_GRADE,
  bordasAbertas,
  gerarRecebidas,
  validarTexto,
  vizinhasConectadas,
} from './peoes.ts';

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

function encontrarNaReserva(
  estado: EstadoDoTabuleiro,
  pecaId: string,
): PecaDaReserva | undefined {
  return estado.reserva.find((peca) => peca.pecaId === pecaId);
}
