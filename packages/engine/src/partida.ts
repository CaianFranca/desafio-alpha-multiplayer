// Domínio puro dos Turnos e do loop da Partida (ST-11 / issue #114).
//
// Camada que compõe o estado do Tabuleiro com os campos de turno: roster de
// jogadores, Jogador Ativo, rodada, Peça do início do turno e Confirmação de
// Posição. O dispatch aplicarComandoDePartida segue o padrão dos dispatches
// existentes (aplicarComando do lobby e aplicarComandoDeTabuleiro): valida o
// ator, roteia o comando e produz eventos de domínio ou rejeições com códigos
// fechados. A dependência em runtime é única — partida.ts → monstros.ts →
// tabuleiro.ts → peoes.ts — e o Recebimento do Peão já posicionado
// (posicionar_peao do Primeiro Turno e confirmar_posicao_do_peao) é gerado
// aqui, via gerarRecebidas. Nenhum contrato wire, Redis ou Express vive aqui:
// domínio puro e imutável.
//
// Término da Partida (issue #176): o estado carrega o Resultado
// (DesfechoDaPartida | null — resultado !== null ≡ terminada), os contadores
// globais de objetivos (geradoresLigados, cartaoDeAcessoObtido) e a sanidade
// dos Jogadores. Toda Ação aprovada passa por UMA avaliação de término no
// funil do dispatch (vitória antes da derrota); pós-término, qualquer
// comando é recusado com PARTIDA_TERMINADA.
//
// Ataque dos Monstros (issue #172): nos dois gatilhos definitivos — o
// posicionamento do Peão do Primeiro Turno e a Confirmação de Posição com
// mudança de Peça — o Ataque é resolvido APÓS a Iluminação e a Limpeza
// (monstros.ts), comparando os peões no Alcance de cada Monstro com o
// snapshot anterior (peoesNoAlcance). Mover, Permanecer, Encerrar o Turno e
// o posicionamento de peças NUNCA disparam: a movimentação desfeita não
// altera o snapshot e não gera Ataque. A Proteção concedida pela Sala Médica
// na Confirmação não é consumida pelo Ataque do MESMO gatilho — permanece
// para o próximo (CONTEXT.md: "permanece até ser consumida").

import {
  aplicarComandoDeTabuleiro,
  aplicarLimpeza,
  calcularIluminacao,
  estadoInicialDoTabuleiro,
  gerarRecebidas,
  validarTexto,
  type Celula,
  type ComandoDeTabuleiro,
  type CorDoPeao,
  type CodigoDeErroDeTabuleiro,
  type EstadoDoTabuleiro,
  type EventoDoTabuleiro,
  type MoverPeaoComando,
  type PecaPosicionada,
  type PecaRecebida,
  type PermanecerComando,
  type PosicionarPecaComando,
  type PosicionarPeaoComando,
  type SelecionarPecaComando,
} from './tabuleiro.ts';
import {
  resolverAtaques,
  type AtaqueResolvidoEvento,
} from './monstros.ts';

export interface JogadorDaPartida {
  readonly jogadorId: string;
  readonly ordem: number;
  readonly cor: CorDoPeao;
  readonly peaoId: string;
  // ST-11: o Primeiro Turno posiciona a própria Peça Inicial e o próprio
  // Peão; a flag só é concluída pelo Encerramento do Turno.
  readonly primeiroTurnoPendente: boolean;
  // Término (issue #176): sanidade inicia em 3 e tem piso 0; Amedrontado ≡
  // sanidade === 0. ST-15 / issue #170 aplica as penalidades do Ataque.
  readonly sanidade: number;
  // Ataque (issue #172): Proteção concedida pela Sala Médica na Confirmação
  // de Posição. Não acumulável (no máximo um escudo) e consumida UMA única
  // vez por resolução, negando todos os ataques simultâneos contra o
  // Jogador; permanece até ser consumida.
  readonly protegido: boolean;
  // ST-15 / issue #170: estados impostos pelos Monstros. Baixa Iluminação
  // (Vulto) reduz a Iluminação do peão à própria célula e o Recebimento a
  // 1 peça; Amedrontado (Espectro ao zerar sanidade) faz o turno ser
  // auto-pulado. Encerram apenas pelo Resgate (fora do escopo da #170).
  readonly emBaixaIluminacao: boolean;
  readonly amedrontado: boolean;
}

// Estado da Partida: o Tabuleiro (com Seleção única, Manipulação, Recebidas e
// Peões dentro do EstadoDoTabuleiro) mais os campos do loop de turnos.
// Iluminação é campo materializado — união ortogonal (célula do peão + 4
// vizinhas) compartilhada, recalculada só nos pontos definitivos.
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
  readonly celulasIluminadas: readonly Celula[];
  // Término da Partida (issue #176): o Desfecho !== null é a própria
  // condição "terminada" — sem flag duplicada. Os contadores globais de
  // objetivos são atualizados APENAS na Confirmação de Posição (idempotente)
  // e sobrevivem à Limpeza, que remove peças do Tabuleiro mas não conquistas.
  readonly resultado: DesfechoDaPartida | null;
  // pecaIds de geradores ligados (o contador deriva do length).
  readonly geradoresLigados: readonly string[];
  readonly cartaoDeAcessoObtido: boolean;
  // Ataque (issue #172): snapshot dos peões dentro do Alcance de cada Monstro
  // no último gatilho (posicionamento do Peão do Primeiro Turno ou
  // Confirmação de Posição com mudança de Peça) — a base do delta que dispara
  // o Ataque. Chave = pecaId do Monstro; valor = peaoIds. Monstros removidos
  // pela Limpeza têm a entrada podada no gatilho seguinte.
  readonly peoesNoAlcance: Readonly<Record<string, readonly string[]>>;
}

export interface ConfirmarPosicaoDoPeaoComando {
  readonly tipo: 'confirmar_posicao_do_peao';
  readonly peaoId: string;
}

// Desfecho da Partida (issue #176): vitória, ou derrota com motivo. A
// vitória exige as TRÊS condições simultâneas — 3 geradores ligados, cartão
// de acesso obtido e os 4 peões no mesmo Portão de Saída; a definição da
// posição dos peões cobre apenas essa terceira condição.
export type DesfechoDaPartida =
  | { readonly tipo: 'vitoria' }
  | {
      readonly tipo: 'derrota';
      readonly motivo: 'caixa_esgotada' | 'equipe_amedrontada';
    };

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

export interface CelulasIluminadasEvento {
  readonly tipo: 'celulas_iluminadas';
  readonly celulas: readonly Celula[];
}

// Término (issue #176): emitido no máximo uma vez, sempre como ÚLTIMO evento
// do lote da Ação que consumou o desfecho.
export interface PartidaTerminadaEvento {
  readonly tipo: 'partida_terminada';
  readonly desfecho: DesfechoDaPartida;
}

export type EventoDaPartida =
  | EventoDoTabuleiro
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasEvento
  | AtaqueResolvidoEvento
  | PartidaTerminadaEvento;

export type CodigoDeErroDaPartida =
  | CodigoDeErroDeTabuleiro
  | 'FORA_DA_VEZ'
  | 'PECA_INICIAL_INDISPONIVEL'
  | 'POSICAO_CONFIRMADA'
  | 'ENCERRAMENTO_INVALIDO'
  | 'MOVIMENTO_INDISPONIVEL'
  | 'PARTIDA_TERMINADA';

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
        sanidade: 3,
        protegido: false,
        emBaixaIluminacao: false,
        amedrontado: false,
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
    celulasIluminadas: [],
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    // Nenhum Monstro posicionado na abertura: o snapshot do Alcance começa
    // vazio (issue #172).
    peoesNoAlcance: {},
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

  // Término (issue #176): Partida terminada recusa qualquer comando com
  // código próprio — inclusive do Jogador Ativo — antes de qualquer
  // roteamento.
  if (estado.resultado !== null) {
    return rejeitarDaPartida(
      'PARTIDA_TERMINADA',
      'A Partida já terminou; nenhum comando é aceito.',
    );
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

  return funilarAvaliacaoDoTermino(
    rotearComandoDaPartida(estado, comando, jogadorAtivo),
  );
}

// Funil único de avaliação do término (issue #176): toda Ação bem-sucedida —
// com todos os efeitos encadeados já aplicados (sorteio, Recebimento,
// Limpeza) — passa por UMA avaliação antes de retornar. Havendo desfecho, o
// estado novo carrega o resultado e o evento partida_terminada é anexado ao
// FINAL do lote de eventos. Rejeições retornam intocadas.
function funilarAvaliacaoDoTermino(
  resultado: ResultadoDaPartida,
): ResultadoDaPartida {
  if (!resultado.sucesso) {
    return resultado;
  }
  const avaliacao = avaliarTerminoDaPartida(resultado.estado);
  if (avaliacao.evento === null) {
    return resultado;
  }
  return sucessoDaPartida(avaliacao.estado, [
    ...resultado.eventos,
    avaliacao.evento,
  ]);
}

function rotearComandoDaPartida(
  estado: EstadoDaPartida,
  comando: ComandoDePartida,
  jogadorAtivo: JogadorDaPartida,
): ResultadoDaPartida {
  switch (comando.tipo) {
    case 'selecionar_peca':
      return selecionarPecaDaPartida(estado, comando, jogadorAtivo);
    case 'girar_peca':
    case 'finalizar_manipulacao':
    case 'escolher_vaga_da_peca_recebida':
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
  // uma Peça; sem Peça, o Recebimento simplesmente não é gerado. O Recebimento
  // sorteia as peças da Caixa (#138) — peca_sorteada por peça — e cria as
  // pendências sem vaga. ST-15 / issue #170: Baixa Iluminação limita a 1 peça.
  const emBaixa = ator.emBaixaIluminacao ?? false;
  const sorteio = peca
    ? gerarRecebidas(resultado.estado, peca, emBaixa)
    : { estado: resultado.estado, recebidas: [], eventos: [] as EventoDoTabuleiro[] };

  // O Peão segue selecionado: a sequência (escolher a vaga de cada peça e
  // encaixar as Recebidas) começa imediatamente.
  const tabuleiro = {
    ...sorteio.estado,
    peaoSelecionadoId: comando.peaoId,
    recebidas: sorteio.recebidas,
  };
  const eventos: EventoDaPartida[] = [...resultado.eventos, ...sorteio.eventos];
  if (sorteio.recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: projetarRecebidas(sorteio.recebidas),
    });
  }
  // Limpeza (ST-13 / issue #147): ponto definitivo da Iluminação — aplicada
  // depois de travar o Peão e recalcular a Iluminação, antes de retornar. As
  // Recebidas caem na Vizinhança do Peão (sempre iluminadas) e não são
  // removidas. O estado é filtrado e o evento só sai quando há remoção.
  // Ataque (issue #172): resolvido logo após a Limpeza — Monstro removido
  // não ataca e tem a entrada podada do snapshot.
  // ST-15 / issue #170: se o Ataque impôs Baixa Iluminação nova, a Iluminação
  // é recalculada e a Limpeza reaplicada no MESMO gatilho.
  const iluminacao = recalcularIluminacaoEAplicarLimpeza(estado, tabuleiro, eventos);
  const tabuleiroPosLimpeza = { ...tabuleiro, posicionadas: iluminacao.posicionadas };
  const ataque = resolverAtaqueNoGatilho(estado, tabuleiroPosLimpeza, eventos);
  const { celulasIluminadas, posicionadas: posicionadasFinais } =
    reaplicarIluminacaoSeBaixaNova(
      estado,
      ataque.jogadores,
      tabuleiroPosLimpeza,
      iluminacao,
      eventos,
    );
  const tabuleiroFinal: EstadoDoTabuleiro = {
    ...tabuleiroPosLimpeza,
    posicionadas: posicionadasFinais,
  };
  return sucessoDaPartida(
    {
      ...estado,
      tabuleiro: tabuleiroFinal,
      celulasIluminadas,
      peoesNoAlcance: ataque.peoesNoAlcance,
      jogadores: ataque.jogadores,
    },
    eventos,
  );
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

  // O Recebimento sorteia as peças da Caixa (#138): peca_sorteada por peça e
  // pendências sem vaga. ST-15 / issue #170: Baixa Iluminação limita a 1 peça.
  const emBaixa = ator.emBaixaIluminacao ?? false;
  const sorteio = gerarRecebidas(estado.tabuleiro, peca, emBaixa);
  const eventos: EventoDaPartida[] = [
    {
      tipo: 'posicao_confirmada',
      jogadorId: ator.jogadorId,
      peaoId: peao.peaoId,
      pecaId: peca.pecaId,
    },
    ...sorteio.eventos,
  ];
  if (sorteio.recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: projetarRecebidas(sorteio.recebidas),
    });
  }
  const tabuleiro = { ...sorteio.estado, recebidas: sorteio.recebidas };
  // Limpeza e Ataque (issue #172) na mesma ordem do Primeiro Turno:
  // Iluminação → Limpeza → Ataque → atualização do snapshot do Alcance.
  const iluminacao = recalcularIluminacaoEAplicarLimpeza(estado, tabuleiro, eventos);
  const tabuleiroPosLimpeza = { ...tabuleiro, posicionadas: iluminacao.posicionadas };
  const ataque = resolverAtaqueNoGatilho(estado, tabuleiroPosLimpeza, eventos);
  const { celulasIluminadas, posicionadas: posicionadasPosAtaque } =
    reaplicarIluminacaoSeBaixaNova(
      estado,
      ataque.jogadores,
      tabuleiroPosLimpeza,
      iluminacao,
      eventos,
    );
  const tabuleiroFinal: EstadoDoTabuleiro = {
    ...tabuleiroPosLimpeza,
    posicionadas: posicionadasPosAtaque,
  };
  // Conquistas (issue #176): contadores globais atualizados APENAS aqui, de
  // forma idempotente — gerador ainda não ligado acrescenta o pecaId a
  // geradoresLigados; sala_do_diretor obtém o cartão. A Permanência não
  // confere, e a Limpeza (já aplicada acima, incluindo a segunda se houve
  // Baixa nova) não revoga conquistas.
  const geradoresLigados =
    peca.tipo === 'gerador' && !estado.geradoresLigados.includes(peca.pecaId)
      ? [...estado.geradoresLigados, peca.pecaId]
      : estado.geradoresLigados;
  const cartaoDeAcessoObtido =
    estado.cartaoDeAcessoObtido || peca.tipo === 'sala_do_diretor';
  // Proteção (issue #172): a Sala Médica sob o Peão na Confirmação concede a
  // Proteção ao ator, APÓS a resolução do Ataque — a proteção recém-concedida
  // não é consumida pelo ataque do MESMO gatilho (permanece para o próximo,
  // CONTEXT.md) e quem já a tinha e a consumiu no ataque do gatilho volta a
  // protegido: true (não acumulável — no máximo um escudo). Idempotente.
  // A Proteção restaurada não interfere nas penalidades já aplicadas do
  // gatilho (Baixa/sanidade), que respeitaram o consumo anterior.
  const jogadores = peca.tipo === 'sala_medica'
    ? ataque.jogadores.map((jogador) =>
        jogador.jogadorId === ator.jogadorId
          ? { ...jogador, protegido: true }
          : jogador,
      )
    : ataque.jogadores;
  return sucessoDaPartida(
    {
      ...estado,
      tabuleiro: tabuleiroFinal,
      posicaoConfirmada: true,
      celulasIluminadas,
      peoesNoAlcance: ataque.peoesNoAlcance,
      geradoresLigados,
      cartaoDeAcessoObtido,
      jogadores,
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
// ST-15 / issue #170: jogador Amedrontado (sanidade 0 / amedrontado true) tem
// o turno auto-pulado — o avanço pula silenciosamente amedrontados e emite
// apenas turno_iniciado do próximo não-amedrontado. Se todos estiverem
// amedrontados, mantém o turno no primeiro da ordem e deixa
// avaliarTerminoDaPartida decidir a derrota.
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

  const tabuleiroLimpo: EstadoDoTabuleiro = {
    ...estado.tabuleiro,
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    peaoSelecionadoId: null,
    recebidas: [],
  };

  // Busca circular do próximo não-amedrontado, reutilizando ordenados.
  let indiceProximo = (indiceAtivo + 1) % ordenados.length;
  let rodadaCandidata =
    indiceProximo === 0 ? estado.rodada + 1 : estado.rodada;
  let tentativas = 0;
  let alvo: (typeof ordenados)[number] | null = null;
  let rodadaAlvo = rodadaCandidata;
  while (tentativas < ordenados.length) {
    const candidato = ordenados[indiceProximo];
    const jogadorObj = estado.jogadores.find(
      (j) => j.jogadorId === candidato.jogadorId,
    );
    const ehAmedrontado =
      jogadorObj !== undefined &&
      (jogadorObj.amedrontado ?? jogadorObj.sanidade === 0) === true;
    if (!ehAmedrontado) {
      alvo = candidato;
      rodadaAlvo = rodadaCandidata;
      break;
    }
    // Pula amedrontado silenciosamente (sem emitir turno_iniciado/encerrado).
    indiceProximo = (indiceProximo + 1) % ordenados.length;
    rodadaCandidata =
      indiceProximo === 0 ? rodadaCandidata + 1 : rodadaCandidata;
    tentativas++;
  }

  // Se todos amedrontados, alvo permanece null — mantém estado sem novo turno
  // e deixa o funil de término decidir (equipe_amedrontada).
  if (alvo === null) {
    const novoEstado: EstadoDaPartida = {
      tabuleiro: tabuleiroLimpo,
      jogadores: estado.jogadores,
      jogadorAtivoId: ordenados[0].jogadorId,
      rodada: estado.rodada,
      pecaDoInicioDoTurnoId:
        estado.tabuleiro.peoes.find(
          (item) => item.peaoId === ordenados[0].peaoId,
        )?.pecaId ?? null,
      posicaoConfirmada: false,
      celulasIluminadas: estado.celulasIluminadas,
      resultado: estado.resultado,
      geradoresLigados: estado.geradoresLigados,
      cartaoDeAcessoObtido: estado.cartaoDeAcessoObtido,
      peoesNoAlcance: estado.peoesNoAlcance,
    };
    const eventosFinais: readonly EventoDaPartida[] = [
      ...eventos,
      ...fechamentoDaManipulacao,
    ];
    return sucessoDaPartida(novoEstado, eventosFinais);
  }

  const peaoDoAlvo = tabuleiroLimpo.peoes.find(
    (item) => item.peaoId === alvo.peaoId,
  );
  const novoEstado: EstadoDaPartida = {
    tabuleiro: tabuleiroLimpo,
    jogadores: estado.jogadores,
    jogadorAtivoId: alvo.jogadorId,
    rodada: rodadaAlvo,
    pecaDoInicioDoTurnoId: peaoDoAlvo?.pecaId ?? null,
    posicaoConfirmada: false,
    celulasIluminadas: estado.celulasIluminadas,
    resultado: estado.resultado,
    geradoresLigados: estado.geradoresLigados,
    cartaoDeAcessoObtido: estado.cartaoDeAcessoObtido,
    peoesNoAlcance: estado.peoesNoAlcance,
  };
  const eventosFinais: readonly EventoDaPartida[] = [
    ...eventos,
    ...fechamentoDaManipulacao,
    { tipo: 'turno_iniciado', jogadorId: alvo.jogadorId, rodada: rodadaAlvo },
  ];
  return sucessoDaPartida(novoEstado, eventosFinais);
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

// O evento de Recebimento carrega a projeção da pendência (issue #138):
// recebidaId, a peça sorteada (pecaId + tipoDaPeca) e a vaga (com a
// célula-alvo derivada dela), nulas até a escolha.
function projetarRecebidas(recebidas: readonly PecaRecebida[]) {
  return recebidas.map(
    ({ recebidaId, pecaId, tipo, vaga, celulaAlvo }) => ({
      recebidaId,
      pecaId,
      tipoDaPeca: tipo,
      vaga,
      celulaAlvo,
    }),
  );
}

function sucessoDaPartida(
  estado: EstadoDaPartida,
  eventos: readonly EventoDaPartida[],
): OperacaoBemSucedidaDaPartida {
  return { sucesso: true, estado, eventos };
}

// Avaliação do término (issue #176): função pura, exportada como seam de
// teste para cenários (amedrontado, caixa vazia) que nenhum comando produz
// ainda. Um estado já terminado nunca reavalia — partida_terminada sai no
// máximo uma vez (a guarda do dispatch impede comandos sobre estado
// terminado, então o funil sempre avalia um estado vivo).
export function avaliarTerminoDaPartida(
  estado: EstadoDaPartida,
): { estado: EstadoDaPartida; evento: PartidaTerminadaEvento | null } {
  if (estado.resultado !== null) {
    return { estado, evento: null };
  }
  const desfecho = desfechoDaPartida(estado);
  if (desfecho === null) {
    return { estado, evento: null };
  }
  return {
    estado: { ...estado, resultado: desfecho },
    evento: { tipo: 'partida_terminada', desfecho },
  };
}

// Ordem de avaliação (issue #176): a vitória é avaliada ANTES da derrota —
// quando vitória e derrota são verdadeiras no mesmo evento, prevalece a
// vitória. Entre os motivos de derrota simultâneos, equipe_amedrontada
// precede caixa_esgotada (desempate do mesmo evento).
function desfechoDaPartida(estado: EstadoDaPartida): DesfechoDaPartida | null {
  if (equipeVenceu(estado)) {
    return { tipo: 'vitoria' };
  }
  if (estado.jogadores.every((jogador) => jogador.sanidade === 0)) {
    return { tipo: 'derrota', motivo: 'equipe_amedrontada' };
  }
  if (caixaEsgotadaSemObjetivos(estado)) {
    return { tipo: 'derrota', motivo: 'caixa_esgotada' };
  }
  return null;
}

// Vitória (issue #176): 3 geradores ligados, cartão obtido e TODOS os peões
// sobre a MESMA peça posicionada do tipo portao_de_saida (mesmo pecaId não
// nulo). Sobre os peões vale apenas a posição — estados dos jogadores (ex.:
// sanidade 0) não os impedem de vencer.
function equipeVenceu(estado: EstadoDaPartida): boolean {
  if (estado.geradoresLigados.length < 3 || !estado.cartaoDeAcessoObtido) {
    return false;
  }
  const peoes = estado.tabuleiro.peoes;
  const referencia = peoes[0];
  if (peoes.length !== 4 || !referencia || referencia.pecaId === null) {
    return false;
  }
  return (
    peoes.every((peao) => peao.pecaId === referencia.pecaId) &&
    estado.tabuleiro.posicionadas.some(
      (peca) =>
        peca.pecaId === referencia.pecaId &&
        peca.tipo === 'portao_de_saida',
    )
  );
}

// Derrota contável (issue #176), avaliada SOMENTE com a caixa vazia e SEM
// análise de conectividade: falta peça especial para algum objetivo pendente —
// (a) geradores não ligados em quantidade menor que os necessários
//     (3 − geradoresLigados.length); geradores ligados removidos pela
//     Limpeza seguem contados via geradoresLigados;
// (b) cartão pendente e nenhuma sala_do_diretor disponível;
// (c) nenhum portao_de_saida disponível.
// "Disponível" cobre o tabuleiro (posicionadas) E as Recebidas pendentes — a
// peça sorteada na mão do Jogador não falta: pendências não sobrevivem ao
// Encerramento do Turno (PENDENCIA_NAO_RESOLVIDA), então ela sempre chega ao
// Tabuleiro dentro do turno corrente. Contar só o tabuleiro terminaria a
// partida no Recebimento da última peça especial, antes de o Jogador
// posicioná-la.
function caixaEsgotadaSemObjetivos(estado: EstadoDaPartida): boolean {
  if (estado.tabuleiro.caixa.length > 0) {
    return false;
  }
  const posicionadas = estado.tabuleiro.posicionadas;
  const recebidas = estado.tabuleiro.recebidas;
  const geradoresNaoLigados =
    posicionadas.filter(
      (peca) =>
        peca.tipo === 'gerador' && !estado.geradoresLigados.includes(peca.pecaId),
    ).length +
    recebidas.filter(
      (recebida) =>
        recebida.tipo === 'gerador' &&
        !estado.geradoresLigados.includes(recebida.pecaId),
    ).length;
  if (geradoresNaoLigados < 3 - estado.geradoresLigados.length) {
    return true;
  }
  if (
    !estado.cartaoDeAcessoObtido &&
    !posicionadas.some((peca) => peca.tipo === 'sala_do_diretor') &&
    !recebidas.some((recebida) => recebida.tipo === 'sala_do_diretor')
  ) {
    return true;
  }
  return (
    !posicionadas.some((peca) => peca.tipo === 'portao_de_saida') &&
    !recebidas.some((recebida) => recebida.tipo === 'portao_de_saida')
  );
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

/**
 * Recalcula a iluminação ortogonal e aplica a limpeza no mesmo ponto definitivo.
 * ST-15 / issue #170: peões em Baixa Iluminação iluminam apenas a própria
 * célula — a lista de peaoIds em baixa é derivada do roster quando não
 * informada, ou injetada explicitamente para o segundo cálculo do gatilho.
 * @mutates eventos — adiciona `celulas_iluminadas` (se mudou) e `limpeza_aplicada` (se houver remoção).
 */
function recalcularIluminacaoEAplicarLimpeza(
  estado: EstadoDaPartida,
  tabuleiro: EstadoDoTabuleiro,
  eventos: EventoDaPartida[],
  peaoIdsEmBaixa?: readonly string[],
): { celulasIluminadas: readonly Celula[]; posicionadas: readonly PecaPosicionada[] } {
  const baixa =
    peaoIdsEmBaixa ??
    estado.jogadores
      .filter((jogador) => (jogador.emBaixaIluminacao ?? false))
      .map((jogador) => jogador.peaoId);
  const celulasIluminadas = calcularIluminacao(tabuleiro, baixa);
  if (!iluminacoesIguais(estado.celulasIluminadas, celulasIluminadas)) {
    eventos.push({ tipo: 'celulas_iluminadas', celulas: celulasIluminadas });
  }
  const { posicionadas, removidas } = aplicarLimpeza(tabuleiro, celulasIluminadas);
  if (removidas.length > 0) {
    eventos.push({ tipo: 'limpeza_aplicada', pecasRemovidas: removidas });
  }
  return { celulasIluminadas, posicionadas };
}

function peoesEmBaixa(jogadores: readonly JogadorDaPartida[]): readonly string[] {
  return jogadores
    .filter((jogador) => (jogador.emBaixaIluminacao ?? false))
    .map((jogador) => jogador.peaoId);
}

function houveBaixaNova(
  antes: readonly string[],
  depois: readonly string[],
): boolean {
  const antesSet = new Set(antes);
  return depois.some((peaoId) => !antesSet.has(peaoId));
}

function reaplicarIluminacaoSeBaixaNova(
  estadoAntes: EstadoDaPartida,
  jogadoresAposAtaque: readonly JogadorDaPartida[],
  tabuleiroPosLimpeza: EstadoDoTabuleiro,
  iluminacaoAntes: { celulasIluminadas: readonly Celula[]; posicionadas: readonly PecaPosicionada[] },
  eventos: EventoDaPartida[],
): { celulasIluminadas: readonly Celula[]; posicionadas: readonly PecaPosicionada[] } {
  const baixaAntes = peoesEmBaixa(estadoAntes.jogadores);
  const baixaDepois = peoesEmBaixa(jogadoresAposAtaque);
  if (!houveBaixaNova(baixaAntes, baixaDepois)) {
    return iluminacaoAntes;
  }
  // Remove a celulas_iluminadas intermediária já emitida no mesmo lote para
  // evitar iluminação transitória incorreta ao cliente (o lote deve refletir
  // apenas a iluminação final com Baixa).
  for (let i = eventos.length - 1; i >= 0; i--) {
    if (eventos[i].tipo === 'celulas_iluminadas') {
      eventos.splice(i, 1);
      break;
    }
  }
  const estadoParaSegunda: EstadoDaPartida = {
    ...estadoAntes,
    celulasIluminadas: estadoAntes.celulasIluminadas,
    jogadores: jogadoresAposAtaque,
  };
  return recalcularIluminacaoEAplicarLimpeza(
    estadoParaSegunda,
    { ...tabuleiroPosLimpeza, posicionadas: iluminacaoAntes.posicionadas } as EstadoDoTabuleiro,
    eventos,
    baixaDepois,
  );
}

/**
 * Resolução do Ataque (issue #172, estados issue #170) no gatilho — sempre
 * sobre o tabuleiro PÓS-Limpeza: Monstro removido não ataca e tem a entrada
 * podada do snapshot. ST-15 / issue #170 aplica as penalidades APÓS o consumo
 * da Proteção: Vulto → emBaixaIluminacao (idempotente), Espectro →
 * sanidade-1 com piso 0 → amedrontado; jogador já amedrontado é imune a novo
 * Espectro; protegido nega a penalidade do MESMO gatilho.
 * @mutates eventos — adiciona `ataque_resolvido` quando ao menos um Monstro
 * dispara (mesmo que ninguém seja atingido).
 */
function resolverAtaqueNoGatilho(
  estado: EstadoDaPartida,
  tabuleiro: EstadoDoTabuleiro,
  eventos: EventoDaPartida[],
): {
  peoesNoAlcance: Readonly<Record<string, readonly string[]>>;
  jogadores: readonly JogadorDaPartida[];
} {
  const resolucao = resolverAtaques(
    tabuleiro,
    // Acesso defensivo: estados de binários anteriores persistidos em Redis
    // sem os campos novos (mesmo padrão de resultado ?? null).
    estado.peoesNoAlcance ?? {},
    estado.jogadores.map((jogador) => ({
      jogadorId: jogador.jogadorId,
      peaoId: jogador.peaoId,
      protegido: jogador.protegido ?? false,
    })),
  );
  if (resolucao.evento !== null) {
    eventos.push(resolucao.evento);
  }
  // Consumo da Proteção (issue #172): apenas os Jogadores que negaram algum
  // ataque nesta resolução; sem consumo, o roster segue intocado.
  const consumidos = new Set(resolucao.protegidosConsumidos);
  let jogadores: readonly JogadorDaPartida[] =
    consumidos.size === 0
      ? estado.jogadores
      : estado.jogadores.map((jogador) =>
          consumidos.has(jogador.jogadorId)
            ? { ...jogador, protegido: false }
            : jogador,
        );

  // Penalidades ST-15 / issue #170: respeitam a Proteção já consumida e a
  // imunidade do Amedrontado. Mesmo jogador atingido por ambos os tipos recebe
  // ambas as penalidades no mesmo gatilho.
  if (resolucao.evento !== null) {
    const alvos = new Set(
      resolucao.evento.atacantes.flatMap((atacante) => atacante.peoesNoAlcance),
    );
    const peoesProtegidos = new Set<string>();
    for (const jogador of estado.jogadores) {
      if ((jogador.protegido ?? false) && alvos.has(jogador.peaoId)) {
        peoesProtegidos.add(jogador.peaoId);
      }
    }
    const vultoAtingidos = new Set<string>();
    const espectroAtingidos = new Set<string>();
    for (const atacante of resolucao.evento.atacantes) {
      const efetivos = atacante.peoesNoAlcance.filter(
        (peaoId) => !peoesProtegidos.has(peaoId),
      );
      for (const peaoId of efetivos) {
        if (atacante.tipo === 'vulto') vultoAtingidos.add(peaoId);
        else if (atacante.tipo === 'espectro') espectroAtingidos.add(peaoId);
      }
    }
    if (vultoAtingidos.size > 0 || espectroAtingidos.size > 0) {
      let mudou = false;
      const proximoJogadores = jogadores.map((jogador) => {
        const hitVulto = vultoAtingidos.has(jogador.peaoId);
        const hitEspectro = espectroAtingidos.has(jogador.peaoId);
        if (!hitVulto && !hitEspectro) return jogador;
        const jaEmBaixa = jogador.emBaixaIluminacao ?? false;
        const jaAmedrontado =
          (jogador.amedrontado ?? false) || jogador.sanidade === 0;
        let novoEmBaixa = jaEmBaixa;
        let novaSanidade = jogador.sanidade;
        let novoAmedrontado = jaAmedrontado;
        if (hitVulto && !jaEmBaixa) {
          novoEmBaixa = true;
          mudou = true;
        }
        if (hitEspectro) {
          if (jaAmedrontado) {
            // Imune: novo Espectro não tem efeito adicional (piso já 0).
          } else {
            novaSanidade = Math.max(0, jogador.sanidade - 1);
            if (novaSanidade !== jogador.sanidade) mudou = true;
            if (novaSanidade === 0 && !jaAmedrontado) {
              novoAmedrontado = true;
              mudou = true;
            }
          }
        }
        if (
          novoEmBaixa !== jaEmBaixa ||
          novaSanidade !== jogador.sanidade ||
          novoAmedrontado !== jaAmedrontado
        ) {
          return {
            ...jogador,
            emBaixaIluminacao: novoEmBaixa,
            sanidade: novaSanidade,
            amedrontado: novoAmedrontado,
          };
        }
        return jogador;
      });
      if (mudou) {
        jogadores = proximoJogadores;
      }
    }
  }

  // Normalização retrocompatível para estados persistidos sem os campos novos.
  jogadores = jogadores.map((jogador) => ({
    ...jogador,
    emBaixaIluminacao: jogador.emBaixaIluminacao ?? false,
    amedrontado: jogador.amedrontado ?? jogador.sanidade === 0,
  }));

  return { peoesNoAlcance: resolucao.peoesNoAlcance, jogadores };
}

// Pré-condição: ambos arrays devem vir do mesmo calcularIluminacao, que retorna
// sort determinístico (linha, coluna). Comparação por índice é segura.
function iluminacoesIguais(
  a: readonly Celula[],
  b: readonly Celula[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].linha !== b[i].linha || a[i].coluna !== b[i].coluna) return false;
  }
  return true;
}
