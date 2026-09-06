/**
 * Encaixe — voo mesa→célula (issue #241, spec #238).
 *
 * Puramente geométrico e testável: resolve as posições mundo da origem
 * (mesa/bandeja) e do destino (célula) do voo. A animação em si vive em
 * `game/scenes/TransicaoEncaixe.tsx`; o trigger evento-driven
 * (`EncaixeTrigger`) é o contrato entre a PartidaPage e a cena.
 */

import {
  PECA_Y,
  POSICAO_BANDEJA,
  celulaParaMundo,
  inicialIndiceParaMundo,
} from './contrato'
import type { Celula } from './contrato'

/** Origem do Encaixe derivada do estado anterior ao evento. */
export type OrigemDoEncaixe = 'mesa' | 'bandeja'

export interface EncaixeTrigger {
  readonly pecaId: string
  readonly origem: OrigemDoEncaixe
  /** Índice da Inicial na mesa (grade 2×2) — só quando origem é mesa. */
  readonly indiceNaMesa: number | null
  readonly celula: Celula
  readonly key: number
}

/**
 * Altura da peça sobre a mesa na origem (espelha `Caixa.tsx`: a corrente da
 * bandeja e as Iniciais renderizam o placeholder a 0.02 acima do grupo).
 */
const ALTURA_PECA_SOBRE_A_MESA = 0.02

/**
 * Posição mundo da origem do voo: mesa resolve pela grade 2×2 das Iniciais;
 * bandeja é o slot único da Caixa.
 */
export function posicaoMundoDaOrigemDoEncaixe(
  origem: OrigemDoEncaixe,
  indiceNaMesa: number | null,
): [number, number, number] {
  if (origem === 'mesa' && indiceNaMesa !== null) {
    const [x, y, z] = inicialIndiceParaMundo(indiceNaMesa)
    return [x, y + ALTURA_PECA_SOBRE_A_MESA, z]
  }
  return [
    POSICAO_BANDEJA[0],
    POSICAO_BANDEJA[1] + ALTURA_PECA_SOBRE_A_MESA,
    POSICAO_BANDEJA[2],
  ]
}

/**
 * Posição mundo do destino do voo: exatamente a transformada do
 * `PecaPlaceholder` da `Celula` (`celulaParaMundo` + `[0, PECA_Y, 0]`) — ao
 * fim do voo o overlay some e a peça do tabuleiro assume pixel-igual.
 */
export function posicaoMundoDoDestinoDoEncaixe(celula: Celula): [number, number, number] {
  const [x, y, z] = celulaParaMundo(celula)
  return [x, y + PECA_Y, z]
}
