import { Link } from 'react-router-dom'

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]" role="status" aria-label="Carregando">
      <p className="text-(--color-muted) text-lg">Carregando...</p>
    </div>
  )
}

interface ErrorPageProps {
  message?: string
}

export function ErrorPage({ message }: ErrorPageProps) {
  return (
    <section className="max-w-lg text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="error-title">
      <p className="text-(--color-accent) text-xs font-bold tracking-[.16em] uppercase">Erro</p>
      <h1 id="error-title">Algo deu errado</h1>
      <p className="text-(--color-muted) text-lg leading-relaxed my-6 mb-8">{message ?? 'Ocorreu um erro inesperado. Tente novamente.'}</p>
      <Link to="/" className="inline-block border-2 border-(--color-muted) rounded-lg bg-transparent text-(--color-muted) cursor-pointer font-sans font-semibold px-5 py-3 text-center hover:border-white hover:text-white transition-colors">
        ← Voltar ao início
      </Link>
    </section>
  )
}
