import { Link } from 'react-router-dom'

interface StubPageProps {
  title: string
  message: string
}

export function StubPage({ title, message }: StubPageProps) {
  return (
    <section className="max-w-lg text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="stub-title">
      <p className="text-[var(--color-accent)] text-xs font-bold tracking-[.16em] uppercase">Em construção</p>
      <h1 id="stub-title">{title}</h1>
      <p className="text-[var(--color-muted)] text-lg leading-relaxed my-6 mb-8">{message}</p>
      <Link to="/" className="inline-block border-2 border-[var(--color-muted)] rounded-lg bg-transparent text-[var(--color-muted)] cursor-pointer font-sans font-semibold px-5 py-3 text-center hover:border-white hover:text-white transition-colors">
        ← Voltar ao início
      </Link>
    </section>
  )
}
