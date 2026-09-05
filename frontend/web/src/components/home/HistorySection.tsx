import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { history } from './placeholders'

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  // Sem IntersectionObserver (ex.: jsdom, ambientes sem suporte), nasce
  // revelado — fallback estático sem JS/observer com conteúdo visível.
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  // Reveal único de entrada por elemento: observa o próprio nó uma vez e
  // revela; sem IntersectionObserver o estado inicial já é revelado
  // (fallback estático). O estado inicial oculto só existe via JS — sem
  // JS/observer o conteúdo segue visível. Espelha o padrão da TrailersSection.
  useEffect(() => {
    if (revealed) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [revealed])

  return { ref, revealState: revealed ? 'is-visible' : 'is-hidden' }
}

function HistoryRevealItem({ index, children }: { index: number; children: ReactNode }) {
  const { ref, revealState } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 90}ms` }}
      className={`history-reveal ${revealState}`}
    >
      {children}
    </div>
  )
}

export function HistorySection() {
  return (
    <section id={history.id} className="py-[clamp(3rem,8vh,6rem)] px-8" aria-labelledby="history-title">
      <div className="max-w-7xl mx-auto grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-12">
        <HistoryRevealItem index={0}>
          <div className="history-media">
            <img src="/assets/story_image.png" alt={history.imageAlt} className="history-kenburns" />
          </div>
        </HistoryRevealItem>
        <HistoryRevealItem index={1}>
          <h2 id="history-title" className="history-eyebrow">{history.title}</h2>
          {history.paragraphs.map((p, i) => (
            <p key={i} className="text-muted leading-7 mb-4 last:mb-0">{p}</p>
          ))}
        </HistoryRevealItem>
      </div>
    </section>
  )
}
