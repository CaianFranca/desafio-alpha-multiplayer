import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext, visitorState, type AuthContextValue, type AuthState } from './auth-context'
import {
  fetchCurrentPlayer,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '../api/auth'
import type { AuthActionResult, CadastroPayload, LoginPayload } from '../api/auth'
import { onSessionExpired } from '../api/client'
import { mockAuthenticatedState } from './mock-auth'

export type { AuthState }

interface AuthProviderProps {
  /**
   * Injeção de estado para testes: com initialState o provider opera em modo
   * estático, sem reidratação nem chamadas de rede.
   */
  initialState?: AuthState
  children: ReactNode
}

/**
 * Implementação real de autenticação (issue #27).
 *
 * Dupla trava do mock preservada (issue #5):
 * 1. `__MOCK_AUTH__` é constante de compilação (vite.config.ts), literal
 *    `false` no build de produção — o mock é eliminado pelo minificador.
 * 2. `VITE_AUTH_MOCK=true` ativa o mock em desenvolvimento.
 *
 * Sem mock, o estado inicial é `loading` e a reidratação acontece via
 * GET /api/auth/me. Sessão expirada ou revogada (401 em qualquer chamada de
 * API) devolve o usuário ao estado de Visitante.
 */
function resolveInitialState(): AuthState {
  if (__MOCK_AUTH__ && import.meta.env.VITE_AUTH_MOCK === 'true') {
    return mockAuthenticatedState
  }
  return { status: 'loading' }
}

export function AuthProvider({ initialState, children }: AuthProviderProps) {
  const [resolved] = useState(resolveInitialState)
  const rehydrate = initialState === undefined && resolved.status === 'loading'
  const [state, setState] = useState<AuthState>(initialState ?? resolved)

  useEffect(() => {
    if (!rehydrate) return
    let active = true
    void fetchCurrentPlayer().then((result) => {
      if (!active) return
      setState(result.ok ? { status: 'authenticated', jogador: result.jogador } : visitorState)
    })
    return () => {
      active = false
    }
  }, [rehydrate])

  useEffect(() => onSessionExpired(() => setState(visitorState)), [])

  const logout = useCallback(async () => {
    await logoutRequest()
    setState(visitorState)
  }, [])

  const register = useCallback(async (payload: CadastroPayload): Promise<AuthActionResult> => {
    const result = await registerRequest(payload)
    if (result.ok) {
      setState({ status: 'authenticated', jogador: result.jogador })
    }
    return result
  }, [])

  const login = useCallback(async (payload: LoginPayload): Promise<AuthActionResult> => {
    const result = await loginRequest(payload)
    if (result.ok) {
      setState({ status: 'authenticated', jogador: result.jogador })
    }
    return result
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ authState: state, logout, register, login }),
    [state, logout, register, login],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}
