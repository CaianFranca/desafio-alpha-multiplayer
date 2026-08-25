import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext, visitorState, type AuthContextValue, type AuthState } from './auth-context'
import { encerrarSessao, obterJogadorAutenticado } from '../api/auth'
import { estadoAutenticadoMock } from './mock-auth'

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
 * Sem mock, o estado inicial é `carregando` e a reidratação acontece via
 * GET /api/auth/me.
 */
function resolveInitialState(): AuthState {
  if (__MOCK_AUTH__ && import.meta.env.VITE_AUTH_MOCK === 'true') {
    return estadoAutenticadoMock
  }
  return { status: 'carregando' }
}

export function AuthProvider({ initialState, children }: AuthProviderProps) {
  const [resolvido] = useState(resolveInitialState)
  const reidrata = initialState === undefined && resolvido.status === 'carregando'
  const [estado, setEstado] = useState<AuthState>(initialState ?? resolvido)

  useEffect(() => {
    if (!reidrata) return
    let ativo = true
    void obterJogadorAutenticado().then((resultado) => {
      if (!ativo) return
      setEstado(resultado.ok ? { status: 'autenticado', jogador: resultado.jogador } : visitorState)
    })
    return () => {
      ativo = false
    }
  }, [reidrata])

  const sair = useCallback(async () => {
    await encerrarSessao()
    setEstado(visitorState)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({ estado, sair }), [estado, sair])
  return <AuthContext value={value}>{children}</AuthContext>
}
