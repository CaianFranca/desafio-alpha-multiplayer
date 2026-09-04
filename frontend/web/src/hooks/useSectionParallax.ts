import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Parallax sutil do fundo, limitado à seção — padrão compartilhado pela Hero
 * e pelo CTA final: só anima com a seção visível (rAF + IntersectionObserver),
 * respeita `prefers-reduced-motion` com early-return e desloca só via
 * `transform`. A camada de fundo precisa de sangria (ex.: `inset: -14% 0`)
 * para acomodar a amplitude sem vazar da seção.
 */
export function useSectionParallax(
  sectionRef: RefObject<HTMLElement | null>,
  bgRef: RefObject<HTMLElement | null>,
  range = 56,
) {
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
      bg.style.transform = `translate3d(0, ${(clamped * range).toFixed(1)}px, 0)`
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
  }, [sectionRef, bgRef, range])
}
