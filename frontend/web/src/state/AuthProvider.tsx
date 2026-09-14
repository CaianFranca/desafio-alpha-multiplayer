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
import { onSessionExpired, calcularIntervaloSlide, lerTtlDeAcessoSegundos } from '../api/client'
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
 * Slide-session proativo (issue #376): o access token expira no TTL e uma
 * Partida longa e ociosa não gera tráfego HTTP para renová-lo. O intervalo
 * deriva do TTL (`VITE_SESSION_ACCESS_TTL_SECONDS`, fallback 900s) com 5
 * min de margem; voltar à aba (visible/focus) renova de imediato (com
 * throttle de 1 min). Falha aqui não desloga — o 401 confirmado pelo
 * `apiFetch` continua sendo o dono do logout.
 *
 * Recorte além do mínimo da #376 (review PR #383, não-bloqueante): a
 * calibragem por TTL (teto/piso/margem em `client.ts`) e a reidratação com
 * retry 3×2s abaixo são intencionais — sobrevivem a mudanças em
 * `SESSION_ACCESS_TTL_SECONDS` e a instabilidade momentânea — mas não são
 * necessárias ao funcionamento básico do slide (o `apiFetch` com
 * 401 → refresh → retry já corrige a expulsão). Sem ADR: decisão de baixo
 * impacto aparente.
 */
export const ATRASO_MINIMO_SLIDE_VISIVEL_MS = 60 * 1000
/** Tentativas da reidratação ante falha transitória (1 inicial + retries). */
export const TENTATIVAS_REIDRATACAO = 3
/** Espera entre tentativas da reidratação. */
export const ATRASO_REIDRATACAO_MS = 2000

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
    let tentativas = 0
    let timer: number | null = null
    const reidratar = () => {
      void fetchCurrentPlayer().then((result) => {
        if (!active) return
        if (result.ok) {
          setState({ status: 'authenticated', jogador: result.jogador })
          return
        }
        // Falha transitória marcada (rede/5xx no /me ou no refresh): retenta
        // com backoff antes de declarar Visitante — evita expulsão por
        // instabilidade momentânea. Sessão inválida e demais falhas caem
        // direto a Visitante, sem espera.
        if (result.reason === 'unknown-failure' && result.transiente === true && tentativas < TENTATIVAS_REIDRATACAO - 1) {
          tentativas += 1
          timer = window.setTimeout(reidratar, ATRASO_REIDRATACAO_MS)
          return
        }
        setState(visitorState)
      })
    }
    reidratar()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [rehydrate])

  useEffect(() => onSessionExpired(() => setState(visitorState)), [])

  const autenticado = state.status === 'authenticated'
  const ultimoSlideRef = useRef(0)
  useEffect(() => {
    if (!autenticado || slideProativoDesligado()) return
    if (typeof window === 'undefined') return
    const deslizar = () => {
      // Review PR #383: só marca o throttle em sucesso. Falha transitória não
      // pode suprimir o próximo visibility/focus — senão a Sessão fica sem
      // renovar por 1 min sob rede instável.
      void (async () => {
        try {
          const renovou = await refreshSession()
          if (renovou) ultimoSlideRef.current = Date.now()
        } catch {
          // melhor esforço: o próximo visibility/focus tenta de novo.
        }
      })()
    }
    const deslizarAoVoltar = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimoSlideRef.current < ATRASO_MINIMO_SLIDE_VISIVEL_MS) return
      deslizar()
    }
    ultimoSlideRef.current = Date.now()
    const intervalo = window.setInterval(deslizar, calcularIntervaloSlide(lerTtlDeAcessoSegundos()))
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
