import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../state/useAuth'

/** Mensagem orientativa exibida na página de login após o redirecionamento. */
export const protectedRouteMessage = 'Entre para acessar esta funcionalidade.'

/** Estado de navegação preservado ao redirecionar para login/cadastro. */
export interface ProtectedLocationState {
  reason?: string
  from?: string
}

interface RequireAuthProps {
  children: ReactNode
}

/** Destino interno seguro após login/cadastro; barra open-redirect e loops de auth. */
export function destinoSeguroDeAuth(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/'
  if (from.startsWith('/login') || from.startsWith('/cadastro')) return '/'
  return from
}

/** Redireciona visitante para o login ao tentar acessar rotas protegidas, preservando o destino. */
export function RequireAuth({ children }: RequireAuthProps) {
  const { authState } = useAuth()
  const location = useLocation()

  if (authState.status === 'loading') return null

  if (authState.status === 'visitor') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ reason: protectedRouteMessage, from: location.pathname + location.search } satisfies ProtectedLocationState}
      />
    )
  }

  return <>{children}</>
}
