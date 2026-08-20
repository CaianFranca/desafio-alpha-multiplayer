import { Suspense } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { ErrorBoundary } from '../components/home/ErrorBoundary'
import { LoadingPage } from '../components/home/ErrorPage'

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">Flicker of Sanity</Link>
        <nav aria-label="Navegação principal">
          <a href="#historia">História</a>
          <a href="#caracteristicas">Características</a>
          <a href="#objetivos">Objetivos</a>
        </nav>
        <div className="header-actions">
          <Link to="/cadastro" className="primary-button">Criar conta</Link>
          <Link to="/login" className="secondary-button">Entrar</Link>
          <Link to="/salas/criar" className="accent-button">Criar sala</Link>
        </div>
      </header>
      <main className="app-content">
        <ErrorBoundary>
          <Suspense fallback={<LoadingPage />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
