import { BackLink } from '../ui/BackLink'

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]" role="status" aria-label="Carregando">
      <p className="text-muted text-lg">Carregando...</p>
    </div>
  )
}

interface ErrorPageProps {
  message?: string
}

export function ErrorPage({ message }: ErrorPageProps) {
  return (
    <section className="max-w-lg text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="error-title">
      <p className="text-accent text-sm font-bold tracking-[.16em] uppercase">Erro</p>
      <h1 id="error-title">Algo deu errado</h1>
      <p className="text-muted text-lg leading-relaxed my-6 mb-8">{message ?? 'Ocorreu um erro inesperado. Tente novamente.'}</p>
      <BackLink />
    </section>
  )
}
