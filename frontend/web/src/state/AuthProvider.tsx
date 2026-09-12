import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext, visitorState, type AuthContextValue, type AuthState } from './auth-context'
import {
  entrarComCredenciais as entrarRequest,
  fetchCurrentPlayer,
  logout as logoutRequest,
  refreshSession,
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

/**
 * Slide-session proativo (issue #376): o access token expira em 15 min e uma
 * Partida longa e ociosa não gera tráfego HTTP para renová-lo. O intervalo
 * (10 min, abaixo do TTL) renova os cookies com o app aberto; voltar à aba
 * (visible/focus) renova de imediato (com throttle de 1 min). Falha aqui não
 * desloga — o 401 confirmado pelo `apiFetch` continua sendo o dono do logout.
 */
export const INTERVALO_SLIDE_SESSAO_MS = 10 * 60 * 1000
export const ATRASO_MINIMO_SLIDE_VISIVEL_MS = 60 * 1000

function slideProativoDesligado(): boolean {
  return __MOCK_AUTH__ && import.meta.env.VITE_AUTH_MOCK === 'true'
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

  const autenticado = state.status === 'authenticated'
  const ultimoSlideRef = useRef(0)
  useEffect(() => {
    if (!autenticado || slideProativoDesligado()) return
    if (typeof window === 'undefined') return
    const deslizar = () => {
      ultimoSlideRef.current = Date.now()
      void refreshSession()
    }
    const deslizarAoVoltar = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimoSlideRef.current < ATRASO_MINIMO_SLIDE_VISIVEL_MS) return
      deslizar()
    }
    ultimoSlideRef.current = Date.now()
    const intervalo = window.setInterval(deslizar, INTERVALO_SLIDE_SESSAO_MS)
    document.addEventListener('visibilitychange', deslizarAoVoltar)
    window.addEventListener('focus', deslizarAoVoltar)
    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', deslizarAoVoltar)
      window.removeEventListener('focus', deslizarAoVoltar)
    }
  }, [autenticado])

  const logout = useCallback(async () => {
    await logoutRequest()
    setState(visitorState)
  }, [])

  const register = useCallback(async (payload: CadastroPayload): Promise<AuthActionResult> => {
    const result = await registerRequest(payload)
    if (!result.ok) return result
    const me = await fetchCurrentPlayer()
    if (me.ok) {
      setState({ status: 'authenticated', jogador: me.jogador })
      return { ok: true, jogador: me.jogador }
    }
    if (me.reason === 'invalid-session') {
      return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: 401 }
    }
    return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: 0 }
  }, [])

  const entrarComCredenciais = useCallback(async (payload: CredenciaisPayload): Promise<AuthActionResult> => {
    const result = await entrarRequest(payload)
    if (!result.ok) return result
    const me = await fetchCurrentPlayer()
    if (me.ok) {
      setState({ status: 'authenticated', jogador: me.jogador })
      return { ok: true, jogador: me.jogador }
    }
    if (me.reason === 'invalid-session') {
      return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: 401 }
    }
    return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: 0 }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ authState: state, logout, register, entrarComCredenciais, login: entrarComCredenciais }),
    [state, logout, register, entrarComCredenciais],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}
