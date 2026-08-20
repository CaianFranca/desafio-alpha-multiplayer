import { Link } from 'react-router-dom'

interface StubPageProps {
  title: string
  message: string
}

export function StubPage({ title, message }: StubPageProps) {
  return (
    <section className="stub-page" aria-labelledby="stub-title">
      <p className="eyebrow">Em construção</p>
      <h1 id="stub-title">{title}</h1>
      <p className="stub-message">{message}</p>
      <Link to="/" className="secondary-button">
        ← Voltar ao início
      </Link>
    </section>
  )
}
