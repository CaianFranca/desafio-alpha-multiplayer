import { hero } from './placeholders'
import { AuthActions } from '../auth/AuthActions'

export function HeroSection() {
  return (
    <section id="hero" className="max-w-4xl text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8" aria-labelledby="home-title">
      <p className="text-(--color-accent) text-xs font-bold tracking-[.16em] uppercase">{hero.eyebrow}</p>
      <h1 id="home-title" className="my-4 text-[clamp(2.5rem,8vw,5rem)] leading-[.95]">{hero.title}</h1>
      <p className="text-(--color-muted) text-lg leading-relaxed">{hero.copy}</p>
      <AuthActions className="flex gap-3 justify-center flex-wrap mt-6" />
    </section>
  )
}
