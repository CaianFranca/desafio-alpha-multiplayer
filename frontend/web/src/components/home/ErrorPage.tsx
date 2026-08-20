import { Link } from 'react-router-dom'

export function LoadingPage() {
  return (
    <div className="loading-page" role="status" aria-label="Carregando">
      <p className="loading-text">Carregando...</p>
    </div>
  )
}

interface ErrorPageProps {
  message?: string
}

export function ErrorPage({ message }: ErrorPageProps) {
  return (
    <section className="error-page" aria-labelledby="error-title">
      <p className="eyebrow">Erro</p>
      <h1 id="error-title">Algo deu errado</h1>
      <p className="error-message">{message ?? 'Ocorreu um erro inesperado. Tente novamente.'}</p>
      <Link to="/" className="secondary-button">
        ← Voltar ao início
      </Link>
    </section>
  )
}
