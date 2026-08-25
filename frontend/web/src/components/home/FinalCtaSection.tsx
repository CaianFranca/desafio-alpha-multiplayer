import { finalCta } from './placeholders'
import { AuthActions } from '../auth/AuthActions'

export function FinalCtaSection() {
  return (
    <section className="py-[clamp(3rem,8vh,6rem)] px-8 text-center bg-(--color-surface)" aria-labelledby="final-cta-title">
      <div className="max-w-7xl mx-auto">
        <h2 id="final-cta-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2">{finalCta.title}</h2>
        <p className="text-(--color-muted) text-center mb-8">{finalCta.copy}</p>
        <AuthActions className="flex gap-3 justify-center flex-wrap" />
      </div>
    </section>
  )
}
