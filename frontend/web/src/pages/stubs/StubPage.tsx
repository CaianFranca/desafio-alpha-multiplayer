import { BackLink } from '../../components/ui/BackLink'

interface StubPageProps {
  title: string
  message: string
  notice?: string
}

export function StubPage({ title, message, notice }: StubPageProps) {
  return (
    <section className="max-w-lg text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="stub-title">
      <p className="text-accent text-xs font-bold tracking-[.16em] uppercase">Em construção</p>
      <h1 id="stub-title">{title}</h1>
      {notice && <p role="status" className="text-muted text-base leading-relaxed my-4">{notice}</p>}
      <p className="text-muted text-lg leading-relaxed my-6 mb-8">{message}</p>
      <BackLink />
    </section>
  )
}
