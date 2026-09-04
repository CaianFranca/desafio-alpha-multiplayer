import { useEffect, useRef, useState } from 'react'
import { hero } from './placeholders'
import { AuthActions } from '../auth/AuthActions'

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

  // Parallax sutil do fundo, limitado à seção — mesmo padrão do
  // FinalCtaSection: só anima com a seção visível (rAF + observer), respeita
  // `prefers-reduced-motion` com early-return e desloca só via `transform`.
  useEffect(() => {
    const section = sectionRef.current
    const bg = bgRef.current
    if (!section || !bg) return
    if (typeof window === 'undefined') return
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    let raf = 0
    let inView = false

    const update = () => {
      raf = 0
      if (!inView) return
      const rect = section.getBoundingClientRect()
      const viewport = window.innerHeight || 1
      const progress = (rect.top + rect.height / 2 - viewport / 2) / viewport
      const clamped = Math.max(-1, Math.min(1, progress))
      bg.style.transform = `translate3d(0, ${(clamped * PARALLAX_RANGE).toFixed(1)}px, 0)`
    }

    const schedule = () => {
      if (raf === 0 && inView) raf = window.requestAnimationFrame(update)
    }

    const onScroll = () => schedule()
    const onResize = () => schedule()

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          inView = entries.some((entry) => entry.isIntersecting)
          schedule()
        },
        { threshold: 0 },
      )
      observer.observe(section)
    } else {
      inView = true
      schedule()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [])

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
