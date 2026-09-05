import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from '../components/ui/Header'
import { ErrorBoundary } from '../components/home/ErrorBoundary'
import { LoadingPage } from '../components/home/ErrorPage'
import { SalaWebSocketProvider } from '../state/SalaWebSocketProvider'

export function App() {
  const location = useLocation()
  // HUD da Partida (issue #226): a rota /partida ocupa todo o navegador sem
  // o cabeçalho do site — o HUD em 6 regiões é a única interface sobre o
  // Ambiente de Jogo (conteúdo em 100vh/100vw, sem header sticky).
  const emPartida = location.pathname.startsWith('/partida')

  if (emPartida) {
    return (
      <SalaWebSocketProvider>
        <div className="h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top,#26334a,var(--color-background)_55%)]">
          <main id="main-content" className="flex h-full w-full min-h-0 flex-col p-0">
            <ErrorBoundary>
              <Suspense fallback={<LoadingPage />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </SalaWebSocketProvider>
    )
  }

  return (
    <SalaWebSocketProvider>
      <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#26334a,var(--color-background)_55%)]">
        <Header />
        <main id="main-content" className="flex flex-1 min-h-0 flex-col p-0">
          <ErrorBoundary>
            <Suspense fallback={<LoadingPage />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </SalaWebSocketProvider>
  )
}
