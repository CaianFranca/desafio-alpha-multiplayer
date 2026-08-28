import { useAuth } from '../../state/useAuth'
import { CtaLink } from '../ui/CtaLink'

/** Rótulo único da ação de criar sala, compartilhado por cabeçalho e seções. */
export const criarSalaLabel = 'Criar Sala'

interface AuthActionsProps {
  className?: string
}

export function AuthActions({ className }: AuthActionsProps) {
  const { authState } = useAuth()

  if (authState.status === 'authenticated') {
    return (
      <div className={className}>
        <CtaLink to="/salas/criar" variant="primary">{criarSalaLabel}</CtaLink>
      </div>
    )
  }

  return (
    <div className={className}>
      <CtaLink to="/cadastro" variant="primary">Criar conta</CtaLink>
      <CtaLink to="/login" variant="secondary">Entrar</CtaLink>
    </div>
  )
}
