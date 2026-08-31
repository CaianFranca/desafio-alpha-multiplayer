/**
 * Redutor puro evento→estado do Tabuleiro no cliente (issue #85).
 *
 * O game-server não reenvia o histórico de posicionamentos a quem conecta
 * depois (as 4 conexões partem juntas do `PARTIDA_DISPONIVEL`). Assim o
 * cliente parte do estado inicial determinístico — `criarReservaInicial()`
 * (mesma composição e ids de `estadoInicialDoTabuleiro()` do engine) e
 * `posicionadas: []` — e aplica cada evento do broadcast em ordem ao modelo
 * local (deltas aditivos).
 *
 * Semântica alinhada ao engine (`packages/engine/src/tabuleiro.ts`):
 *   - PECA_POSICIONADA não traz `tipo` no wire → preserva o `tipo` da Reserva
 *     ao consumir a peça (ver `traducao.ts` do game-server).
 *   - Novo posicionamento abre a janela de Manipulação (`pecaEmManipulacaoId`)
 *     e limpa a Seleção.
 *   - Nova Seleção com Manipulação em aberto emite [manipulacao_finalizada,
 *     peca_selecionada] em ordem — o broadcast preserva a ordem; a aplicação
 *     sequencial aqui reproduz esse encadeamento.
 *   - ERRO_DO_TABULEIRO chega só ao autor e não altera o estado do cliente
 *     (o flash vermelho é gerenciado pela camada de feedback, não pelo reducer).
 *
 * Ciclo do Peão (issue #91 — espelho do engine):
 *   - Peões nascem seedados (`peao-${cor}`, sobre a Mesa) e o servidor move.
 *   - Pendência de Recebimento carrega campo client-side `pecaId` (null até o
 *     TIPO) e só sai da lista no PECA_POSICIONADA (encaixe na célula-alvo).
 *   - TIPO consome a peça da Reserva (peoes.ts:367 do engine) e seleciona a
 *     Recebida (pecaSelecionadaId) até o encaixe.
 *   - PEAO_POSICIONADO re-seleciona o peão (Primeiro Turno, partida.ts:344);
 *     PEAO_MOVIDO/PEAO_PERMANECEU limpam a seleção (mover/permanecer).
 *
 * Turnos (issue #118 — espelho do ST-11):
 *   - TURNO_INICIADO seta jogadorAtivoId/rodada e reseta a fase do turno;
 *     TURNO_ENCERRADO limpa a vez (limpeza mínima; rodada e mapa preservados).
 *   - PEAO_MOVIDO dentro do turno marca movimentouNoTurno; POSICAO_CONFIRMADA
 *     marca posicaoConfirmadaNoTurno (a Permanência encerra a vez no servidor —
 *     o próximo TURNO_INICIADO governa a fase seguinte).
 *   - PEAO_POSICIONADO/PEAO_MOVIDO/PEAO_PERMANECEU atribuem o peão do evento
 *     ao Jogador Ativo no mapa peaoPorJogador (janela do turno, ver campo).
 */

import {
  CORES_DOS_PEOES,
  chaveCelula,
  criarReservaInicial,
  type EstadoExibicaoTabuleiro,
  type Orientacao,
  type PecaDaReserva,
  type PecaPosicionada,
  type PeaoDaExibicao,
  type TipoDaPeca,
} from './contrato'
import type { PendenciaNoCliente } from './interacaoPeoes'
import type {
  TabuleiroEventoDoServidor,
  PeaoEventoDoServidor,
  PosicaoConfirmadaEvento,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

/** Eventos que o canal da Partida entrega ao redutor (tabuleiro, peões, turnos). */
export type EventoDoJogoNoCliente =
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento

/** Estado do modelo de tabuleiro mantido no cliente. */
export interface EstadoDoTabuleiroNoCliente {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
  /** Peões com posição autoritativa do servidor (issue #91). */
  readonly peoes: readonly PeaoDaExibicao[]
  /** Recebidas aguardando escolha de tipo e encaixe (com pecaId client-side). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  /** Peão selecionado no ciclo (vem do servidor via PEAO_SELECIONADO). */
  readonly peaoSelecionadoId: string | null
  /** Peças cujo tipo foi definido por ESCOLHER_TIPO_DA_PECA_RECEBIDA (chave = pecaId). */
  readonly pecasDeRecebimento: Record<string, TipoDaPeca>
  /** Jogador Ativo da vez (TURNO_INICIADO; null entre turnos). */
  readonly jogadorAtivoId: string | null
  /** Rodada corrente (TURNO_INICIADO; rodada 1 = Primeiro Turno de todos). */
  readonly rodada: number | null
  /** O peão do Jogador Ativo já se moveu neste turno (PEAO_MOVIDO). */
  readonly movimentouNoTurno: boolean
  /** A posição do peão do Jogador Ativo já foi confirmada (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
  /**
   * Mapa aprendido jogadorId→peaoId (issue #118): cada evento de peão dentro
   * da janela do turno (TURNO_INICIADO→TURNO_ENCERRADO) atribui o peão ao
   * Jogador Ativo — turnos são serializados, então o dono é o ativo. Sem
   * eventos ainda (início da rodada 1), a consulta fica indefinida e o
   * destaque/buttons degradam a null (substituído pelo snapshot #154/#156).
   */
  readonly peaoPorJogador: Readonly<Record<string, string>>
}

/** Estado inicial determinístico do cliente (deltas a partir do zero). */
export function criarEstadoInicialDoCliente(): EstadoDoTabuleiroNoCliente {
  return {
    reserva: criarReservaInicial(),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    // Seed dos peões (issue #91): ids determinísticos por cor, espelhando o
    // engine (`peaoId: peao-${cor}`, `pecaId: null` na origem); os 4 nascem
    // sobre a Mesa (celula: null) e o servidor confirma cada movimento.
    peoes: CORES_DOS_PEOES.map((cor) => ({
      peaoId: `peao-${cor}`,
      cor,
      celula: null,
    })),
    recebidasPendentes: [],
    peaoSelecionadoId: null,
    pecasDeRecebimento: {},
    // Turnos (issue #118): sem vez nem rodada até o primeiro TURNO_INICIADO.
    jogadorAtivoId: null,
    rodada: null,
    movimentouNoTurno: false,
    posicaoConfirmadaNoTurno: false,
    peaoPorJogador: {},
  }
}

function girarNaReserva(
  estado: EstadoDoTabuleiroNoCliente,
  pecaId: string,
  orientacao: Orientacao,
): EstadoDoTabuleiroNoCliente {
  return {
    ...estado,
    reserva: estado.reserva.map((p) =>
      p.pecaId === pecaId ? { ...p, orientacao } : p,
    ),
  }
}

function girarPosicionada(
  estado: EstadoDoTabuleiroNoCliente,
  pecaId: string,
  orientacao: Orientacao,
): EstadoDoTabuleiroNoCliente {
  return {
    ...estado,
    posicionadas: estado.posicionadas.map((p) =>
      p.pecaId === pecaId ? { ...p, orientacao } : p,
    ),
  }
}

/**
 * Atribui o peão do evento ao Jogador Ativo no mapa aprendido (issue #118):
 * turnos são serializados, então os eventos de peão dentro da janela
 * TURNO_INICIADO→TURNO_ENCERRADO pertencem ao jogador da vez. Sem vez ativa
 * (ex.: eventos anteriores ao primeiro TURNO_INICIADO), o mapa fica intacto.
 */
function aprenderPeaoDoAtivo(
  estado: EstadoDoTabuleiroNoCliente,
  peaoId: string,
): Readonly<Record<string, string>> {
  if (estado.jogadorAtivoId === null) return estado.peaoPorJogador
  return { ...estado.peaoPorJogador, [estado.jogadorAtivoId]: peaoId }
}

/**
 * Aplica um evento do servidor ao estado do cliente, produzindo um novo
 * estado imutável. Eventos desconhecidos ou erro retornam o estado inalterado.
 *
 * Aceita eventos de tabuleiro (ST-09), de peões/ciclo (ST-10) e de turno
 * (ST-11).
 */
export function reduzirEvento(
  estado: EstadoDoTabuleiroNoCliente,
  evento: EventoDoJogoNoCliente,
): EstadoDoTabuleiroNoCliente {
  switch (evento.type) {
    // ── Eventos de Tabuleiro (ST-09) ──
    case 'PECA_SELECIONADA':
      return { ...estado, pecaSelecionadaId: evento.pecaId }
    case 'PECA_DESELECIONADA':
      return estado.pecaSelecionadaId === evento.pecaId
        ? { ...estado, pecaSelecionadaId: null }
        : estado
    case 'PECA_GIRADA': {
      // Gira na posicionada se a peça estiver posicionada (janela de
      // Manipulação), senão na Reserva (seleção ativa).
      const posicionada = estado.posicionadas.some(
        (p) => p.pecaId === evento.pecaId,
      )
      return posicionada
        ? girarPosicionada(estado, evento.pecaId, evento.orientacao)
        : girarNaReserva(estado, evento.pecaId, evento.orientacao)
    }
    case 'PECA_POSICIONADA': {
      // PECA_POSICIONADA não traz `tipo`; preserva o da Reserva ou do
      // recebimento (peças recebidas vêm de fora da Reserva).
      const pecaNaReserva = estado.reserva.find(
        (p) => p.pecaId === evento.pecaId,
      )
      const tipo = pecaNaReserva?.tipo
        ?? estado.pecasDeRecebimento[evento.pecaId]
      if (tipo === undefined) return estado
      const posicionada: PecaPosicionada = {
        pecaId: evento.pecaId,
        tipo,
        orientacao: evento.orientacao,
        celula: evento.celula,
      }
      return {
        ...estado,
        reserva: pecaNaReserva
          ? estado.reserva.filter((p) => p.pecaId !== evento.pecaId)
          : estado.reserva,
        posicionadas: [...estado.posicionadas, posicionada],
        // Encaixe abre a janela de Manipulação e limpa a Seleção.
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: evento.pecaId,
        // Encaixe na célula-alvo resolve a pendência correspondente (issue
        // #91: a pendência só sai da lista quando a peça é POSICIONADA).
        // Forma nova (#138): sem vaga escolhida, celulaAlvo é null — nunca
        // coincide com o encaixe.
        recebidasPendentes: estado.recebidasPendentes.filter(
          (r) =>
            r.celulaAlvo === null ||
            chaveCelula(r.celulaAlvo) !== chaveCelula(evento.celula),
        ),
      }
    }
    case 'MANIPULACAO_FINALIZADA':
      return estado.pecaEmManipulacaoId === evento.pecaId
        ? { ...estado, pecaEmManipulacaoId: null }
        : estado
    case 'ERRO_DO_TABULEIRO':
      // Rejeição não altera o modelo local (flash é da camada de feedback).
      return estado

    // ── Eventos de Peão / Ciclo (ST-10) ──
    case 'PEAO_SELECIONADO':
      return { ...estado, peaoSelecionadoId: evento.peaoId }
    case 'RECEBIMENTO_GERADO':
      // Pendências do wire ganham o campo client-side `pecaId`: null até o
      // TIPO_DA_PECA_RECEBIDA_ESCOLHIDO preencher na forma LEGADA (ST-10);
      // na forma NOVA (#138) o wire já traz o pecaId da peça sorteada —
      // preservado (a vaga/célula-alvo pode ainda ser null).
      return {
        ...estado,
        recebidasPendentes: evento.recebidas.map((r) => ({
          ...r,
          pecaId: 'pecaId' in r ? r.pecaId : null,
        })),
      }
    case 'PEAO_POSICIONADO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      // Primeiro Turno: o engine re-seleciona o peão no `posicionar_peao`
      // (partida.ts) — o cliente espelha a seleção explicitamente.
      // A janela do turno atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peoes,
        peaoSelecionadoId: evento.peaoId,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }
    }
    case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO': {
      // Espelha o engine (peoes.ts:367): a peça escolhida é CONSUMIDA da
      // Reserva. A pendência PERMANECE na lista (agora tipada, com pecaId)
      // até o encaixe (PECA_POSICIONADA). A seleção passa para a Recebida.
      return {
        ...estado,
        reserva: estado.reserva.filter((p) => p.pecaId !== evento.pecaId),
        pecasDeRecebimento: {
          ...estado.pecasDeRecebimento,
          [evento.pecaId]: evento.tipoDaPeca,
        },
        pecaSelecionadaId: evento.pecaId,
        recebidasPendentes: estado.recebidasPendentes.map((r) =>
          r.recebidaId === evento.recebidaId ? { ...r, pecaId: evento.pecaId } : r,
        ),
      }
    }
    case 'PEAO_MOVIDO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      // mover_peao no engine limpa o peaoSelecionadoId — o cliente espelha
      // para não manter seleção fantasma. Dentro do turno, o movimento marca
      // a fase e atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peoes,
        peaoSelecionadoId: null,
        movimentouNoTurno:
          estado.jogadorAtivoId !== null ? true : estado.movimentouNoTurno,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }
    }
    case 'PEAO_PERMANECEU':
      // permanecer no engine limpa o peaoSelecionadoId (não altera posição);
      // a janela do turno atribui o peão ao Jogador Ativo (issue #118).
      return {
        ...estado,
        peaoSelecionadoId: null,
        peaoPorJogador: aprenderPeaoDoAtivo(estado, evento.peaoId),
      }

    // ── Eventos de Turno (ST-11, issue #118) ──
    case 'TURNO_INICIADO':
      // Novo turno: seta a vez e a rodada, reseta a fase (movimentou/confirmado).
      return {
        ...estado,
        jogadorAtivoId: evento.jogadorId,
        rodada: evento.rodada,
        movimentouNoTurno: false,
        posicaoConfirmadaNoTurno: false,
      }
    case 'TURNO_ENCERRADO':
      // Limpeza mínima: a vez cai até o próximo TURNO_INICIADO; a rodada e o
      // mapa aprendido jogadorId→peaoId preservam o contexto entre turnos.
      return {
        ...estado,
        jogadorAtivoId: null,
        movimentouNoTurno: false,
        posicaoConfirmadaNoTurno: false,
      }
    case 'POSICAO_CONFIRMADA':
      // A Confirmação de Posição trava o peão do Jogador Ativo neste turno.
      return { ...estado, posicaoConfirmadaNoTurno: true }

    default: {
      // Exaustividade: novo evento wire sem case falha em compilação.
      const _exaustivo: never = evento
      return _exaustivo
    }
  }
}

/**
 * Aplica um lote de eventos em ordem ao estado (o broadcast do game-server
 * preserva a ordem, ex.: [manipulacao_finalizada, peca_selecionada]).
 */
export function reduzirEventos(
  estado: EstadoDoTabuleiroNoCliente,
  eventos: readonly EventoDoJogoNoCliente[],
): EstadoDoTabuleiroNoCliente {
  return eventos.reduce(reduzirEvento, estado)
}

/** Deriva o estado de exibição consumido pela cena a partir do modelo. */
export function estadoDeExibicaoDoModelo(
  estado: EstadoDoTabuleiroNoCliente,
): EstadoExibicaoTabuleiro {
  return { reserva: estado.reserva, posicionadas: estado.posicionadas, peoes: estado.peoes }
}
