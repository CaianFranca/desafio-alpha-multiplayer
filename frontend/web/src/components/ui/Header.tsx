import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="py-6 px-[clamp(1.5rem,5vw,5rem)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-(--color-accent) focus:text-gray-800 focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold">
        Pular para o conteúdo
      </a>
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 items-center gap-4">
        <Link className="w-fit font-extrabold tracking-[.04em] text-inherit no-underline justify-self-center sm:justify-self-start" to="/">Flicker of Sanity</Link>
        <nav aria-label="Navegação principal" className="flex justify-center sm:justify-end gap-6">
          <a href="#historia" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">História</a>
          <a href="#caracteristicas" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Características</a>
          <a href="#objetivos" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Objetivos</a>
        </nav>
      </div>
    </header>
  )
}
