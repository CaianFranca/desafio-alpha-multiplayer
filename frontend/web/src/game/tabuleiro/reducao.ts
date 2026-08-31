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
} from '@flicker/shared'

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
 * Aplica um evento do servidor ao estado do cliente, produzindo um novo
 * estado imutável. Eventos desconhecidos ou erro retornam o estado inalterado.
 *
 * Aceita eventos de tabuleiro (ST-09) e de peões/ciclo (ST-10). Eventos de
 * turno (ST-11) não alteram o modelo e são ignorados pelo socket (default).
 */
export function reduzirEvento(
  estado: EstadoDoTabuleiroNoCliente,
  evento: TabuleiroEventoDoServidor | PeaoEventoDoServidor,
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
        recebidasPendentes: estado.recebidasPendentes.filter(
          (r) => chaveCelula(r.celulaAlvo) !== chaveCelula(evento.celula),
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
      // Pendências do wire ganham o campo client-side `pecaId` (null até o
      // TIPO_DA_PECA_RECEBIDA_ESCOLHIDO preencher).
      return {
        ...estado,
        recebidasPendentes: evento.recebidas.map((r) => ({ ...r, pecaId: null })),
      }
    case 'PEAO_POSICIONADO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      // Primeiro Turno: o engine re-seleciona o peão no `posicionar_peao`
      // (partida.ts) — o cliente espelha a seleção explicitamente.
      return { ...estado, peoes, peaoSelecionadoId: evento.peaoId }
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
      // para não manter seleção fantasma.
      return { ...estado, peoes, peaoSelecionadoId: null }
    }
    case 'PEAO_PERMANECEU':
      // permanecer no engine limpa o peaoSelecionadoId (não altera posição).
      return { ...estado, peaoSelecionadoId: null }

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
  eventos: readonly (TabuleiroEventoDoServidor | PeaoEventoDoServidor)[],
): EstadoDoTabuleiroNoCliente {
  return eventos.reduce(reduzirEvento, estado)
}

/** Deriva o estado de exibição consumido pela cena a partir do modelo. */
export function estadoDeExibicaoDoModelo(
  estado: EstadoDoTabuleiroNoCliente,
): EstadoExibicaoTabuleiro {
  return { reserva: estado.reserva, posicionadas: estado.posicionadas, peoes: estado.peoes }
}
