import { createContext, useContext } from 'react'
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
