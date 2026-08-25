import { BackLink } from '../../components/ui/BackLink'

interface StubPageProps {
  title: string
  message: string
  aviso?: string
}

export function StubPage({ title, message, aviso }: StubPageProps) {
  return (
    <section className="max-w-lg text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="stub-title">
      <p className="text-[var(--color-accent)] text-xs font-bold tracking-[.16em] uppercase">Em construção</p>
      <h1 id="stub-title">{title}</h1>
      {aviso && <p role="status" className="text-(--color-muted) text-base leading-relaxed my-4">{aviso}</p>}
      <p className="text-[var(--color-muted)] text-lg leading-relaxed my-6 mb-8">{message}</p>
      <BackLink />
    </section>
  )
}
