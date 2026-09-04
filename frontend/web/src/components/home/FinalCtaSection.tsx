import { useRef } from 'react'
import { finalCta } from './placeholders'
import { AuthActions } from '../auth/AuthActions'
import { useSectionParallax } from '../../hooks/useSectionParallax'

/** Amplitude máxima do deslocamento do parallax (px); a camada tem folga de 14%. */
const PARALLAX_RANGE = 56

export function FinalCtaSection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)

  useSectionParallax(sectionRef, bgRef, PARALLAX_RANGE)

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
