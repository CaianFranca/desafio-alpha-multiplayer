import { hero } from './placeholders'
import { AuthActions } from './AuthActions'

export function HeroSection() {
  return (
    <section id="hero" className="hero" aria-labelledby="home-title">
      <p className="eyebrow">{hero.eyebrow}</p>
      <h1 id="home-title">{hero.title}</h1>
      <p className="hero-copy">{hero.copy}</p>
      <AuthActions />
    </section>
  )
}
