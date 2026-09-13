import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { finalCta } from './placeholders'
import { AuthActions } from '../auth/AuthActions'
import { useSectionParallax } from '../../hooks/useSectionParallax'
import { comBase } from '../../api/basePath'

/** Fundo do CTA final já com o subpath do build (VITE_BASE_PATH). */
const CTA_IMAGE = `url("${comBase('/assets/imagem_fundo_hero.webp')}")`

/** Amplitude máxima do deslocamento do parallax (px); a camada tem folga de 14%. */
const PARALLAX_RANGE = 56

export function FinalCtaSection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)

  useSectionParallax(sectionRef, bgRef, PARALLAX_RANGE)

  return (
    <section ref={sectionRef} className="relative overflow-hidden py-[clamp(3rem,8vh,6rem)] px-8 text-center bg-background" aria-labelledby="final-cta-title">
      <div
        ref={bgRef}
        className="final-cta-media"
        aria-hidden="true"
        style={{ '--scene-hero-image': CTA_IMAGE } as CSSProperties}
      />
      <div className="relative max-w-7xl mx-auto">
        <h2 id="final-cta-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2 uppercase tracking-[.06em]">{finalCta.title}</h2>
        <p className="text-text text-lg text-center mb-8 font-display">{finalCta.copy}</p>
        <AuthActions className="flex gap-3 justify-center flex-wrap" />
      </div>
    </section>
  )
}
