import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/useAuth'

interface RequireAuthProps {
  children: ReactNode
}

/** Redireciona visitante para o login ao tentar acessar rotas protegidas. */
export function RequireAuth({ children }: RequireAuthProps) {
  const authState = useAuth()

  if (authState.status === 'visitante') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
