import { BackLink } from '../ui/BackLink'
import { DotsDeCarregamento } from '../loading/DotsDeCarregamento'

export function LoadingPage() {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
    >
      <div className="encaminhamento-carregando">
        <DotsDeCarregamento rotuloVisivel="Carregando..." />
      </div>
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
