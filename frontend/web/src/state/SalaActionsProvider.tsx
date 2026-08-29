import { useCallback, useState, type ReactNode } from 'react'
import { SalaActionsContext, type SalaActionsContextValue } from './sala-actions-context'

// Ponte entre o Header (global) e a SalaPage que detém o WebSocket da sala:
// a página registra sua ação de saída, e o Header a invoca. Padrão análogo ao
// onSessionExpired de api/client.ts — sem elevar o socket para o App.
interface SairDaSalaRegistrada {
  fn: () => void
}

export function SalaActionsProvider({ children }: { children: ReactNode }) {
  // Guardada num wrapper: um estado que vale uma função pura faria o React
  // invocá-la como updater — disparando navigate('/') no mount.
  const [registrada, setRegistrada] = useState<SairDaSalaRegistrada | null>(null)

  const registrarSairDaSala = useCallback((fn: (() => void) | null) => {
    setRegistrada(fn ? { fn } : null)
  }, [])

  const value: SalaActionsContextValue = { registrarSairDaSala, sairDaSala: registrada?.fn ?? null }
  return <SalaActionsContext.Provider value={value}>{children}</SalaActionsContext.Provider>
}