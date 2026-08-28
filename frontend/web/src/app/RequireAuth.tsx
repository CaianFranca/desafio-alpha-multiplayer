import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/useAuth'

/** Mensagem orientativa exibida na página de login após o redirecionamento. */
export const protectedRouteMessage = 'Entre para acessar esta funcionalidade.'

interface RequireAuthProps {
  children: ReactNode
}

/** Redireciona visitante para o login ao tentar acessar rotas protegidas. */
export function RequireAuth({ children }: RequireAuthProps) {
  const { authState } = useAuth()

  if (authState.status === 'loading') return null

  if (authState.status === 'visitor') {
    return <Navigate to="/login" replace state={{ reason: protectedRouteMessage }} />
  }

  return <>{children}</>
}
