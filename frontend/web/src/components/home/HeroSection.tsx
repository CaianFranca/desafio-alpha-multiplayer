import { hero } from './placeholders'
import { AuthActions } from '../auth/AuthActions'

export function HeroSection() {
  return (
    <section id="hero" className="relative overflow-hidden" aria-labelledby="home-title">
      <div className="hero-media" aria-hidden="true" />
      <div className="relative max-w-4xl text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8">
        <p className="flex items-center justify-center gap-4 text-(--color-accent) text-xs font-bold tracking-[.22em] uppercase">
          <span className="inline-block h-px w-12 bg-(--color-accent)/70" aria-hidden="true" />
          {hero.eyebrow}
          <span className="inline-block h-px w-12 bg-(--color-accent)/70" aria-hidden="true" />
        </p>
        <h1 id="home-title" className="my-4 text-[clamp(2.5rem,8vw,5rem)] leading-[.95] uppercase tracking-[.06em]">{hero.title}</h1>
        <p className="text-(--color-text) text-lg leading-relaxed font-display">{hero.copy}</p>
        <AuthActions className="flex gap-3 justify-center flex-wrap mt-6" />
      </div>
    </section>
  )
}
