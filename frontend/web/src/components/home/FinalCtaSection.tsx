import { useEffect, useRef } from 'react'
import { finalCta } from './placeholders'
import { AuthActions } from '../auth/AuthActions'

/** Amplitude máxima do deslocamento do parallax (px); a camada tem folga de 14%. */
const PARALLAX_RANGE = 56

export function FinalCtaSection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)

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

    // Mesmo padrão de observação do TrailersSection: só anima com a seção visível.
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

  return (
    <section ref={sectionRef} className="relative overflow-hidden py-[clamp(3rem,8vh,6rem)] px-8 text-center bg-(--color-background)" aria-labelledby="final-cta-title">
      <div ref={bgRef} className="final-cta-media" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto">
        <h2 id="final-cta-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2 uppercase tracking-[.06em]">{finalCta.title}</h2>
        <p className="text-(--color-text) text-center mb-8 font-display">{finalCta.copy}</p>
        <AuthActions className="flex gap-3 justify-center flex-wrap" />
      </div>
    </section>
  )
}
