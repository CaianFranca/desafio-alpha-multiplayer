import { useEffect, useRef, useState } from 'react'
import { hero } from './placeholders'
import { AuthActions } from '../auth/AuthActions'
import { useSectionParallax } from '../../hooks/useSectionParallax'

/** Amplitude máxima do deslocamento do parallax (px); a camada tem folga de 14%. */
const PARALLAX_RANGE = 56

export function HeroSection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)
  // Sem IntersectionObserver (ex.: jsdom, ambientes sem suporte), nasce
  // revelado — fallback estático sem JS/observer com conteúdo visível.
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  // Reveal único de entrada (eyebrow → título → copy → CTAs): observa a seção
  // uma vez e revela; sem IntersectionObserver o estado inicial já é revelado
  // (fallback estático). O estado inicial oculto só existe via JS — sem
  // JS/observer o conteúdo segue visível.
  useEffect(() => {
    if (revealed) return
    const section = sectionRef.current
    if (!section) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0 },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [revealed])

  // Parallax sutil do fundo, limitado à seção (hook compartilhado com o
  // CTA final): só anima com a seção visível, respeita
  // `prefers-reduced-motion` e desloca só via `transform`.
  useSectionParallax(sectionRef, bgRef, PARALLAX_RANGE)

  const revealState = revealed ? 'is-visible' : 'is-hidden'

  return (
    <section ref={sectionRef} id="hero" className="relative overflow-hidden" aria-labelledby="home-title">
      <div ref={bgRef} className="hero-media" aria-hidden="true" />
      <div className="relative max-w-4xl text-center mx-auto py-[clamp(4rem,15vh,8rem)] px-8">
        <p className={`hero-reveal ${revealState} hero-delay-eyebrow flex items-center justify-center gap-4 text-(--color-accent) text-xs font-bold tracking-[.22em] uppercase`}>
          <span className="inline-block h-px w-12 bg-(--color-accent)/70" aria-hidden="true" />
          {hero.eyebrow}
          <span className="inline-block h-px w-12 bg-(--color-accent)/70" aria-hidden="true" />
        </p>
        <h1 id="home-title" className={`hero-reveal ${revealState} hero-delay-title my-4 text-[clamp(2.5rem,8vw,5rem)] leading-[.95] uppercase tracking-[.06em]`}>{hero.title}</h1>
        <p className={`hero-reveal ${revealState} hero-delay-copy text-(--color-text) text-lg leading-relaxed font-display`}>{hero.copy}</p>
        <AuthActions className={`hero-reveal ${revealState} hero-delay-ctas flex gap-3 justify-center flex-wrap mt-6`} />
      </div>
    </section>
  )
}
