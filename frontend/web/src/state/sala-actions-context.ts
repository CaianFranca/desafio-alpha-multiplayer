import { createContext, useContext } from 'react'

export interface SalaActionsContextValue {
  registrarSairDaSala: (fn: (() => void) | null) => void
  sairDaSala: (() => void) | null
}

export const SalaActionsContext = createContext<SalaActionsContextValue | null>(null)

export function useSalaActions(): SalaActionsContextValue {
  const value = useContext(SalaActionsContext)
  if (!value) {
    throw new Error('useSalaActions deve ser usado dentro de SalaActionsProvider')
  }
  return value
}