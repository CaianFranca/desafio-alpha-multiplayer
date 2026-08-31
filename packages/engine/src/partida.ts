// Domínio puro dos Turnos e do loop da Partida (ST-11 / issue #114).
//
// Camada que compõe o estado do Tabuleiro com os campos de turno: roster de
// jogadores, Jogador Ativo, rodada, Peça do início do turno e Confirmação de
// Posição. O dispatch aplicarComandoDePartida segue o padrão dos dispatches
// existentes (aplicarComando do lobby e aplicarComandoDeTabuleiro): valida o
// ator, roteia o comando e produz eventos de domínio ou rejeições com códigos
// fechados. A dependência em runtime é única — partida.ts → tabuleiro.ts →
// peoes.ts — e o Recebimento do Peão já posicionado (posicionar_peao do
// Primeiro Turno e confirmar_posicao_do_peao) é gerado aqui, via
// gerarRecebidas. Nenhum contrato wire, Redis ou Express vive aqui: domínio
// puro e imutável.

import {
  aplicarComandoDeTabuleiro,
  estadoInicialDoTabuleiro,
  gerarRecebidas,
  validarTexto,
  type ComandoDeTabuleiro,
  type CorDoPeao,
  type CodigoDeErroDeTabuleiro,
  type EstadoDoTabuleiro,
  type EventoDoTabuleiro,
  type MoverPeaoComando,
  type PecaRecebida,
  type PermanecerComando,
  type PosicionarPecaComando,
  type PosicionarPeaoComando,
  type SelecionarPecaComando,
} from './tabuleiro.ts';

export interface JogadorDaPartida {
  readonly jogadorId: string;
  readonly ordem: number;
  readonly cor: CorDoPeao;
  readonly peaoId: string;
  // ST-11: o Primeiro Turno posiciona a própria Peça Inicial e o próprio
  // Peão; a flag só é concluída pelo Encerramento do Turno.
  readonly primeiroTurnoPendente: boolean;
}

// Estado da Partida: o Tabuleiro (com Seleção única, Manipulação, Recebidas e
// Peões dentro do EstadoDoTabuleiro) mais os campos do loop de turnos.
export interface EstadoDaPartida {
  readonly tabuleiro: EstadoDoTabuleiro;
  // Roster em ordem de entrada; a vez avança circularmente por "ordem".
  readonly jogadores: readonly JogadorDaPartida[];
  readonly jogadorAtivoId: string;
  readonly rodada: number;
  // Peça sob o Peão do Jogador Ativo no início do turno; null quando o Peão
  // está sobre a Mesa (Primeiro Turno ainda não concluído).
  readonly pecaDoInicioDoTurnoId: string | null;
  readonly posicaoConfirmada: boolean;
}

export interface ConfirmarPosicaoDoPeaoComando {
  readonly tipo: 'confirmar_posicao_do_peao';
  readonly peaoId: string;
}

export interface EncerrarTurnoComando {
  readonly tipo: 'encerrar_turno';
}

export type ComandoDePartida =
  | ComandoDeTabuleiro
  | ConfirmarPosicaoDoPeaoComando
  | EncerrarTurnoComando;

export interface TurnoIniciadoEvento {
  readonly tipo: 'turno_iniciado';
  readonly jogadorId: string;
  readonly rodada: number;
}

export interface TurnoEncerradoEvento {
  readonly tipo: 'turno_encerrado';
  readonly jogadorId: string;
}

export interface PosicaoConfirmadaEvento {
  readonly tipo: 'posicao_confirmada';
  readonly jogadorId: string;
  readonly peaoId: string;
  readonly pecaId: string;
}

export type EventoDaPartida =
  | EventoDoTabuleiro
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento;

export type CodigoDeErroDaPartida =
  | CodigoDeErroDeTabuleiro
  | 'FORA_DA_VEZ'
  | 'PECA_INICIAL_INDISPONIVEL'
  | 'POSICAO_CONFIRMADA'
  | 'ENCERRAMENTO_INVALIDO'
  | 'MOVIMENTO_INDISPONIVEL';

export interface ErroDeDominioDaPartida {
  readonly tipo: 'erro_de_dominio';
  readonly codigo: CodigoDeErroDaPartida;
  readonly mensagem: string;
}

export interface OperacaoBemSucedidaDaPartida {
  readonly sucesso: true;
  readonly estado: EstadoDaPartida;
  readonly eventos: readonly EventoDaPartida[];
}

export interface OperacaoRejeitadaDaPartida {
  readonly sucesso: false;
  readonly erro: ErroDeDominioDaPartida;
}

export type ResultadoDaPartida =
  | OperacaoBemSucedidaDaPartida
  | OperacaoRejeitadaDaPartida;

// Cores canônicas dos 4 Peões, atribuídas pela ordem de entrada dos Jogadores
// (mesma ordem dos Peões do Tabuleiro, em estadoInicialDoTabuleiro).
const CORES_PELA_ORDEM: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
];

// Partida recém-preparada: roster na ordem recebida, vez do primeiro Jogador
// e o evento de abertura do turno dele (o game-server precisa do
// turno_iniciado inicial para abrir a Partida). A seed opcional é propagada
// ao embaralhamento único da Caixa (ST-12); sem seed, a Caixa permanece na
// ordem de composição.
export function estadoInicialDaPartida(
  jogadoresEmOrdem: readonly string[],
  entrada?: { readonly seed?: number },
): ResultadoDaPartida {
  const idsInvalidos = validarTexto(...jogadoresEmOrdem);
  if (idsInvalidos) {
    return { sucesso: false, erro: idsInvalidos.erro };
  }
  if (jogadoresEmOrdem.length !== 4) {
    return rejeitarDaPartida(
      'DADOS_INVALIDOS',
      'A Partida exige exatamente quatro jogadores.',
    );
  }
  if (new Set(jogadoresEmOrdem).size !== jogadoresEmOrdem.length) {
    return rejeitarDaPartida(
      'DADOS_INVALIDOS',
      'Os identificadores dos jogadores devem ser únicos.',
    );
  }

  const jogadores: JogadorDaPartida[] = jogadoresEmOrdem.map(
    (jogadorId, indice) => {
      const cor = CORES_PELA_ORDEM[indice];
      return {
        jogadorId,
        ordem: indice + 1,
        cor,
        peaoId: `peao-${cor}`,
        primeiroTurnoPendente: true,
      };
    },
  );

  const estado: EstadoDaPartida = {
    tabuleiro: estadoInicialDoTabuleiro(entrada),
    jogadores,
    jogadorAtivoId: jogadores[0].jogadorId,
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
  };
  return sucessoDaPartida(estado, [
    { tipo: 'turno_iniciado', jogadorId: jogadores[0].jogadorId, rodada: 1 },
  ]);
}

export function aplicarComandoDePartida(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  ator: string,
): ResultadoDaPartida {
  const dadosInvalidos = validarTexto(ator);
  if (dadosInvalidos) {
    return { sucesso: false, erro: dadosInvalidos.erro };
  }

  const jogadorAtivo = estado.jogadores.find(
    (jogador) => jogador.jogadorId === estado.jogadorAtivoId,
  );
  // Ator desconhecido ou fora da vez: apenas o Jogador Ativo comanda.
  if (!jogadorAtivo || ator !== estado.jogadorAtivoId) {
    return rejeitarDaPartida(
      'FORA_DA_VEZ',
      'Apenas o Jogador Ativo pode comandar a Partida.',
    );
  }

  switch (comando.tipo) {
    case 'selecionar_peca':
      return selecionarPecaDaPartida(estado, comando, jogadorAtivo);
    case 'girar_peca':
    case 'finalizar_manipulacao':
    case 'escolher_tipo_da_peca_recebida':
      return delegarAoTabuleiro(estado, comando);
    case 'selecionar_peao': {
      const alheio = exigirPeaoDoAtor(comando.peaoId, jogadorAtivo);
      if (alheio) {
        return alheio;
      }
      return delegarAoTabuleiro(estado, comando);
    }
    case 'posicionar_peca':
      return posicionarPecaDaPartida(estado, comando, jogadorAtivo);
    case 'posicionar_peao':
      return posicionarPeaoDaPartida(estado, comando, jogadorAtivo);
    case 'mover_peao':
      return moverPeaoDaPartida(estado, comando, jogadorAtivo);
    case 'permanecer':
      return permanecerNaPartida(estado, comando, jogadorAtivo);
    case 'confirmar_posicao_do_peao':
      return confirmarPosicaoDoPeao(estado, comando, jogadorAtivo);
    case 'encerrar_turno':
      return encerrarTurnoDaPartida(estado, jogadorAtivo);
    default: {
      // Exaustividade: um novo ComandoDePartida sem case próprio falha a
      // compilação aqui; em runtime, entrada externa pode bypassar tipos.
      const _comandoExaustivo: never = comando;
      return rejeitarDaPartida(
        'DADOS_INVALIDOS',
        'O comando de domínio é inválido.',
      );
    }
  }
}

// Guarda de elemento alheio (ST-11): o Peão indicado deve ser o do ator —
// derivado da cor, atribuída pela ordem de entrada.
function exigirPeaoDoAtor(
  comandoPeaoId: string,
  ator: JogadorDaPartida,
): OperacaoRejeitadaDaPartida | undefined {
  if (comandoPeaoId !== ator.peaoId) {
    return rejeitarDaPartida(
      'FORA_DA_VEZ',
      'O Peão indicado pertence a outro Jogador.',
    );
  }
  return undefined;
}

// Guarda da Peça Inicial (ST-11): cada Jogador posiciona exclusivamente a
// própria inicial-<ordem>, e somente no próprio Primeiro Turno. A verificação
// cobre as Peças Iniciais fora da Caixa (ST-12) e as Peças posicionadas (a
// Seleção da própria inicial posicionada encerra a Manipulação e continua
// válida no Primeiro Turno).
function exigirPecaInicialDisponivel(
  estado: EstadoDaPartida,
  pecaId: string,
  ator: JogadorDaPartida,
): OperacaoRejeitadaDaPartida | undefined {
  const ehInicial =
    estado.tabuleiro.iniciais.some(
      (peca) => peca.pecaId === pecaId && peca.tipo === 'inicial',
    ) ||
    estado.tabuleiro.posicionadas.some(
      (peca) => peca.pecaId === pecaId && peca.tipo === 'inicial',
    );
  if (!ehInicial) {
    return undefined;
  }
  if (!ator.primeiroTurnoPendente || pecaId !== `inicial-${ator.ordem}`) {
    return rejeitarDaPartida(
      'PECA_INICIAL_INDISPONIVEL',
      'Cada Jogador só posiciona a própria Peça Inicial, no próprio Primeiro Turno.',
    );
  }
  return undefined;
}

function selecionarPecaDaPartida(
  estado: EstadoDaPartida,
  comando: SelecionarPecaComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const indisponivel = exigirPecaInicialDisponivel(estado, comando.pecaId, ator);
  if (indisponivel) {
    return indisponivel;
  }
  return delegarAoTabuleiro(estado, comando);
}

function posicionarPecaDaPartida(
  estado: EstadoDaPartida,
  comando: PosicionarPecaComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const indisponivel = exigirPecaInicialDisponivel(estado, comando.pecaId, ator);
  if (indisponivel) {
    return indisponivel;
  }
  return delegarAoTabuleiro(estado, comando);
}

// ST-11: no Primeiro Turno, o encaixe do Peão gera o Recebimento
// automaticamente (via gerarRecebidas sobre a Peça recém-ocupada) e mantém o
// Peão selecionado para a sequência; em turnos normais o Peão já está
// posicionado e o próprio Tabuleiro rejeita (PEAO_JA_POSICIONADO).
function posicionarPeaoDaPartida(
  estado: EstadoDaPartida,
  comando: PosicionarPeaoComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const alheio = exigirPeaoDoAtor(comando.peaoId, ator);
  if (alheio) {
    return alheio;
  }

  if (!ator.primeiroTurnoPendente) {
    return delegarAoTabuleiro(estado, comando);
  }

  const resultado = aplicarComandoDeTabuleiro(estado.tabuleiro, comando);
  if (!resultado.sucesso) {
    return { sucesso: false, erro: resultado.erro };
  }

  const peao = resultado.estado.peoes.find(
    (item) => item.peaoId === comando.peaoId,
  );
  const peca = peao?.pecaId
    ? resultado.estado.posicionadas.find((item) => item.pecaId === peao.pecaId)
    : undefined;
  // Invariante do fluxo: no Primeiro Turno o encaixe aceito deixa o Peão sobre
  // uma Peça; sem Peça, o Recebimento simplesmente não é gerado.
  const recebidas = peca ? gerarRecebidas(resultado.estado, peca) : [];

  // O Peão segue selecionado: a sequência (escolher tipos e encaixar as
  // Recebidas) começa imediatamente.
  const tabuleiro = {
    ...resultado.estado,
    peaoSelecionadoId: comando.peaoId,
    recebidas,
  };
  const eventos: EventoDaPartida[] = [...resultado.eventos];
  if (recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: projetarRecebidas(recebidas),
    });
  }
  return sucessoDaPartida({ ...estado, tabuleiro }, eventos);
}

function moverPeaoDaPartida(
  estado: EstadoDaPartida,
  comando: MoverPeaoComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const alheio = exigirPeaoDoAtor(comando.peaoId, ator);
  if (alheio) {
    return alheio;
  }
  if (ator.primeiroTurnoPendente) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'O Peão só se move a partir do turno seguinte ao Primeiro Turno.',
    );
  }
  if (estado.posicaoConfirmada) {
    return rejeitarDaPartida(
      'POSICAO_CONFIRMADA',
      'A posição do Peão já foi confirmada; encerre o turno.',
    );
  }
  return delegarAoTabuleiro(estado, comando);
}

// ST-11: a Permanência vale apenas com o Peão na Peça do início do turno —
// caso válido, trava a posição e encerra o turno direto, sem Recebimento;
// após mudar de Peça, é Encerramento inválido.
function permanecerNaPartida(
  estado: EstadoDaPartida,
  comando: PermanecerComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const alheio = exigirPeaoDoAtor(comando.peaoId, ator);
  if (alheio) {
    return alheio;
  }
  if (ator.primeiroTurnoPendente) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'A Permanência só existe a partir do turno seguinte ao Primeiro Turno.',
    );
  }
  if (estado.posicaoConfirmada) {
    return rejeitarDaPartida(
      'POSICAO_CONFIRMADA',
      'A posição do Peão já foi confirmada; encerre o turno.',
    );
  }

  const resultado = aplicarComandoDeTabuleiro(estado.tabuleiro, comando);
  if (!resultado.sucesso) {
    return { sucesso: false, erro: resultado.erro };
  }

  const peao = resultado.estado.peoes.find(
    (item) => item.peaoId === comando.peaoId,
  );
  if (peao?.pecaId !== estado.pecaDoInicioDoTurnoId) {
    // Encerramento inválido: o resultado do Tabuleiro é descartado e o estado
    // da Partida permanece inalterado.
    return rejeitarDaPartida(
      'ENCERRAMENTO_INVALIDO',
      'A Permanência exige que o Peão esteja na Peça do início do turno.',
    );
  }

  return avancarVez(
    { ...estado, tabuleiro: resultado.estado },
    [...resultado.eventos, { tipo: 'turno_encerrado', jogadorId: ator.jogadorId }],
  );
}

// ST-11: a Confirmação de Posição trava o Peão na Peça em que terminou e gera
// o Recebimento somente quando houve mudança de Peça; confirmar sem movimento
// é Encerramento inválido (terminar na Peça de início é via Permanência).
function confirmarPosicaoDoPeao(
  estado: EstadoDaPartida,
  comando: ConfirmarPosicaoDoPeaoComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const alheio = exigirPeaoDoAtor(comando.peaoId, ator);
  if (alheio) {
    return alheio;
  }
  if (ator.primeiroTurnoPendente) {
    return rejeitarDaPartida(
      'ENCERRAMENTO_INVALIDO',
      'A Confirmação de Posição não existe no Primeiro Turno.',
    );
  }
  if (estado.posicaoConfirmada) {
    return rejeitarDaPartida(
      'POSICAO_CONFIRMADA',
      'A posição do Peão já foi confirmada neste turno.',
    );
  }

  const peao = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === comando.peaoId,
  );
  if (!peao) {
    return rejeitarDaPartida('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }
  if (estado.tabuleiro.peaoSelecionadoId !== peao.peaoId) {
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'O Peão indicado não é o selecionado.',
    );
  }
  if (peao.pecaId === null) {
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'O Peão está sobre a Mesa; não há posição a confirmar.',
    );
  }
  const peca = estado.tabuleiro.posicionadas.find(
    (item) => item.pecaId === peao.pecaId,
  );
  if (!peca) {
    // Estado inconsistente: o Peão aponta para uma Peça fora do Tabuleiro.
    return rejeitarDaPartida(
      'PEAO_NAO_ENCONTRADO',
      'A Peça do Peão não foi encontrada.',
    );
  }
  if (peca.pecaId === estado.pecaDoInicioDoTurnoId) {
    return rejeitarDaPartida(
      'ENCERRAMENTO_INVALIDO',
      'Confirmação sem mudança de Peça é inválida; termine na Peça de início via Permanência.',
    );
  }

  const recebidas = gerarRecebidas(estado.tabuleiro, peca);
  const eventos: EventoDaPartida[] = [
    {
      tipo: 'posicao_confirmada',
      jogadorId: ator.jogadorId,
      peaoId: peao.peaoId,
      pecaId: peca.pecaId,
    },
  ];
  if (recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: projetarRecebidas(recebidas),
    });
  }
  return sucessoDaPartida(
    {
      ...estado,
      tabuleiro: { ...estado.tabuleiro, recebidas },
      posicaoConfirmada: true,
    },
    eventos,
  );
}

// ST-11: o Encerramento do Turno é explícito. Primeiro Turno exige o Peão
// posicionado; turno normal exige a Confirmação de Posição; ambos exigem zero
// pendências do Recebimento. Válido, conclui o Primeiro Turno do Jogador
// Ativo e avança a vez.
function encerrarTurnoDaPartida(
  estado: EstadoDaPartida,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  if (ator.primeiroTurnoPendente) {
    const peao = estado.tabuleiro.peoes.find(
      (item) => item.peaoId === ator.peaoId,
    );
    if (!peao || peao.pecaId === null) {
      return rejeitarDaPartida(
        'ENCERRAMENTO_INVALIDO',
        'O Primeiro Turno exige o Peão posicionado antes do Encerramento do Turno.',
      );
    }
  } else if (!estado.posicaoConfirmada) {
    return rejeitarDaPartida(
      'ENCERRAMENTO_INVALIDO',
      'O Encerramento do Turno exige a Confirmação de Posição antes de encerrar.',
    );
  }
  if (estado.tabuleiro.recebidas.length > 0) {
    return rejeitarDaPartida(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; posicione-as antes de encerrar o turno.',
    );
  }

  const jogadores = estado.jogadores.map((jogador) =>
    jogador.jogadorId === ator.jogadorId
      ? { ...jogador, primeiroTurnoPendente: false }
      : jogador,
  );
  return avancarVez(
    { ...estado, jogadores },
    [{ tipo: 'turno_encerrado', jogadorId: ator.jogadorId }],
  );
}

// Avanço circular pela ordem de entrada: o próximo Jogador assume a vez e, ao
// voltar ao primeiro, a rodada incrementa. A Peça do início do novo turno é a
// Peça atual do Peão do próximo Jogador; a Confirmação é zerada e o Tabuleiro
// é deixado sem Seleção, sem janela de Manipulação, sem Peão selecionado nem
// pendências (defensivo — os encerramentos válidos já exigem zero pendências).
// A Passagem de Vez encerra a janela de Manipulação em aberto: o fechamento é
// efeito do avanço, então o manipulacao_finalizada precede o turno_iniciado
// (sem duplicar quando o fechamento já veio nos eventos do Tabuleiro).
function avancarVez(
  estado: EstadoDaPartida,
  eventos: readonly EventoDaPartida[],
): ResultadoDaPartida {
  const ordenados = [...estado.jogadores].sort(
    (primeiro, segundo) => primeiro.ordem - segundo.ordem,
  );
  const indiceAtivo = ordenados.findIndex(
    (jogador) => jogador.jogadorId === estado.jogadorAtivoId,
  );
  const indiceProximo = (indiceAtivo + 1) % ordenados.length;
  const proximo = ordenados[indiceProximo];
  const rodada =
    indiceProximo === 0 ? estado.rodada + 1 : estado.rodada;

  const peaoDoProximo = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === proximo.peaoId,
  );
  const pecaEmManipulacaoId = estado.tabuleiro.pecaEmManipulacaoId;
  const jaFinalizada =
    pecaEmManipulacaoId !== null &&
    eventos.some(
      (evento) =>
        evento.tipo === 'manipulacao_finalizada' &&
        evento.pecaId === pecaEmManipulacaoId,
    );
  const fechamentoDaManipulacao: readonly EventoDaPartida[] =
    pecaEmManipulacaoId !== null && !jaFinalizada
      ? [{ tipo: 'manipulacao_finalizada', pecaId: pecaEmManipulacaoId }]
      : [];

  const novoEstado: EstadoDaPartida = {
    tabuleiro: {
      ...estado.tabuleiro,
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      recebidas: [],
    },
    jogadores: estado.jogadores,
    jogadorAtivoId: proximo.jogadorId,
    rodada,
    pecaDoInicioDoTurnoId: peaoDoProximo?.pecaId ?? null,
    posicaoConfirmada: false,
  };
  return sucessoDaPartida(novoEstado, [
    ...eventos,
    ...fechamentoDaManipulacao,
    { tipo: 'turno_iniciado', jogadorId: proximo.jogadorId, rodada },
  ]);
}

function delegarAoTabuleiro(
  estado: EstadoDaPartida,
  comando: ComandoDeTabuleiro,
): ResultadoDaPartida {
  const resultado = aplicarComandoDeTabuleiro(estado.tabuleiro, comando);
  if (!resultado.sucesso) {
    return { sucesso: false, erro: resultado.erro };
  }
  return sucessoDaPartida(
    { ...estado, tabuleiro: resultado.estado },
    resultado.eventos,
  );
}

// O evento de Recebimento carrega apenas a projeção da pendência
// (recebidaId, bordaGeradora e celulaAlvo), sem os campos internos do slot.
function projetarRecebidas(recebidas: readonly PecaRecebida[]) {
  return recebidas.map(({ recebidaId, bordaGeradora, celulaAlvo }) => ({
    recebidaId,
    bordaGeradora,
    celulaAlvo,
  }));
}

function sucessoDaPartida(
  estado: EstadoDaPartida,
  eventos: readonly EventoDaPartida[],
): OperacaoBemSucedidaDaPartida {
  return { sucesso: true, estado, eventos };
}

function rejeitarDaPartida(
  codigo: CodigoDeErroDaPartida,
  mensagem: string,
): OperacaoRejeitadaDaPartida {
  return {
    sucesso: false,
    erro: { tipo: 'erro_de_dominio', codigo, mensagem },
  };
}
