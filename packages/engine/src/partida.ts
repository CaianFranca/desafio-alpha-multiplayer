// Domínio puro dos Turnos e do loop da Partida (ST-11 / issue #114).
//
// Camada que compõe o estado do Tabuleiro com os campos de turno: roster de
// jogadores, Jogador Ativo, rodada, Peça do início do turno e Confirmação de
// Posição. O dispatch aplicarComandoDePartida segue o padrão dos dispatches
// existentes (aplicarComando do lobby e aplicarComandoDeTabuleiro): valida o
// ator, roteia o comando e produz eventos de domínio ou rejeições com códigos
// fechados. Exceção única: desistir_da_partida (issue #289) tem rota própria
// fora do FORA_DA_VEZ — qualquer Jogador do roster, no próprio turno ou fora
// dele. A dependência em runtime é única — partida.ts → monstros.ts →
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
// Ataque dos Monstros (issue #172, centrado no atuante pela #237 — fiação
// na Partida pela #236): a avaliação é POR MONSTRO, comparando a Peça do
// início do turno com a Peça decidida (confirmada, mantida ou posicionada)
// do peão do ATUANTE, no Tabuleiro PÓS-Limpeza. Os gatilhos são as ações
// definitivas do atuante: o posicionamento do Peão do Primeiro Turno
// (entrada — a Peça do início é null ≡ fora), a Confirmação de Posição com
// mudança de Peça e a Permanência (antes = depois — permanecer dentro
// dispara). Mover e a movimentação desfeita NUNCA disparam (só a decisão
// definitiva vale) e Encerrar o Turno e o posicionamento de peças nunca
// disparam. Fora→fora é silêncio — só os Monstros envolvidos atacam, mesmo
// com peões de terceiros parados dentro do Alcance (a causa do bug #262
// desaparece por construção). O Ataque é resolvido APÓS a Iluminação e a
// Limpeza (monstros.ts). A Proteção concedida pela Sala Médica na
// Confirmação não é consumida pelo Ataque do MESMO gatilho — permanece
// para o próximo (CONTEXT.md: "permanece até ser consumida").
//
// Proteção observável (issue #227): o evento posicao_confirmada carrega o
// `protegido` RESULTANTE do ator no fim do gatilho completo — concessão da
// Sala Médica e consumo pelo ataque do MESMO gatilho incluídos. O snapshot
// da partida (projeção no game-server) leva o `protegido` por Jogador como
// baseline autoritativa de reconciliação de reconexão; o consumo corrente
// continua observável em ataque_resolvido.protegidos. Espelho no wire:
// shared/src/partida.ts (cabeçalho de fronteira).

import {
  aplicarComandoDeTabuleiro,
  aplicarLimpeza,
  calcularIluminacao,
  celulaVizinhaNaBorda,
  ehPecaDeMonstro,
  estaDentroDaGrade,
  estadoInicialDoTabuleiro,
  gerarRecebidas,
  tetoDoPortao,
  validarTexto,
  vagasDisponiveis,
  vizinhasConectadas,
  type Celula,
  type BordaCardinal,
  type ComandoDeTabuleiro,
  type CorDoPeao,
  type CodigoDeErroDeTabuleiro,
  type EscolherVagaDaPecaRecebidaComando,
  type EstadoDoTabuleiro,
  type EventoDoTabuleiro,
  type GirarPecaComando,
  type MoverPeaoComando,
  type PecaPosicionada,
  type PecaRecebida,
  type PermanecerComando,
  type PosicionarPecaComando,
  type PosicionarPeaoComando,
  type SelecionarPecaComando,
} from './tabuleiro.ts';
import {
  resolverAtaquesCentradoNoAtuante,
  type AtaqueResolvidoEvento,
  type EstadoResultanteDoAtaque,
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
  // Travessia do Escuro (issue #264): a jogada exclusiva de Baixa Iluminação é
  // única por turno — o Peão da vez atravessa para a célula escura conectada
  // uma única vez; a flag é zerada no avanço da vez. Retrocompatível: estados
  // antigos persistem sem o campo (acesso via ?? false).
  readonly atravessouNoTurno: boolean;
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
  // no último gatilho (posicionamento do Peão do Primeiro Turno, Confirmação
  // de Posição com mudança de Peça ou Permanência) — observabilidade do
  // Alcance atual (a decisão de disparar é centrada no atuante desde a
  // issue #236/#237 e não usa mais este snapshot). Chave = pecaId do Monstro;
  // valor = peaoIds. Monstros removidos pela Limpeza têm a entrada podada no
  // gatilho seguinte.
  readonly peoesNoAlcance: Readonly<Record<string, readonly string[]>>;
  // Resgate (issue #171): peças em período de graça — Permanência bloqueada
  // até saída de um peão. Retrocompatível: estados antigos persistem sem o
  // campo (acesso via ?? []).
  readonly pecasEmPeriodoDeGraca: readonly string[];
}

export interface ConfirmarPosicaoDoPeaoComando {
  readonly tipo: 'confirmar_posicao_do_peao';
  readonly peaoId: string;
}

// Desfecho da Partida (issue #176, roster variável N = 2–4 pela #285): vitória,
// ou derrota com motivo. A vitória exige as TRÊS condições simultâneas — 3
// geradores ligados, cartão de acesso obtido e os N peões no mesmo Portão de
// Saída; a definição da posição dos peões cobre apenas essa terceira condição.
export type DesfechoDaPartida =
  | { readonly tipo: 'vitoria' }
  | {
      readonly tipo: 'derrota';
      // Desistência (issue #289): o quórum mínimo — um Jogador restante após
      // desistências — encerra em derrota e precede a vitória.
      readonly motivo: 'caixa_esgotada' | 'equipe_amedrontada' | 'desistencia';
    };

export interface EncerrarTurnoComando {
  readonly tipo: 'encerrar_turno';
}

// Desistência (issue #289): comando de domínio do ato irreversível de sair da
// Partida em andamento. Só o próprio Jogador desiste (ator === desistente),
// no próprio turno ou fora dele — fora do FORA_DA_VEZ, com rota própria no
// dispatch.
export interface DesistirDaPartidaComando {
  readonly tipo: 'desistir_da_partida';
}

// Travessia do Escuro (issue #264 / spec #272): comando de domínio da jogada
// exclusiva de Baixa Iluminação — o alvo é a célula ESCURA (fora de
// celulasIluminadas) conectada à peça sob o Peão (vaga de borda aberta com
// célula vizinha vazia). Guardas na ordem canônica: Peão do ator, Primeiro
// Turno, posição confirmada, Baixa obrigatória, travessia única por turno,
// seleção/posicionamento e validade do alvo (grade, ocupação, conexão,
// escuridão).
export interface AtravessarOEscuroDaPartidaComando {
  readonly tipo: 'atravessar_o_escuro';
  readonly peaoId: string;
  readonly celula: Celula;
}

export type ComandoDePartida =
  | ComandoDeTabuleiro
  | ConfirmarPosicaoDoPeaoComando
  | AtravessarOEscuroDaPartidaComando
  | EncerrarTurnoComando
  | DesistirDaPartidaComando;

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
  // Proteção do ator RESULTANTE do gatilho (issue #227): o espelho exato do
  // `protegido` do ator no ESTADO FINAL — true quando a Sala Médica a concedeu
  // (sobrevive ao ataque do MESMO gatilho) OU quando uma Proteção prévia não
  // foi consumida; false quando não havia Proteção ou ela foi consumida pelo
  // ataque do próprio gatilho (sem Sala Médica no destino para restaurá-la).
  readonly protegido: boolean;
}

export interface CelulasIluminadasEvento {
  readonly tipo: 'celulas_iluminadas';
  readonly celulas: readonly Celula[];
}

// Resgate (issue #171): um único resgate remove todos os estados do
// afetado presente na peça; amedrontado→sanidade 1, baixa→sanidade inalterada.
export interface ResgateRealizadoEvento {
  readonly tipo: 'resgate_realizado';
  readonly pecaId: string;
  readonly resgatadoJogadorId: string;
  readonly resgatadorJogadorId: string;
  readonly resgatadorPeaoId: string;
}

// Desistência (issue #289): eco do domínio — o Jogador saiu da Partida em
// andamento; o peão indicado foi removido (a célula fica livre) e a vez saiu
// da ordem. Abre o lote do comando, antes de celulas_iluminadas,
// limpeza_aplicada e da Passagem de Vez (quando o desistente era o Ativo).
export interface DesistenciaRegistradaEvento {
  readonly tipo: 'desistencia_registrada';
  readonly jogadorId: string;
  readonly peaoId: string;
}

// Término (issue #176): emitido no máximo uma vez, sempre como ÚLTIMO evento
// do lote da Ação que consumou o desfecho.
export interface PartidaTerminadaEvento {
  readonly tipo: 'partida_terminada';
  readonly desfecho: DesfechoDaPartida;
}

// Travessia do Escuro (issue #264): eco do domínio — o Peão em Baixa
// Iluminação alcançou a célula escura conectada. O lote segue com o
// Recebimento de Baixa (peca_sorteada + recebimento_gerado) quando o sorteio
// produz peça; a travessia NÃO é ponto definitivo (sem Limpeza/Ataque,
// ADR-0005).
export interface AtravessouOEscuroEvento {
  readonly tipo: 'atravessou_o_escuro';
  readonly peaoId: string;
  readonly celula: Celula;
}

export type EventoDaPartida =
  | EventoDoTabuleiro
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasEvento
  | AtaqueResolvidoEvento
  | ResgateRealizadoEvento
  | AtravessouOEscuroEvento
  | DesistenciaRegistradaEvento
  | PartidaTerminadaEvento;

export type CodigoDeErroDaPartida =
  | CodigoDeErroDeTabuleiro
  | 'FORA_DA_VEZ'
  | 'PECA_INICIAL_INDISPONIVEL'
  | 'POSICAO_CONFIRMADA'
  | 'ENCERRAMENTO_INVALIDO'
  | 'MOVIMENTO_INDISPONIVEL'
  | 'JOGADOR_NAO_NA_PARTIDA'
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

// Cores canônicas dos Peões, atribuídas pela ordem de entrada dos Jogadores
// (mesma ordem dos Peões do Tabuleiro, em estadoInicialDoTabuleiro). O roster
// é variável (N = 2–4, issue #285): fatiam-se as N primeiras cores na criação.
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
  if (jogadoresEmOrdem.length < 2 || jogadoresEmOrdem.length > 4) {
    return rejeitarDaPartida(
      'DADOS_INVALIDOS',
      'A Partida exige de dois a quatro jogadores.',
    );
  }
  if (new Set(jogadoresEmOrdem).size !== jogadoresEmOrdem.length) {
    return rejeitarDaPartida(
      'DADOS_INVALIDOS',
      'Os identificadores dos jogadores devem ser únicos.',
    );
  }

  const cores = CORES_PELA_ORDEM.slice(0, jogadoresEmOrdem.length);
  const jogadores: JogadorDaPartida[] = jogadoresEmOrdem.map(
    (jogadorId, indice) => {
      const cor = cores[indice];
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
    tabuleiro: estadoInicialDoTabuleiro({
      ...(entrada ?? {}),
      numeroDeJogadores: jogadoresEmOrdem.length,
    }),
    jogadores,
    jogadorAtivoId: jogadores[0].jogadorId,
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    atravessouNoTurno: false,
    celulasIluminadas: [],
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    // Nenhum Monstro posicionado na abertura: o snapshot do Alcance começa
    // vazio (issue #172).
    peoesNoAlcance: {},
    pecasEmPeriodoDeGraca: [],
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
  // Desistência (issue #289): rota própria fora do FORA_DA_VEZ — qualquer
  // Jogador do roster desiste no próprio turno ou fora dele; só o próprio
  // (ator === desistente) é aceito, validado dentro de desistirDaPartida.
  if (comando.tipo === 'desistir_da_partida') {
    return funilarAvaliacaoDoTermino(desistirDaPartida(estado, ator));
  }
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
      return girarPecaDaPartida(estado, comando, jogadorAtivo);
    case 'finalizar_manipulacao':
      // Sem pré-adoção: a finalização consulta a janela de Manipulação, não a
      // Seleção (mesma razão do giro em si; fica fora do alcance do review).
      return delegarAoTabuleiro(estado, comando);
    case 'escolher_vaga_da_peca_recebida':
      return escolherVagaDaPecaRecebidaDaPartida(estado, comando, jogadorAtivo);
    case 'selecionar_peao': {
      const alheio = exigirPeaoDoAtor(comando.peaoId, jogadorAtivo);
      if (alheio) {
        return alheio;
      }
      return delegarAoTabuleiro(estado, comando);
    }
    case 'desselecionar_peao': {
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
    case 'atravessar_o_escuro':
      return atravessarOEscuroDaPartida(estado, comando, jogadorAtivo);
    case 'confirmar_posicao_do_peao':
      return confirmarPosicaoDoPeao(estado, comando, jogadorAtivo);
    case 'encerrar_turno':
      return encerrarTurnoDaPartida(estado, jogadorAtivo);
    case 'desistir_da_partida':
      // Inalcançável via aplicarComandoDePartida (rota própria acima, fora do
      // FORA_DA_VEZ) — rede de proteção da exaustividade: delega com o Ativo.
      return desistirDaPartida(estado, jogadorAtivo.jogadorId);
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
  // Encaixe de Recebida com Seleção nula (B1/review #333): a pré-adoção do
  // Peão do ator mantém a sequência (escolher vaga → encaixar) íntegra em
  // estados persistidos do pré-deploy. Posições comuns não adotam nada.
  const ehRecebida = estado.tabuleiro.recebidas.some(
    (item) => item.pecaId === comando.pecaId,
  );
  if (ehRecebida) {
    estado = adotarSelecaoDoAtor(estado, ator);
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
  // ADR-0013 / issue #354: em Baixa, só vagas escuras geram puxada — sem vaga
  // escura não há peça (evita pendência irresolúvel da #343). Em Baixa a
  // iluminação para o filtro é a fresca pós-posicionamento (inclui o novo peão).
  const emBaixaAntes = ator.emBaixaIluminacao ?? false;
  const emBaixa = emBaixaAntes;
  const celulasParaFiltroPrimeiroTurno = emBaixa
    ? calcularIluminacao(
        resultado.estado,
        estado.jogadores
          .filter((j) => (j.emBaixaIluminacao ?? false))
          .map((j) => j.peaoId),
      )
    : undefined;
  const sorteio = peca
    ? emBaixa
      ? gerarRecebidas(resultado.estado, peca, true, celulasParaFiltroPrimeiroTurno!)
      : gerarRecebidas(resultado.estado, peca, false)
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
  // Ataque (issues #172/#236): resolvido logo após a Limpeza — Monstro
  // removido não ataca e tem a entrada podada do snapshot. O posicionamento
  // do Peão no Primeiro Turno é ENTRADA por definição: a Peça do início do
  // turno é null (≡ fora) e a Peça decidida é a recém-ocupada.
  // ST-15 / issue #170: se o Ataque impôs Baixa Iluminação nova, a Iluminação
  // é recalculada e a Limpeza reaplicada no MESMO gatilho.
  const iluminacao = recalcularIluminacaoEAplicarLimpeza(estado, tabuleiro, eventos);
  const tabuleiroPosLimpeza = { ...tabuleiro, posicionadas: iluminacao.posicionadas };
  // Sem Peça sob o Peão (estado inconsistente defensivo), '' nunca casa com
  // um pecaId de Alcance: avalia como fora→fora, silêncio.
  const ataque = resolverAtaqueNoGatilho(
    estado,
    tabuleiroPosLimpeza,
    eventos,
    null,
    peao?.pecaId ?? '',
  );
  const { celulasIluminadas, posicionadas: posicionadasFinais } =
    reaplicarIluminacaoSeBaixaNova(
      estado,
      ataque.jogadores,
      tabuleiroPosLimpeza,
      iluminacao,
      eventos,
    );
  // Issue #343 (espelha 8063dfe): sorteio usou Baixa pre-ataque — Baixa nova descarta tudo.
  const atorAposAtaque = ataque.jogadores.find(
    (jogador) => jogador.jogadorId === ator.jogadorId,
  );
  const baixaNovaDoAtor =
    !emBaixaAntes && ((atorAposAtaque?.emBaixaIluminacao ?? false) === true);
  const recebidasFinais = baixaNovaDoAtor ? [] : sorteio.recebidas;
  if (baixaNovaDoAtor && sorteio.recebidas.length > 0) {
    for (let indice = eventos.length - 1; indice >= 0; indice--) {
      if (
        eventos[indice].tipo === 'peca_sorteada' ||
        eventos[indice].tipo === 'recebimento_gerado'
      ) {
        eventos.splice(indice, 1);
      }
    }
  }
  const tabuleiroFinal: EstadoDoTabuleiro = {
    ...tabuleiroPosLimpeza,
    caixa: baixaNovaDoAtor ? resultado.estado.caixa : tabuleiroPosLimpeza.caixa,
    recebidas: recebidasFinais,
    posicionadas: posicionadasFinais,
  };
  return sucessoDaPartida(
    {
      ...estado,
      tabuleiro: tabuleiroFinal,
      celulasIluminadas,
      peoesNoAlcance: ataque.peoesNoAlcance,
      jogadores: ataque.jogadores,
      pecasEmPeriodoDeGraca: estado.pecasEmPeriodoDeGraca ?? [],
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

  const destino = estado.tabuleiro.posicionadas.find(
    (peca) =>
      peca.celula.linha === comando.celula.linha &&
      peca.celula.coluna === comando.celula.coluna,
  );

  // Guarda defensiva: monstro nunca aceita peão — rejeita antes de qualquer
  // exceção de ocupação (mesmo que contivesse afetado em estado artesanal).
  if (destino && ehPecaDeMonstro(destino.tipo)) {
    return rejeitarDaPartida('PECA_JA_TEM_PEAO', 'A Peça de destino é um Monstro e não aceita Peão.');
  }

  // Precedência: conexão antes de ocupação — garante que sem conexão o erro
  // seja MOVIMENTO_NAO_CONECTADO e não PECA_JA_TEM_PEAO mascarado.
  const origemPeao = estado.tabuleiro.peoes.find((item) => item.peaoId === comando.peaoId);
  const origemPecaId = origemPeao?.pecaId ?? null;
  if (destino && origemPecaId !== null) {
    const origem = estado.tabuleiro.posicionadas.find((peca) => peca.pecaId === origemPecaId);
    if (origem) {
      const conectadas = vizinhasConectadas(estado.tabuleiro, origem.pecaId);
      const ehConectada = conectadas.some((peca) => peca.pecaId === destino.pecaId);
      if (!ehConectada) {
        const resultadoConexao = aplicarComandoDeTabuleiro(estado.tabuleiro, comando);
        if (!resultadoConexao.sucesso) return { sucesso: false, erro: resultadoConexao.erro };
      }
    }
  }

  // Exceção de ocupação (issue #171): peça com afetado tolera +1 peão.
  if (destino) {
    const teto = tetoOcupacao(destino, estado);
    const ocupantes = estado.tabuleiro.peoes.filter(
      (peao) => peao.pecaId === destino.pecaId,
    ).length;
    if (ocupantes >= teto) {
      return rejeitarDaPartida('PECA_JA_TEM_PEAO', 'A Peça de destino já abriga outro Peão.');
    }
  }

  // Zona da origem: o Peão só pousa na Peça do início do turno ou em vizinha
  // diretamente conectada a ela — ida-e-volta livre até a Confirmação de
  // Posição, sem viajar pelo tabuleiro dentro do turno. Célula vazia não é
  // barrada aqui (vaza para CELULA_NAO_ENCONTRADA do Tabuleiro). Pousa depois
  // das guardas de conexão/ocupação para preservar erros mais específicos
  // (MOVIMENTO_NAO_CONECTADO, PECA_JA_TEM_PEAO). A Travessia do Escuro (#272)
  // é isenta: o mover_peao da cadeia nasce de atravessar_o_escuro — Baixa
  // Iluminação — e sai da zona de propósito.
  const origemDoTurnoId = estado.pecaDoInicioDoTurnoId;
  const origemDoTurno = origemDoTurnoId
    ? estado.tabuleiro.posicionadas.find((peca) => peca.pecaId === origemDoTurnoId)
    : undefined;
  if (
    !(estado.atravessouNoTurno ?? false) &&
    origemDoTurnoId !== null &&
    origemDoTurno !== undefined &&
    destino
  ) {
    const zona = [
      origemDoTurnoId,
      ...vizinhasConectadas(estado.tabuleiro, origemDoTurnoId).map(
        (peca) => peca.pecaId,
      ),
    ];
    if (!zona.includes(destino.pecaId)) {
      return rejeitarDaPartida(
        'MOVIMENTO_INDISPONIVEL',
        'O Peão só se move dentro da zona da Peça do início do turno.',
      );
    }
  }

  const resultadoTab = aplicarComandoDeTabuleiro(estado.tabuleiro, comando);
  let tabuleiroNovo: EstadoDoTabuleiro;
  let eventosTab: readonly EventoDoTabuleiro[];
  let pecaIdPara: string | null = null;

  if (!resultadoTab.sucesso) {
    // Se a rejeição foi por ocupação mas a exceção de resgate permite, realiza
    // o movimento manualmente (evita tocar peoes.ts com roster e mantém a
    // dependência unidirecional partida→tabuleiro→peoes). O fallback segue
    // vivo (issue #285): com afetado no destino o teto da Partida (N+1 via
    // tetoDoPortao) supera o teto base do Tabuleiro (N), então a delegação
    // rejeita e só este caminho autoriza a entrada do resgatador.
    if (resultadoTab.erro.codigo === 'PECA_JA_TEM_PEAO' && destino) {
      const teto = tetoOcupacao(destino, estado);
      const ocupantes = estado.tabuleiro.peoes.filter(
        (peao) => peao.pecaId === destino.pecaId,
      ).length;
      if (ocupantes < teto) {
        const origem = origemPecaId
          ? estado.tabuleiro.posicionadas.find((peca) => peca.pecaId === origemPecaId)
          : undefined;
        if (!origem || origemPecaId === null) {
          return { sucesso: false, erro: resultadoTab.erro };
        }
        // Revalida Conexão para garantir que o resgate exige Conexão (o erro
        // de ocupação em peoes só ocorre após passar na conexão e demais
        // guardas, mas reforçamos por segurança).
        const conectadas = vizinhasConectadas(estado.tabuleiro, origem.pecaId);
        if (!conectadas.some((peca) => peca.pecaId === destino.pecaId)) {
          return { sucesso: false, erro: resultadoTab.erro };
        }
        // Defesa monstro já validada acima, mas reforça aqui para fallback artesanal.
        if (ehPecaDeMonstro(destino.tipo)) {
          return { sucesso: false, erro: resultadoTab.erro };
        }
        const peoes = estado.tabuleiro.peoes.map((item) =>
          item.peaoId === comando.peaoId ? { ...item, pecaId: destino.pecaId } : item,
        );
        // Semântica única do mover (issue #334): TODOS os ramos re-selecionam
        // o Peão movido — o fechamento da função fixa peaoSelecionadoId no
        // peão do comando. Este ramo de exceção (resgate por co-ocupação)
        // herdava o `peaoSelecionadoId: null` da época do revert e divergia do
        // fechamento; a limpeza aqui era sobrescrita de qualquer forma.
        tabuleiroNovo = { ...estado.tabuleiro, peoes };
        eventosTab = [
          {
            tipo: 'peao_movido',
            peaoId: comando.peaoId,
            pecaIdDe: origem.pecaId,
            pecaIdPara: destino.pecaId,
            celula: comando.celula,
          },
        ];
        pecaIdPara = destino.pecaId;
      } else {
        return { sucesso: false, erro: resultadoTab.erro };
      }
    } else {
      return { sucesso: false, erro: resultadoTab.erro };
    }
  } else {
    tabuleiroNovo = resultadoTab.estado;
    eventosTab = resultadoTab.eventos;
    const movEvento = eventosTab.find((evento) => evento.tipo === 'peao_movido') as
      | { pecaIdPara: string }
      | undefined;
    pecaIdPara = movEvento?.pecaIdPara ?? destino?.pecaId ?? null;
  }

  // Resgate + período de graça atômico após mover sucesso.
  // O resgate é por aliado: exclui o próprio ator (movimento próprio não
  // resgata a si mesmo).
  const afetadosNoDestino = estado.jogadores.filter((jogador) => {
    if (jogador.jogadorId === ator.jogadorId) return false;
    const peao = tabuleiroNovo.peoes.find((item) => item.peaoId === jogador.peaoId);
    return (
      peao?.pecaId === pecaIdPara &&
      ((jogador.emBaixaIluminacao ?? false) || (jogador.amedrontado ?? jogador.sanidade === 0))
    );
  });

  let jogadoresNovos: readonly JogadorDaPartida[] = estado.jogadores;
  const eventosResgate: EventoDaPartida[] = [];

  if (afetadosNoDestino.length > 0 && pecaIdPara !== null) {
    jogadoresNovos = estado.jogadores.map((jogador) => {
      const ehAfetado = afetadosNoDestino.some((item) => item.jogadorId === jogador.jogadorId);
      if (!ehAfetado) return jogador;
      const eraAmedrontado = (jogador.amedrontado ?? jogador.sanidade === 0) === true;
      const novaSanidade = eraAmedrontado ? 1 : jogador.sanidade;
      return {
        ...jogador,
        emBaixaIluminacao: false,
        amedrontado: false,
        sanidade: novaSanidade,
      };
    });
    for (const afetado of afetadosNoDestino) {
      eventosResgate.push({
        tipo: 'resgate_realizado',
        pecaId: pecaIdPara,
        resgatadoJogadorId: afetado.jogadorId,
        resgatadorJogadorId: ator.jogadorId,
        resgatadorPeaoId: comando.peaoId,
      });
    }
  }

  let pecasEmPeriodoDeGraca = [...(estado.pecasEmPeriodoDeGraca ?? [])];
  if (afetadosNoDestino.length > 0 && pecaIdPara !== null) {
    if (!pecasEmPeriodoDeGraca.includes(pecaIdPara)) {
      pecasEmPeriodoDeGraca = [...pecasEmPeriodoDeGraca, pecaIdPara];
    }
  }
  if (
    origemPecaId !== null &&
    pecasEmPeriodoDeGraca.includes(origemPecaId) &&
    origemPecaId !== pecaIdPara
  ) {
    pecasEmPeriodoDeGraca = pecasEmPeriodoDeGraca.filter((id) => id !== origemPecaId);
  }
  // Poda stale: se a peça graçada não existe mais no tabuleiro (ex.: limpeza
  // defensiva), remove da lista para não reter ID órfão.
  if (pecasEmPeriodoDeGraca.length > 0) {
    const idsPosicionadas = new Set(tabuleiroNovo.posicionadas.map((peca) => peca.pecaId));
    pecasEmPeriodoDeGraca = pecasEmPeriodoDeGraca.filter((id) => idsPosicionadas.has(id));
  }

  // Re-seleção do Peão (#263/#324/#334): após o mover_peao bem-sucedido, o
  // Peão movido permanece/re-é selecionado em TODOS os ramos (delegação e
  // fallback de resgate) — o confirmar substitui o permanecer sem exigir
  // re-seleção manual.
  const estadoNovo: EstadoDaPartida = {
    ...estado,
    tabuleiro: { ...tabuleiroNovo, peaoSelecionadoId: comando.peaoId },
    jogadores: jogadoresNovos,
    pecasEmPeriodoDeGraca,
  };

  return sucessoDaPartida(estadoNovo, [...eventosTab, ...eventosResgate]);
}

// Travessia do Escuro (issue #264 / spec #272): jogada exclusiva de Baixa
// Iluminação — o Peão da vez (selecionado e posicionado) atravessa para uma
// célula ESCURA (fora de celulasIluminadas) conectada à peça sob ele (vaga de
// borda aberta com célula vizinha vazia). Efeito: um único Recebimento de
// Baixa (limite de 1 peça) nasce com a célula-alvo PRÉ-FIXADA na célula da
// travessia; o Jogador escolhe a borda correspondente (escolher_vaga), encaixa
// a Peça (posicionar_peca) e move o Peão para ela (mover_peao). Guardas na
// ordem canônica do plano:
//   exigirPeaoDoAtor → FORA_DA_VEZ; Primeiro Turno → MOVIMENTO_INDISPONIVEL;
//   posicaoConfirmada → POSICAO_CONFIRMADA; sem Baixa →
//   MOVIMENTO_INDISPONIVEL; já atravessou no turno → MOVIMENTO_INDISPONIVEL;
//   Seleção de OUTRO Peão → PEAO_NAO_SELECIONADO (Seleção nula usa o Peão do
//   ator, AC-3 do #272); Peão sobre a Mesa → PEAO_NAO_SELECIONADO; alvo fora da
//   grade → CELULA_NAO_ENCONTRADA; ocupado → CELULA_JA_OCUPADA; não-vizinho
//   via borda aberta → MOVIMENTO_NAO_CONECTADO; iluminado →
//   MOVIMENTO_INDISPONIVEL.
// NÃO é ponto definitivo: não recalcula Iluminação, não aplica Limpeza nem
// Ataque (ADR-0005 — pontos definitivos são apenas Primeiro Turno e
// Confirmação de Posição). Caixa vazia ou sem vagas → 0 peças, sem evento de
// travessia e sem marcar a flag (espelha "Caixa vazia não é erro").
//
// CADEIA OBRIGATÓRIA (Req 3 do #272 / Expected do #264): a Limpeza do caminho
// escuro acontece no ponto definitivo que FECHA a sequência — atravessar →
// escolher_vaga (borda da célula travada) → posicionar_peca → mover_peao →
// confirmar_posicao_do_peao. Garantia estrutural do servidor: com o
// Recebimento da travessia pendente, o confirmar recusa
// (PENDENCIA_NAO_RESOLVIDA), o mover recusa (mesma pendência, peoes.ts) e o
// encerrar recusa — sem atalho que descarte a peça sorteada nem estado
// intermediário sem Limpeza. O confirmar SEMPRE recalcula a Iluminação e
// reaplica a Limpeza (recalcularIluminacaoEAplicarLimpeza); a iluminação
// materializada apenas nos pontos definitivos é a garantia do ADR-0005
// ("preserva o desfazer").
function atravessarOEscuroDaPartida(
  estado: EstadoDaPartida,
  comando: AtravessarOEscuroDaPartidaComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const alheio = exigirPeaoDoAtor(comando.peaoId, ator);
  if (alheio) {
    return alheio;
  }
  if (ator.primeiroTurnoPendente) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'A Travessia do Escuro não existe no Primeiro Turno.',
    );
  }
  if (estado.posicaoConfirmada) {
    return rejeitarDaPartida(
      'POSICAO_CONFIRMADA',
      'A posição do Peão já foi confirmada; encerre o turno.',
    );
  }
  if (!(ator.emBaixaIluminacao ?? false)) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'A Travessia do Escuro é exclusiva de Baixa Iluminação.',
    );
  }
  if (estado.atravessouNoTurno ?? false) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'O Peão já atravessou o Escuro neste turno.',
    );
  }

  const peao = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === comando.peaoId,
  );
  if (!peao) {
    return rejeitarDaPartida('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }
  // Issue #264 / AC-3 do #272: a Travessia não exige o Peão selecionado — com
  // Seleção nula a referência é o Peão próprio do ator (já garantido por
  // exigirPeaoDoAtor); apenas a Seleção de OUTRO Peão permanece inválida,
  // mesmo fallback da Confirmação de Posição.
  if (
    estado.tabuleiro.peaoSelecionadoId !== null &&
    estado.tabuleiro.peaoSelecionadoId !== peao.peaoId
  ) {
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'Outro Peão está selecionado; a Travessia exige o Peão do ator.',
    );
  }
  if (peao.pecaId === null) {
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'O Peão está sobre a Mesa; não há como atravessar o Escuro.',
    );
  }
  const pecaSobOPeao = estado.tabuleiro.posicionadas.find(
    (item) => item.pecaId === peao.pecaId,
  );
  if (!pecaSobOPeao) {
    return rejeitarDaPartida(
      'PEAO_NAO_ENCONTRADO',
      'A Peça do Peão não foi encontrada.',
    );
  }

  const alvo = comando.celula;
  if (!estaDentroDaGrade(alvo.linha) || !estaDentroDaGrade(alvo.coluna)) {
    return rejeitarDaPartida(
      'CELULA_NAO_ENCONTRADA',
      'A célula de destino está fora da grade.',
    );
  }
  const ocupada = estado.tabuleiro.posicionadas.some(
    (peca) => peca.celula.linha === alvo.linha && peca.celula.coluna === alvo.coluna,
  );
  if (ocupada) {
    return rejeitarDaPartida(
      'CELULA_JA_OCUPADA',
      'A célula de destino já está ocupada.',
    );
  }
  const ehVagaDaPeca = vagasDisponiveis(
    estado.tabuleiro,
    pecaSobOPeao,
    estado.tabuleiro.recebidas,
  ).some(
    (candidata) =>
      candidata.celula.linha === alvo.linha && candidata.celula.coluna === alvo.coluna,
  );
  if (!ehVagaDaPeca) {
    return rejeitarDaPartida(
      'MOVIMENTO_NAO_CONECTADO',
      'A célula de destino não é uma vaga escura conectada à Peça sob o Peão.',
    );
  }
  // ADR-0013 bloqueante 3: iluminação fresca unificada — mesmo preamble de
  // avancarVez/posicionarPeao, não o snapshot stale do turno anterior.
  const celulasParaFiltroTravessia = calcularIluminacao(
    estado.tabuleiro,
    estado.jogadores.filter((j) => (j.emBaixaIluminacao ?? false)).map((j) => j.peaoId),
  );
  if (
    celulasParaFiltroTravessia.some(
      (celula) => celula.linha === alvo.linha && celula.coluna === alvo.coluna,
    )
  ) {
    return rejeitarDaPartida(
      'MOVIMENTO_INDISPONIVEL',
      'A célula de destino está iluminada; use a Movimentação normal.',
    );
  }

  // Efeito: Recebimento de Baixa (limite 1) com a célula-alvo pré-fixada na
  // célula da travessia. A ordem canônica do lote abre com atravessou_o_escuro
  // e segue com peca_sorteada (do sorteio) + recebimento_gerado. A Seleção do
  // Peão é preservada para a sequência (escolher vaga → encaixar → mover) —
  // e, quando nula (AC-3 do #272), adotada a partir do Peão do ator: nenhum
  // passo intermediário exige re-seleção.
  // ADR-0013: mantido como legado; o fluxo canônico é Puxar no início do turno
  // (avancarVez). Aqui o sorteio respeita vagas escuras (sem vaga escura → 0)
  // com iluminação fresca — unificada com avancarVez/posicionarPeao (bloqueante 3).
  const sorteio = gerarRecebidas(estado.tabuleiro, pecaSobOPeao, true, celulasParaFiltroTravessia);
  const recebidas = sorteio.recebidas.map((recebida) => ({
    ...recebida,
    celulaAlvo: alvo,
  }));
  const tabuleiro = {
    ...sorteio.estado,
    recebidas,
    peaoSelecionadoId: estado.tabuleiro.peaoSelecionadoId ?? comando.peaoId,
  };
  let atravessouNoTurno = false;
  const eventos: EventoDaPartida[] = [];
  if (recebidas.length > 0) {
    atravessouNoTurno = true;
    eventos.push(
      { tipo: 'atravessou_o_escuro', peaoId: comando.peaoId, celula: alvo },
      ...sorteio.eventos,
      {
        tipo: 'recebimento_gerado',
        recebidas: projetarRecebidas(recebidas),
      },
    );
  }
  return sucessoDaPartida(
    { ...estado, tabuleiro, atravessouNoTurno },
    eventos,
  );
}

// ST-15 / issue #264: em Baixa Iluminação a escolha de vaga é restrita na
// camada da Partida antes de delegar ao Tabuleiro — a pendência da Travessia
// do Escuro (celulaAlvo pré-fixada) só aceita a borda que mapeia à célula
// travada; as pendências comuns (Recebimento do Primeiro Turno) só aceitam
// vaga em célula NÃO iluminada. Rejeição DADOS_INVALIDOS; fora de Baixa,
// delega direto (comportamento histórico intacto).
// Req 4 do #272: a vaga deriva da Peça sob o Peão DO ATOR (ator.peaoId), não
// da Seleção — Seleção nula não fragiliza a validação da vaga escura (o Peão
// selecionado no turno do ator é sempre o próprio ator, então a referência é
// equivalente na sequência normal).
function escolherVagaDaPecaRecebidaDaPartida(
  estado: EstadoDaPartida,
  comando: EscolherVagaDaPecaRecebidaComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  estado = adotarSelecaoDoAtor(estado, ator);
  if (!(ator.emBaixaIluminacao ?? false)) {
    return delegarAoTabuleiro(estado, comando);
  }
  const celulaDaBorda = celulaDaVagaDoAtor(estado, ator, comando.borda);
  const recebida = estado.tabuleiro.recebidas.find(
    (item) => item.recebidaId === comando.recebidaId,
  );
  if (recebida !== undefined && recebida.celulaAlvo !== null) {
    // Pendência da Travessia: a borda deve mapear exatamente à célula travada.
    const travada = recebida.celulaAlvo;
    if (
      celulaDaBorda === null ||
      celulaDaBorda.linha !== travada.linha ||
      celulaDaBorda.coluna !== travada.coluna
    ) {
      return rejeitarDaPartida(
        'DADOS_INVALIDOS',
        'A borda indicada não é a vaga da Travessia do Escuro.',
      );
    }
    return delegarAoTabuleiro(estado, comando);
  }
  // Pendência comum em Baixa: a vaga não pode cair em célula iluminada.
  if (
    celulaDaBorda !== null &&
    estado.celulasIluminadas.some(
      (celula) =>
        celula.linha === celulaDaBorda.linha && celula.coluna === celulaDaBorda.coluna,
    )
  ) {
    return rejeitarDaPartida(
      'DADOS_INVALIDOS',
      'Em Baixa Iluminação a vaga deve ser uma célula escura.',
    );
  }
  return delegarAoTabuleiro(estado, comando);
}

// Célula vizinha na direção da borda a partir da Peça sob o Peão do ator, ou
// null quando o Peão do ator não está sobre uma Peça. Referência fixa no ator
// (Req 4 do #272): a validação da vaga em Baixa não depende da Seleção.
function celulaDaVagaDoAtor(
  estado: EstadoDaPartida,
  ator: JogadorDaPartida,
  borda: BordaCardinal,
): Celula | null {
  const peao = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === ator.peaoId,
  );
  const pecaSobOPeao = peao?.pecaId
    ? estado.tabuleiro.posicionadas.find((item) => item.pecaId === peao.pecaId)
    : undefined;
  return pecaSobOPeao ? celulaVizinhaNaBorda(pecaSobOPeao.celula, borda) : null;
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

  // Período de graça (issue #171): Permanência bloqueada na peça resgatada até
  // saída de um peão.
  const peaoAntes = estado.tabuleiro.peoes.find((item) => item.peaoId === comando.peaoId);
  if (
    peaoAntes !== undefined &&
    peaoAntes.pecaId !== null &&
    (estado.pecasEmPeriodoDeGraca ?? []).includes(peaoAntes.pecaId)
  ) {
    return rejeitarDaPartida(
      'ENCERRAMENTO_INVALIDO',
      'A Permanência está bloqueada na peça em período de graça até que um peão saia.',
    );
  }

  // ADR-0013 / issue #354: Permanência com seleção nula adota o peão do ator
  // (mesmo AC-3 de mover/confirmar) — evita PEAO_NAO_SELECIONADO quando o turno
  // em Baixa não tem seleção vigente mas tem pecaDoInicio válida.
  // NB2: adoção só para null; seleção alheia permanece rejeitada (PEAO_NAO_SELECIONADO)
  // e depende da pré-condição de avancarVez limpar peaoSelecionadoId ao trocar de vez.
  if (estado.tabuleiro.peaoSelecionadoId === null) {
    estado = {
      ...estado,
      tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: comando.peaoId },
    };
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

  // Ataque centrado no atuante (issues #172/#236): a Permanência é gatilho —
  // a Peça do início do turno e a Peça decidida são a MESMA (antes = depois),
  // então permanecer DENTRO do Alcance dispara e fora→fora é silêncio. A
  // permanência não muda a Iluminação: sem recálculo nem Limpeza aqui
  // (ADR-0005) — se o Vulto impor Baixa Iluminação nova, a Iluminação é
  // recalculada e a Limpeza reaplicada no MESMO gatilho, mesmo funil dos
  // demais. O lote mantém ataque_resolvido ANTES de turno_encerrado.
  const pecaMantidaId = estado.pecaDoInicioDoTurnoId ?? null;
  const eventos: EventoDaPartida[] = [...resultado.eventos];
  const ataque = resolverAtaqueNoGatilho(
    estado,
    resultado.estado,
    eventos,
    pecaMantidaId,
    pecaMantidaId ?? '',
  );
  const { celulasIluminadas, posicionadas: posicionadasFinais } =
    reaplicarIluminacaoSeBaixaNova(
      estado,
      ataque.jogadores,
      resultado.estado,
      {
        celulasIluminadas: estado.celulasIluminadas,
        posicionadas: resultado.estado.posicionadas,
      },
      eventos,
    );

  return avancarVez(
    {
      ...estado,
      tabuleiro: { ...resultado.estado, posicionadas: posicionadasFinais },
      celulasIluminadas,
      peoesNoAlcance: ataque.peoesNoAlcance,
      jogadores: ataque.jogadores,
    },
    [...eventos, { tipo: 'turno_encerrado', jogadorId: ator.jogadorId }],
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

  // Cadeia obrigatória do Escuro (Req 3 do #272 / issue #264): a Confirmação
  // é o ponto definitivo que fecha a sequência da Travessia — com o
  // Recebimento da travessia ainda pendente, confirmar direto descartaria a
  // peça sorteada da Caixa sem nunca posicioná-la. A pendência bloqueia o
  // encerramento (e o mover), então o guard aqui garante a cadeia no servidor:
  // escolher → encaixar → mover só então confirmar.
  if (estado.tabuleiro.recebidas.length > 0) {
    return rejeitarDaPartida(
      'PENDENCIA_NAO_RESOLVIDA',
      'Há Peças Recebidas pendentes; a Confirmação exige completar a Travessia (encaixar e mover) antes.',
    );
  }

  const peao = estado.tabuleiro.peoes.find(
    (item) => item.peaoId === comando.peaoId,
  );
  if (!peao) {
    return rejeitarDaPartida('PEAO_NAO_ENCONTRADO', 'O Peão não foi encontrado.');
  }
  // Issue #264: a Confirmação não exige o Peão selecionado — o movimento (que
  // limpa a seleção no Tabuleiro) precede a Confirmação nos dois fluxos de
  // Baixa Iluminação (Movimentação em célula iluminada e Travessia do Escuro);
  // exigir re-seleção aí travaria o turno (AC-3 do #272). A seleção de OUTRO
  // Peão permanece inválida.
  if (
    estado.tabuleiro.peaoSelecionadoId !== null &&
    estado.tabuleiro.peaoSelecionadoId !== peao.peaoId
  ) {
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'Outro Peão está selecionado; é ele que deve ser confirmado.',
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
  // Issue #264 / spec #272: em Baixa o Recebimento acontece na Travessia do
  // Escuro (ou não acontece — célula iluminada consome 0); a Confirmação em
  // Baixa NÃO sorteia (recebidas = []), mantendo Limpeza/Ataque do gatilho.
  // Review PR #370 (Bug 1): quem entra saudável e sai em Baixa no MESMO
  // gatilho também não recebe sorteio nesse CONFIRMAR — o emBaixa acima é
  // pré-ataque; a Baixa nova do gatilho descarta o sorteio abaixo (0 no turno
  // atual, 1 no próximo avancarVez, ADR-0013).
  const emBaixaAntes = ator.emBaixaIluminacao ?? false;
  const emBaixa = emBaixaAntes;
  const sorteio = emBaixa
    ? { estado: estado.tabuleiro, recebidas: [] as readonly PecaRecebida[], eventos: [] as readonly EventoDoTabuleiro[] }
    : gerarRecebidas(estado.tabuleiro, peca, emBaixa);
  // Issue #227: o posicao_confirmada só entra no lote ao FINAL da computação —
  // o evento carrega o protegido RESULTANTE do ator no gatilho completo, que
  // inclui a concessão da Sala Médica e o consumo pelo ataque do MESMO gatilho
  // (ambos computados abaixo). A ordem do lote é preservada: ele permanece em
  // PRIMEIRO, antes de peca_sorteada/recebimento_gerado/celulas_iluminadas/
  // ataque_resolvido.
  const eventos: EventoDaPartida[] = [...sorteio.eventos];
  if (sorteio.recebidas.length > 0) {
    eventos.push({
      tipo: 'recebimento_gerado',
      recebidas: projetarRecebidas(sorteio.recebidas),
    });
  }
  const tabuleiro = { ...sorteio.estado, recebidas: sorteio.recebidas };
  // Limpeza e Ataque (issues #172/#236) na mesma ordem do Primeiro Turno:
  // Iluminação → Limpeza → Ataque → atualização do snapshot do Alcance. A
  // avaliação é centrada no atuante: Peça do início do turno (antes) vs Peça
  // confirmada (depois).
  const iluminacao = recalcularIluminacaoEAplicarLimpeza(estado, tabuleiro, eventos);
  const tabuleiroPosLimpeza = { ...tabuleiro, posicionadas: iluminacao.posicionadas };
  const ataque = resolverAtaqueNoGatilho(
    estado,
    tabuleiroPosLimpeza,
    eventos,
    // ?? null: defensivo para estados persistidos sem o campo (binário
    // anterior) — sem Peça do início, o "antes" avalia como fora.
    estado.pecaDoInicioDoTurnoId ?? null,
    peca.pecaId,
  );
  const { celulasIluminadas, posicionadas: posicionadasPosAtaque } =
    reaplicarIluminacaoSeBaixaNova(
      estado,
      ataque.jogadores,
      tabuleiroPosLimpeza,
      iluminacao,
      eventos,
    );
  // Review PR #370 (Bug 1): o sorteio acima usou a Baixa pré-ataque — se o
  // gatilho impôs Baixa nova ao ator, o turno encerra sem sortear: remove
  // peca_sorteada/recebimento_gerado do lote e restaura a Caixa consumida. O
  // puxar-1 vem no próximo avancarVez (ADR-0013).
  const atorAposAtaque = ataque.jogadores.find(
    (jogador) => jogador.jogadorId === ator.jogadorId,
  );
  const baixaNovaDoAtor =
    !emBaixaAntes && ((atorAposAtaque?.emBaixaIluminacao ?? false) === true);
  const recebidasFinais = baixaNovaDoAtor ? [] : sorteio.recebidas;
  if (baixaNovaDoAtor && sorteio.recebidas.length > 0) {
    for (let indice = eventos.length - 1; indice >= 0; indice--) {
      if (
        eventos[indice].tipo === 'peca_sorteada' ||
        eventos[indice].tipo === 'recebimento_gerado'
      ) {
        eventos.splice(indice, 1);
      }
    }
  }
  // B3/review #333: a adoção da seleção só existe quando a Confirmação gera
  // Recebimento — em Baixa Iluminação (sorteio [], ADR-0005) a seleção não
  // nasce sem sequência (invariante "a seleção vive durante a sequência").
  // Guarda da #264 já rejeitou outro Peão; a rejeição abaixo é a rede de
  // proteção do dispatch.
  const selecaoVigente = estado.tabuleiro.peaoSelecionadoId;
  if (selecaoVigente !== null && selecaoVigente !== peao.peaoId) {
    // Rede de proteção (B1/review #333): o guard da #264 acima já rejeitou
    // outro Peão — esta rejeição defensiva preserva o contrato do dispatch
    // (aplicarComandoDePartida nunca lança) mesmo sob estado artesanal.
    return rejeitarDaPartida(
      'PEAO_NAO_SELECIONADO',
      'Invariante da Confirmação: outro Peão está selecionado.',
    );
  }
  const tabuleiroPosAtaque: EstadoDoTabuleiro = {
    ...tabuleiroPosLimpeza,
    caixa: baixaNovaDoAtor ? estado.tabuleiro.caixa : tabuleiroPosLimpeza.caixa,
    recebidas: recebidasFinais,
    posicionadas: posicionadasPosAtaque,
  };
  const tabuleiroFinal: EstadoDoTabuleiro = {
    ...tabuleiroPosAtaque,
    peaoSelecionadoId:
      recebidasFinais.length > 0 ? (selecaoVigente ?? peao.peaoId) : selecaoVigente,
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
  // Proteção do ator no fim do gatilho completo (issue #227): true quando a
  // Sala Médica acabou de conceder (sobrevive ao ataque do MESMO gatilho) ou
  // quando uma Proteção prévia não foi consumida; false quando não havia
  // Proteção ou ela foi consumida pelo ataque do próprio gatilho. `?? false`
  // no padrão defensivo de estados persistidos sem o campo.
  const atorFinal = jogadores.find(
    (jogador) => jogador.jogadorId === ator.jogadorId,
  );
  const protegidoFinal = atorFinal?.protegido ?? false;
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
      pecasEmPeriodoDeGraca: estado.pecasEmPeriodoDeGraca ?? [],
    },
    // O posicao_confirmada abre o lote (ordem canônica da Confirmação
    // preservada) já com o protegido RESULTANTE (issue #227).
    [
      {
        tipo: 'posicao_confirmada',
        jogadorId: ator.jogadorId,
        peaoId: peao.peaoId,
        pecaId: peca.pecaId,
        protegido: protegidoFinal,
      },
      ...eventos,
    ],
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

// Desistência (issue #289): ato irreversível do próprio Jogador em Partida em
// andamento — remove o peão (libera a célula), exclui a vez do roster,
// recalcula a Iluminação com os restantes e aplica a Limpeza no ato
// (recalcularIluminacaoEAplicarLimpeza com o roster pós-remoção; conquistas
// não revogadas). Sem Ataque (sem gatilho de decisão) e sem Resgate.
// Se o desistente era o Jogador Ativo, a Passagem de Vez é imediata,
// ancorada no índice removido (o seguinte na ordem assume, com salto de
// amedrontados e incremento de rodada no wrap, na semântica de avancarVez);
// se não era, vez/rodada/pendências do Ativo vigente são preservadas.
// O término (vitória em N−1, derrota no quórum de 1) sai pelo funil do
// dispatch, via avaliarTerminoDaPartida.
function desistirDaPartida(
  estado: EstadoDaPartida,
  ator: string,
): ResultadoDaPartida {
  const desistente = estado.jogadores.find(
    (jogador) => jogador.jogadorId === ator,
  );
  if (!desistente) {
    return rejeitarDaPartida(
      'JOGADOR_NAO_NA_PARTIDA',
      'Apenas um Jogador da Partida pode desistir dela.',
    );
  }
  const eraAtivo = ator === estado.jogadorAtivoId;

  const jogadores = estado.jogadores.filter(
    (jogador) => jogador.jogadorId !== ator,
  );
  const peoes = estado.tabuleiro.peoes.filter(
    (peao) => peao.peaoId !== desistente.peaoId,
  );

  // Seleção/manipulação/recebidas: pertencem à sequência do Ativo. Com o
  // turno abortado (desistente Ativo), caem — a Passagem abaixo também as
  // limpa; fora do turno, são do Ativo vigente e ficam intactas. A Seleção
  // do peão órfã do desistente cai em ambos os ramos (defensivo: o guard
  // exigirPeaoDoAtor impede esse estado pela via normal).
  const tabuleiroBase: EstadoDoTabuleiro = eraAtivo
    ? {
        ...estado.tabuleiro,
        peoes,
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        recebidas: [],
      }
    : {
        ...estado.tabuleiro,
        peoes,
        peaoSelecionadoId:
          estado.tabuleiro.peaoSelecionadoId === desistente.peaoId
            ? null
            : estado.tabuleiro.peaoSelecionadoId,
      };

  const estadoParaIluminacao: EstadoDaPartida = { ...estado, jogadores };
  const eventos: EventoDaPartida[] = [
    {
      tipo: 'desistencia_registrada',
      jogadorId: ator,
      peaoId: desistente.peaoId,
    },
  ];
  const iluminacao = recalcularIluminacaoEAplicarLimpeza(
    estadoParaIluminacao,
    tabuleiroBase,
    eventos,
  );
  const tabuleiroPosLimpeza: EstadoDoTabuleiro = {
    ...tabuleiroBase,
    posicionadas: iluminacao.posicionadas,
  };

  // Poda do snapshot do Alcance: entradas de Monstros removidos pela Limpeza
  // caem; nas demais, o peão do desistente é filtrado.
  const posicionadasIds = new Set(
    tabuleiroPosLimpeza.posicionadas.map((peca) => peca.pecaId),
  );
  const peoesNoAlcance: Record<string, readonly string[]> = {};
  for (const [pecaId, peaoIds] of Object.entries(estado.peoesNoAlcance)) {
    if (!posicionadasIds.has(pecaId)) {
      continue;
    }
    peoesNoAlcance[pecaId] = peaoIds.filter(
      (peaoId) => peaoId !== desistente.peaoId,
    );
  }

  // Poda stale da graça (mesmo padrão do mover): peças removidas pela
  // Limpeza não retêm ID órfão; a lista em si é preservada.
  const pecasEmPeriodoDeGraca = (estado.pecasEmPeriodoDeGraca ?? []).filter(
    (pecaId) => posicionadasIds.has(pecaId),
  );

  if (!eraAtivo) {
    return sucessoDaPartida(
      {
        ...estado,
        tabuleiro: tabuleiroPosLimpeza,
        jogadores,
        celulasIluminadas: iluminacao.celulasIluminadas,
        peoesNoAlcance,
        pecasEmPeriodoDeGraca,
      },
      eventos,
    );
  }

  // Passagem imediata ancorada no índice removido: o seguinte na ordem de
  // entrada assume. O índice inicial é o do removido módulo o tamanho
  // pós-remoção (os posteriores deslocam uma posição); a rodada incrementa
  // quando o removido era o último (o seguinte abre nova rodada).
  const ordenadosPre = [...estado.jogadores].sort(
    (primeiro, segundo) => primeiro.ordem - segundo.ordem,
  );
  const ordenados = [...jogadores].sort(
    (primeiro, segundo) => primeiro.ordem - segundo.ordem,
  );
  const indiceRemovido = ordenadosPre.findIndex(
    (jogador) => jogador.jogadorId === ator,
  );
  let indiceProximo = indiceRemovido % ordenados.length;
  let rodadaAlvo =
    indiceRemovido === ordenadosPre.length - 1
      ? estado.rodada + 1
      : estado.rodada;

  // Salto silencioso de amedrontados (semântica de avancarVez): sem emitir
  // turno para eles; cada wrap à origem incrementa a rodada.
  let alvo: (typeof ordenados)[number] | null = null;
  let tentativas = 0;
  while (tentativas < ordenados.length) {
    const candidato = ordenados[indiceProximo];
    const jogadorObj = jogadores.find(
      (item) => item.jogadorId === candidato.jogadorId,
    );
    const ehAmedrontado =
      jogadorObj !== undefined &&
      (jogadorObj.amedrontado ?? jogadorObj.sanidade === 0) === true;
    if (!ehAmedrontado) {
      alvo = candidato;
      break;
    }
    indiceProximo = (indiceProximo + 1) % ordenados.length;
    rodadaAlvo = indiceProximo === 0 ? rodadaAlvo + 1 : rodadaAlvo;
    tentativas++;
  }

  const turnoEncerrado: EventoDaPartida = {
    tipo: 'turno_encerrado',
    jogadorId: ator,
  };
  // Fechamento da Manipulação em aberto (efeito da Passagem, sem duplicar).
  const pecaEmManipulacaoId = estado.tabuleiro.pecaEmManipulacaoId;
  const fechamentoDaManipulacao: readonly EventoDaPartida[] =
    pecaEmManipulacaoId !== null
      ? [{ tipo: 'manipulacao_finalizada', pecaId: pecaEmManipulacaoId }]
      : [];

  // Todos amedrontados: sem novo turno (espelha avancarVez) — o funil do
  // dispatch decide a derrota.
  if (alvo === null) {
    const peaoDoPrimeiro = tabuleiroPosLimpeza.peoes.find(
      (item) => item.peaoId === ordenados[0].peaoId,
    );
    return sucessoDaPartida(
      {
        ...estado,
        tabuleiro: tabuleiroPosLimpeza,
        jogadores,
        jogadorAtivoId: ordenados[0].jogadorId,
        rodada: estado.rodada,
        pecaDoInicioDoTurnoId: peaoDoPrimeiro?.pecaId ?? null,
        posicaoConfirmada: false,
        atravessouNoTurno: false,
        celulasIluminadas: iluminacao.celulasIluminadas,
        peoesNoAlcance,
        pecasEmPeriodoDeGraca,
      },
      [...eventos, turnoEncerrado, ...fechamentoDaManipulacao],
    );
  }

  const peaoDoAlvo = tabuleiroPosLimpeza.peoes.find(
    (item) => item.peaoId === alvo.peaoId,
  );
  return sucessoDaPartida(
    {
      ...estado,
      tabuleiro: tabuleiroPosLimpeza,
      jogadores,
      jogadorAtivoId: alvo.jogadorId,
      rodada: rodadaAlvo,
      pecaDoInicioDoTurnoId: peaoDoAlvo?.pecaId ?? null,
      posicaoConfirmada: false,
      atravessouNoTurno: false,
      celulasIluminadas: iluminacao.celulasIluminadas,
      peoesNoAlcance,
      pecasEmPeriodoDeGraca,
    },
    [
      ...eventos,
      turnoEncerrado,
      ...fechamentoDaManipulacao,
      { tipo: 'turno_iniciado', jogadorId: alvo.jogadorId, rodada: rodadaAlvo },
    ],
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
      atravessouNoTurno: false,
      celulasIluminadas: estado.celulasIluminadas,
      resultado: estado.resultado,
      geradoresLigados: estado.geradoresLigados,
      cartaoDeAcessoObtido: estado.cartaoDeAcessoObtido,
      peoesNoAlcance: estado.peoesNoAlcance,
      pecasEmPeriodoDeGraca: estado.pecasEmPeriodoDeGraca ?? [],
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
  // ADR-0013 / issue #354: Puxar no início do turno em Baixa — se o próximo
  // jogador está em Baixa e há vaga escura disponível, sorteia 1 peça para a
  // Bandeja já no turno_iniciado. Sem vaga escura ou caixa vazia → 0 (sem
  // pendência irresolúvel, regra do relator: "quando não tem célula disponível,
  // não puxa"). Primeiro turno pendente (peão sobre a Mesa) não puxa.
  // Iluminação fresca para filtro escuro (não o snapshot stale do turno anterior).
  let tabuleiroDoNovoTurno: EstadoDoTabuleiro = tabuleiroLimpo;
  let eventosDoSorteioInicial: readonly EventoDaPartida[] = [];
  const alvoEmBaixa = alvo !== null ? (alvo.emBaixaIluminacao ?? false) : false;
  if (alvo !== null && alvoEmBaixa && peaoDoAlvo?.pecaId !== null && peaoDoAlvo?.pecaId !== undefined) {
    const pecaSobPeaoDoAlvo = tabuleiroLimpo.posicionadas.find(
      (p) => p.pecaId === peaoDoAlvo.pecaId,
    );
    if (pecaSobPeaoDoAlvo) {
      const celulasParaFiltroAvanco = calcularIluminacao(
        tabuleiroLimpo,
        estado.jogadores
          .filter((j) => (j.emBaixaIluminacao ?? false))
          .map((j) => j.peaoId),
      );
      const sorteioInicial = gerarRecebidas(
        tabuleiroLimpo,
        pecaSobPeaoDoAlvo,
        true,
        celulasParaFiltroAvanco,
      );
      if (sorteioInicial.recebidas.length > 0) {
        tabuleiroDoNovoTurno = {
          ...sorteioInicial.estado,
          recebidas: sorteioInicial.recebidas,
          // Mantém seleção nula no início; o gesto Puxar na Bandeja habilita a
          // escolha de vaga, sem auto-selecionar aqui (evita travar PERMANECER).
          peaoSelecionadoId: null,
        };
        eventosDoSorteioInicial = [
          ...sorteioInicial.eventos,
          { tipo: 'recebimento_gerado', recebidas: projetarRecebidas(sorteioInicial.recebidas) },
        ];
      } else {
        // Sem vaga escura ou caixa vazia → 0, mantém tabuleiroLimpo sem recebidas
        tabuleiroDoNovoTurno = sorteioInicial.estado;
      }
    }
  }
  const novoEstado: EstadoDaPartida = {
    tabuleiro: tabuleiroDoNovoTurno,
    jogadores: estado.jogadores,
    jogadorAtivoId: alvo.jogadorId,
    rodada: rodadaAlvo,
    pecaDoInicioDoTurnoId: peaoDoAlvo?.pecaId ?? null,
    posicaoConfirmada: false,
    atravessouNoTurno: false,
    celulasIluminadas: estado.celulasIluminadas,
    resultado: estado.resultado,
    geradoresLigados: estado.geradoresLigados,
    cartaoDeAcessoObtido: estado.cartaoDeAcessoObtido,
    peoesNoAlcance: estado.peoesNoAlcance,
    pecasEmPeriodoDeGraca: estado.pecasEmPeriodoDeGraca ?? [],
  };
  // Ordem do lote: turno_iniciado vem antes do sorteio inicial para que o
  // redutor do cliente (TURNO_INICIADO limpa pendências) não apague a
  // recebida de Baixa recém-gerada — o RECEBIMENTO_GERADO repopula depois.
  const eventosFinais: readonly EventoDaPartida[] = [
    ...eventos,
    ...fechamentoDaManipulacao,
    { tipo: 'turno_iniciado', jogadorId: alvo.jogadorId, rodada: rodadaAlvo },
    ...eventosDoSorteioInicial,
  ];
  return sucessoDaPartida(novoEstado, eventosFinais);
}

// Pré-adoção da Seleção (mesmo padrão da Travessia do Escuro — AC-3 do #272):
// com Recebidas pendentes e Seleção nula (estados persistidos do pré-deploy
// da #326), a sequência (escolher vaga → encaixar) segue o Peão do ator — o
// comando cura o softlock sem migração de dados e o Tabuleiro permanece puro
// (guarda da seleção intacta em peoes.ts).
function adotarSelecaoDoAtor(
  estado: EstadoDaPartida,
  ator: JogadorDaPartida,
): EstadoDaPartida {
  if (estado.tabuleiro.peaoSelecionadoId !== null) return estado;
  if (estado.tabuleiro.recebidas.length === 0) return estado;
  return {
    ...estado,
    tabuleiro: { ...estado.tabuleiro, peaoSelecionadoId: ator.peaoId },
  };
}

// Giro de Recebida com Seleção nula (M2/review #333): a mesma pré-adoção do
// ator de escolher vaga/encaixar — a sequência (escolher → girar → encaixar)
// cura o stale em qualquer passo, sem depender da ordem. O giro em si não
// consulta a Seleção (girarPeca roteia por peça selecionada/Manipulação); a
// pré-adoção persiste a cura antecipada e mantém a sequência do Peão do ator.
function girarPecaDaPartida(
  estado: EstadoDaPartida,
  comando: GirarPecaComando,
  ator: JogadorDaPartida,
): ResultadoDaPartida {
  const ehRecebida = estado.tabuleiro.recebidas.some(
    (item) => item.pecaId === comando.pecaId,
  );
  if (ehRecebida) {
    estado = adotarSelecaoDoAtor(estado, ator);
  }
  return delegarAoTabuleiro(estado, comando);
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
// recebidaId, a peça sorteada (pecaId + tipoDaPeca + orientacao) e a vaga
// (com a célula-alvo derivada dela), nulas até a escolha. A orientação é
// obrigatória: o espelho do bot calcula o giro pré-encaixe a partir dela.
function projetarRecebidas(recebidas: readonly PecaRecebida[]) {
  return recebidas.map(
    ({ recebidaId, pecaId, tipo, orientacao, vaga, celulaAlvo }) => ({
      recebidaId,
      pecaId,
      tipoDaPeca: tipo,
      orientacao,
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

// Ordem de avaliação (issue #176, quórum pela #289): o quórum mínimo (um
// Jogador restante após desistências) precede a vitória — N=2→1 termina em
// derrota mesmo com os objetivos completos; depois, a vitória é avaliada
// ANTES das demais derrotas — quando vitória e derrota são verdadeiras no
// mesmo evento, prevalece a vitória. Entre os motivos de derrota simultâneos,
// equipe_amedrontada precede caixa_esgotada (desempate do mesmo evento).
function desfechoDaPartida(estado: EstadoDaPartida): DesfechoDaPartida | null {
  if (estado.jogadores.length <= 1) {
    return { tipo: 'derrota', motivo: 'desistencia' };
  }
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

// Vitória (issue #176, roster variável N = 2–4 pela #285): 3 geradores
// ligados, cartão obtido e TODOS os N peões sobre a MESMA peça posicionada do
// tipo portao_de_saida (mesmo pecaId não nulo). Sobre os peões vale apenas a
// posição — estados dos jogadores (ex.: sanidade 0) não os impedem de vencer.
function equipeVenceu(estado: EstadoDaPartida): boolean {
  if (estado.geradoresLigados.length < 3 || !estado.cartaoDeAcessoObtido) {
    return false;
  }
  const totalDePeoes = estado.jogadores.length;
  const peoes = estado.tabuleiro.peoes;
  const referencia = peoes[0];
  if (
    peoes.length !== totalDePeoes ||
    !referencia ||
    referencia.pecaId === null
  ) {
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
 * Resolução do Ataque no gatilho (issues #172/#170/#173, centrado no atuante
 * pela #237 — fiação na Partida pela #236) — sempre sobre o tabuleiro
 * PÓS-Limpeza: Monstro removido não ataca e tem a entrada podada do snapshot.
 * A avaliação é POR MONSTRO sobre a Peça do início do turno (antes) e a Peça
 * decidida do peão do atuante (depois): fora→fora é silêncio e só os
 * Monstros envolvidos atacam — o snapshot peoesNoAlcance de binários
 * anteriores não é mais insumo da decisão (o legado delta-based permanece
 * @deprecated em monstros.ts). ST-15 / issue #170 aplica as penalidades APÓS
 * o consumo da Proteção: Vulto → emBaixaIluminacao (idempotente), Espectro →
 * sanidade-1 com piso 0 → amedrontado; jogador já amedrontado é imune a novo
 * Espectro; protegido nega a penalidade do MESMO gatilho.
 * Issue #173: o evento ataque_resolvido sai do gatilho com `estadosAplicados`
 * — o estado RESULTANTE de cada Jogador cujo roster mudou com as penalidades
 * (imune e protegido não mudam, logo não aparecem; ataque sem alvos ⇒ []).
 * @mutates eventos — adiciona `ataque_resolvido` quando ao menos um Monstro
 * dispara (mesmo que ninguém seja atingido).
 */
function resolverAtaqueNoGatilho(
  estado: EstadoDaPartida,
  tabuleiro: EstadoDoTabuleiro,
  eventos: EventoDaPartida[],
  pecaDoInicioId: string | null,
  pecaDecididaId: string,
): {
  peoesNoAlcance: Readonly<Record<string, readonly string[]>>;
  jogadores: readonly JogadorDaPartida[];
} {
  const resolucao = resolverAtaquesCentradoNoAtuante(
    tabuleiro,
    pecaDoInicioId,
    pecaDecididaId,
    estado.jogadores.map((jogador) => ({
      jogadorId: jogador.jogadorId,
      peaoId: jogador.peaoId,
      // ?? false: estados de binários anteriores persistidos em Redis sem o
      // campo (mesmo padrão de resultado ?? null).
      protegido: jogador.protegido ?? false,
    })),
  );
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
  // ambas as penalidades no mesmo gatilho. Issue #173: cada jogador cujo
  // estado MUDOU acumula a entrada com o estado RESULTANTE — o consumo da
  // Proteção não entra (vive em `protegidos` do evento).
  let estadosAplicados: readonly EstadoResultanteDoAtaque[] = [];
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
      const acumulados: EstadoResultanteDoAtaque[] = [];
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
        }
        if (hitEspectro) {
          if (jaAmedrontado) {
            // Imune: novo Espectro não tem efeito adicional (piso já 0).
          } else {
            novaSanidade = Math.max(0, jogador.sanidade - 1);
            if (novaSanidade === 0 && !jaAmedrontado) {
              novoAmedrontado = true;
            }
          }
        }
        if (
          novoEmBaixa !== jaEmBaixa ||
          novaSanidade !== jogador.sanidade ||
          novoAmedrontado !== jaAmedrontado
        ) {
          // Estado RESULTANTE do jogador (#173): o wire carrega o novo valor,
          // não a delta — o cliente projeta direto no snapshot.
          acumulados.push({
            jogadorId: jogador.jogadorId,
            emBaixaIluminacao: novoEmBaixa,
            sanidade: novaSanidade,
            amedrontado: novoAmedrontado,
          });
          return {
            ...jogador,
            emBaixaIluminacao: novoEmBaixa,
            sanidade: novaSanidade,
            amedrontado: novoAmedrontado,
          };
        }
        return jogador;
      });
      if (acumulados.length > 0) {
        jogadores = proximoJogadores;
        estadosAplicados = acumulados;
      }
    }
    // Eco no wire (issue #173): o evento carrega os dados E o estado
    // resultante das penalidades — vazio quando ninguém mudou (imune,
    // protegido ou saída sem alvos).
    eventos.push({ ...resolucao.evento, estadosAplicados });
  }

  // Normalização retrocompatível para estados persistidos sem os campos novos.
  jogadores = jogadores.map((jogador) => ({
    ...jogador,
    emBaixaIluminacao: jogador.emBaixaIluminacao ?? false,
    amedrontado: jogador.amedrontado ?? jogador.sanidade === 0,
  }));

  return { peoesNoAlcance: resolucao.peoesNoAlcance, jogadores };
}

// Resgate (issue #171): helpers de ocupação — extraídos para DRY entre guarda
// pré-delegação e fallback manual.
function temAfetadoNaPeca(pecaId: string, estado: EstadoDaPartida): boolean {
  return estado.jogadores.some((jogador) => {
    const peao = estado.tabuleiro.peoes.find((item) => item.peaoId === jogador.peaoId);
    return (
      peao?.pecaId === pecaId &&
      ((jogador.emBaixaIluminacao ?? false) || (jogador.amedrontado ?? jogador.sanidade === 0))
    );
  });
}

function tetoOcupacao(peca: PecaPosicionada, estado: EstadoDaPartida): number {
  // O Portão de Saída escala com o roster (issue #285) via a fonte única
  // tetoDoPortao (peoes.ts): teto = N peões, com o +1 da exceção de Resgate
  // já existente; as demais peças seguem no máximo 1 (+1 com afetado). O
  // rosterN é o tamanho do roster (estado.jogadores.length), com o clamp
  // min(N,4) preservado para estados artesanais.
  if (peca.tipo !== 'portao_de_saida') {
    return temAfetadoNaPeca(peca.pecaId, estado) ? 2 : 1;
  }
  return tetoDoPortao(
    estado.jogadores.length,
    temAfetadoNaPeca(peca.pecaId, estado),
  );
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
