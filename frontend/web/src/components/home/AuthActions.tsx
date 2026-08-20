import { Link } from 'react-router-dom'

interface AuthActionsProps {
  className?: string
}

export function AuthActions({ className }: AuthActionsProps) {
  return (
    <div className={className}>
      <Link to="/cadastro" className="inline-block border-0 rounded-lg bg-[var(--color-accent)] text-gray-800 cursor-pointer font-sans font-bold px-5 py-3 text-center hover:opacity-90 transition-opacity">Criar conta</Link>
      <Link to="/login" className="inline-block border-2 border-(--color-muted) rounded-lg bg-transparent text-(--color-muted) cursor-pointer font-sans font-semibold px-5 py-3 text-center hover:border-white hover:text-white transition-colors">Entrar</Link>
    </div>
  )
}
