import { Link } from 'react-router-dom'

interface AuthActionsProps {
  className?: string
}

export function AuthActions({ className }: AuthActionsProps) {
  return (
    <div className={className ?? 'hero-actions'}>
      <Link to="/cadastro" className="primary-button">Criar conta</Link>
      <Link to="/login" className="secondary-button">Entrar</Link>
    </div>
  )
}
