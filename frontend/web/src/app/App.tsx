import { Link, Outlet } from 'react-router-dom'

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/">Flicker of Sanity</Link>
        <nav aria-label="Navegação principal">
          <Link to="/">Início</Link>
        </nav>
      </header>
      <main className="app-content"><Outlet /></main>
    </div>
  )
}
