import type { ReactNode } from 'react'
import { AuthContext, visitorState, type AuthState } from './auth-context'

export type { AuthState }

interface AuthProviderProps {
  /**
   * Injeção de estado para testes. Quando ausente, o estado inicial é
   * derivado do modo de compilação e da variável de ambiente.
   */
  initialState?: AuthState
  children: ReactNode
}

/**
 * Implementação mock de autenticação (issue #5).
 *
 * Dupla trava:
 * 1. `__MOCK_AUTH__` é uma constante de compilação definida em vite.config.ts
 *    como `mode !== 'production'`. No build de produção ela se torna o literal
 *    `false` e a implementação mock abaixo é eliminada pelo minificador.
 * 2. `VITE_AUTH_MOCK=true` ativa o mock em desenvolvimento e testes.
 */
function resolveInitialState(): AuthState {
  if (__MOCK_AUTH__ && import.meta.env.VITE_AUTH_MOCK === 'true') {
    return { status: 'autenticado', jogador: { apelido: 'JogadorTeste' } }
  }
  return visitorState
}

export function AuthProvider({ initialState, children }: AuthProviderProps) {
  const value = initialState ?? resolveInitialState()
  return <AuthContext value={value}>{children}</AuthContext>
}
