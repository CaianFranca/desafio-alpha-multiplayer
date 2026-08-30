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
  type Orientacao,
  type PecaDaReserva,
  type PecaPosicionada,
} from './contrato'
import type { TabuleiroEventoDoServidor } from '@flicker/shared'

/** Estado do modelo de tabuleiro mantido no cliente. */
export interface EstadoDoTabuleiroNoCliente {
  readonly reserva: readonly PecaDaReserva[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly pecaSelecionadaId: string | null
  readonly pecaEmManipulacaoId: string | null
}

/** Estado inicial determinístico do cliente (deltas a partir do zero). */
export function criarEstadoInicialDoCliente(): EstadoDoTabuleiroNoCliente {
  return {
    reserva: criarReservaInicial(),
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
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
 */
export function reduzirEvento(
  estado: EstadoDoTabuleiroNoCliente,
  evento: TabuleiroEventoDoServidor,
): EstadoDoTabuleiroNoCliente {
  switch (evento.type) {
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
      // PECA_POSICIONADA não traz `tipo`; preserva o da Reserva.
      const pecaNaReserva = estado.reserva.find(
        (p) => p.pecaId === evento.pecaId,
      )
      if (!pecaNaReserva) return estado
      const posicionada: PecaPosicionada = {
        pecaId: evento.pecaId,
        tipo: pecaNaReserva.tipo,
        orientacao: evento.orientacao,
        celula: evento.celula,
      }
      return {
        ...estado,
        reserva: estado.reserva.filter((p) => p.pecaId !== evento.pecaId),
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
  eventos: readonly TabuleiroEventoDoServidor[],
): EstadoDoTabuleiroNoCliente {
  return eventos.reduce(reduzirEvento, estado)
}

/** Deriva o estado de exibição consumido pela cena a partir do modelo. */
export function estadoDeExibicaoDoModelo(
  estado: EstadoDoTabuleiroNoCliente,
): { reserva: readonly PecaDaReserva[]; posicionadas: readonly PecaPosicionada[] } {
  return { reserva: estado.reserva, posicionadas: estado.posicionadas }
}
