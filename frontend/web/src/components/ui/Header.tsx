import { Link } from 'react-router-dom'
import { useAuth } from '../../state/useAuth'
import { salaCta } from '../home/placeholders'

export function Header() {
  const authState = useAuth()

  return (
    <header className="py-6 px-[clamp(1.5rem,5vw,5rem)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-(--color-accent) focus:text-gray-800 focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold">
        Pular para o conteúdo
      </a>
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 items-center gap-4">
        <Link className="w-fit font-extrabold tracking-[.04em] text-inherit no-underline justify-self-center sm:justify-self-start" to="/">Flicker of Sanity</Link>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-6 gap-y-3">
          <nav aria-label="Navegação principal" className="flex gap-6">
            <a href="#historia" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">História</a>
            <a href="#caracteristicas" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Características</a>
            <a href="#objetivos" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Objetivos</a>
          </nav>
          {authState.status === 'autenticado' && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold">{authState.jogador.apelido}</span>
              <Link to="/salas/criar" className="inline-block border-0 rounded-lg bg-(--color-accent) text-gray-800 cursor-pointer font-sans font-bold px-4 py-2 text-center text-sm hover:opacity-90 transition-opacity">
                {salaCta.criarSala}
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
