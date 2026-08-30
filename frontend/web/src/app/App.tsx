import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from '../components/ui/Header'
import { ErrorBoundary } from '../components/home/ErrorBoundary'
import { LoadingPage } from '../components/home/ErrorPage'
import { SalaWebSocketProvider } from '../state/SalaWebSocketProvider'

export function App() {
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
