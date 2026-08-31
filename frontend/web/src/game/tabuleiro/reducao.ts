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
 */

import {
  criarReservaInicial,
  type EstadoExibicaoTabuleiro,
  type Orientacao,
  type PecaDaReserva,
  type PecaPosicionada,
  type PeaoDaExibicao,
  type TipoDaPeca,
} from './contrato'
import type {
  TabuleiroEventoDoServidor,
  PeaoEventoDoServidor,
  PendenciaDeRecebimento,
} from '@flicker/shared'

/** Estado do modelo de tabuleiro mantido no cliente. */
export interface EstadoDoTabuleiroNoCliente {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
  /** Peões com posição autoritativa do servidor (issue #91). */
  readonly peoes: readonly PeaoDaExibicao[]
  /** Recebidas aguardando escolha de tipo e encaixe. */
  readonly recebidasPendentes: readonly PendenciaDeRecebimento[]
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
    peoes: [],
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
      return { ...estado, recebidasPendentes: evento.recebidas }
    case 'PEAO_POSICIONADO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      return { ...estado, peoes }
    }
    case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO': {
      // Remove a pendência correspondente e registra o tipo para que
      // PECA_POSICIONADA posterior encontre o tipo (fora da Reserva).
      return {
        ...estado,
        pecasDeRecebimento: {
          ...estado.pecasDeRecebimento,
          [evento.pecaId]: evento.tipoDaPeca,
        },
        pecaSelecionadaId: evento.pecaId,
        recebidasPendentes: estado.recebidasPendentes.filter(
          (r) => r.recebidaId !== evento.recebidaId,
        ),
      }
    }
    case 'PEAO_MOVIDO': {
      const peoes = estado.peoes.map((p) =>
        p.peaoId === evento.peaoId ? { ...p, celula: evento.celula } : p,
      )
      return { ...estado, peoes }
    }
    case 'PEAO_PERMANECEU':
      // Permanência não altera o modelo — peão já está na posição correta.
      return estado

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
