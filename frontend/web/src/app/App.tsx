import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from '../components/ui/Header'
import { ErrorBoundary } from '../components/home/ErrorBoundary'
import { LoadingPage } from '../components/home/ErrorPage'

export function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#26334a,var(--color-background)_55%)]">
      <Header />
      <main id="main-content" className="min-h-[calc(100vh-5rem)] p-0">
        <ErrorBoundary>
          <Suspense fallback={<LoadingPage />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
