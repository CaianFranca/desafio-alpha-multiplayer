import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext, visitorState, type AuthContextValue, type AuthState } from './auth-context'
import {
  entrarComCredenciais as entrarRequest,
  fetchCurrentPlayer,
  logout as logoutRequest,
  register as registerRequest,
} from '../api/auth'
import type { AuthActionResult, CadastroPayload, CredenciaisPayload } from '../api/auth'
import { onSessionExpired } from '../api/client'
import { mockAuthenticatedState } from './mock-auth'

export type { AuthState }

interface AuthProviderProps {
  initialState?: AuthState
  children: ReactNode
}

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

  const entrarComCredenciais = useCallback(async (payload: CredenciaisPayload): Promise<AuthActionResult> => {
    const result = await entrarRequest(payload)
    if (result.ok) {
      setState({ status: 'authenticated', jogador: result.jogador })
    }
    return result
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ authState: state, logout, register, entrarComCredenciais, login: entrarComCredenciais }),
    [state, logout, register, entrarComCredenciais],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}
