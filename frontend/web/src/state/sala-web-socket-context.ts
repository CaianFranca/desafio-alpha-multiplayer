import { createContext, useContext } from 'react'
import { quantidadeValidaDeJogadores } from '../game/tabuleiro/contrato'
import type { UseSalaWebSocketReturn } from '../hooks/useSalaWebSocket'

export const SalaWebSocketContext = createContext<UseSalaWebSocketReturn | null>(null)

export function useSalaWebSocketContext(): UseSalaWebSocketReturn {
  const value = useContext(SalaWebSocketContext)
  if (!value) {
    throw new Error('useSalaWebSocketContext deve ser usado dentro de SalaWebSocketProvider')
  }
  return value
}

export function useSalaCodigoOptional(): string | null {
  const ctx = useContext(SalaWebSocketContext)
  return ctx?.sala?.codigoDeSala ?? null
}

/** Quantidade de Membros na Sala (N=2..4), ou null sem sala — seed pré-snapshot da Partida (#284). */
export function useQuantidadeDeMembrosDaSalaOptional(): number | null {
  const ctx = useContext(SalaWebSocketContext)
  const quantidade = ctx?.sala?.membros.length
  if (typeof quantidade !== 'number' || quantidade <= 0) return null
  // Clamp 2..4 para N=1/5+ (risco 4): solo transitório e quórum parcial não geram partida válida,
  // mas o seed não deve criar mesa com N fora da faixa.
  return quantidadeValidaDeJogadores(quantidade)
}
