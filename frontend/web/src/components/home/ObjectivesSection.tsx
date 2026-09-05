import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { objectives } from './placeholders'

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

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

function ObjectivesRevealItem({ index, children }: { index: number; children: ReactNode }) {
  const { ref, revealState } = useReveal<HTMLLIElement>()
  return (
    <li
      ref={ref}
      style={{ transitionDelay: `${index * 90}ms` }}
      className={`objectives-reveal ${revealState}`}
    >
      {children}
    </li>
  )
}

export function ObjectivesSection() {
  return (
    <section id={objectives.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-background" aria-labelledby="objectives-title">
      <div className="max-w-4xl mx-auto">
        <h2 id="objectives-title" className="objectives-eyebrow">{objectives.title}</h2>
        <ol className="objectives-timeline list-none m-0 p-0 flex flex-col">
          {objectives.items.map((item, index) => (
            <ObjectivesRevealItem key={item.title} index={index}>
              <div className={`objectives-item${index % 2 === 1 ? ' is-flipped' : ''}`}>
                <div className="objectives-item-text-wrap">
                  <h3 className="objectives-item-title">{item.title}</h3>
                  <p className="objectives-item-desc">{item.description}</p>
                </div>
                <div className="objectives-item-node">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="objectives-item-media">
                  <img src={item.image} alt={item.imageAlt} className="objectives-image" />
                </div>
              </div>
            </ObjectivesRevealItem>
          ))}
        </ol>
      </div>
    </section>
  )
}
