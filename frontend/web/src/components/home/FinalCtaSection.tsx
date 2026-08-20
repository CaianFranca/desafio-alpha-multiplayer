import { finalCta } from './placeholders'
import { AuthActions } from './AuthActions'

export function FinalCtaSection() {
  return (
    <section className="section final-cta" aria-labelledby="final-cta-title">
      <div className="section-inner">
        <h2 id="final-cta-title" className="section-title">{finalCta.title}</h2>
        <p className="section-subtitle">{finalCta.copy}</p>
        <AuthActions />
      </div>
    </section>
  )
}
