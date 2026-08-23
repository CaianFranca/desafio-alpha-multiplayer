import { Link } from 'react-router-dom'
import { useAuth } from '../../state/useAuth'
import { salaCta } from './placeholders'

interface AuthActionsProps {
  className?: string
}

export function AuthActions({ className }: AuthActionsProps) {
  const authState = useAuth()

  if (authState.status === 'autenticado') {
    return (
      <div className={className}>
        <Link to="/salas/criar" className="inline-block border-0 rounded-lg bg-[var(--color-accent)] text-gray-800 cursor-pointer font-sans font-bold px-5 py-3 text-center hover:opacity-90 transition-opacity">{salaCta.criarSala}</Link>
      </div>
    )
  }

  return (
    <div className={className}>
      <Link to="/cadastro" className="inline-block border-0 rounded-lg bg-[var(--color-accent)] text-gray-800 cursor-pointer font-sans font-bold px-5 py-3 text-center hover:opacity-90 transition-opacity">Criar conta</Link>
      <Link to="/login" className="inline-block border-2 border-(--color-muted) rounded-lg bg-transparent text-(--color-muted) cursor-pointer font-sans font-semibold px-5 py-3 text-center hover:border-white hover:text-white transition-colors">Entrar</Link>
    </div>
  )
}
