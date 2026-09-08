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

type ObjectiveIcon = (typeof objectives.items)[number]['icon']

// Nós-ícone da timeline: círculos de conquista do HUD sempre no estado
// APAGADO (a home anuncia objetivos, não progresso). Glifos ⚡/▣ reaproveitados
// do HudDaPartida; o Portão usa o asset door_open_icon.svg já existente.
const OBJECTIVE_NODES: Record<ObjectiveIcon, { label: string; content: ReactNode }> = {
  geradores: {
    label: 'Geradores',
    content: <span aria-hidden="true">⚡</span>,
  },
  cartao: {
    label: 'Cartão de Acesso',
    content: <span aria-hidden="true">▣</span>,
  },
  portao: {
    label: 'Portão de Saída',
    content: (
      <img
        src="/assets/door_open_icon.svg"
        alt=""
        aria-hidden="true"
        className="objectives-item-node-icon"
      />
    ),
  },
}

export function ObjectivesSection() {
  return (
    <section id={objectives.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-background" aria-labelledby="objectives-title">
      <div className="max-w-4xl mx-auto">
        <h2 id="objectives-title" className="objectives-eyebrow">{objectives.title}</h2>
        <ul className="objectives-timeline list-none m-0 p-0 flex flex-col">
          {objectives.items.map((item, index) => (
            <ObjectivesRevealItem key={item.title} index={index}>
              <div className={`objectives-item${index % 2 === 1 ? ' is-flipped' : ''}`}>
                <div className="objectives-item-text-wrap">
                  <h3 className="objectives-item-title">{item.title}</h3>
                  <p className="objectives-item-desc">{item.description}</p>
                </div>
                <div
                  className="objectives-item-node border-dashed border-zinc-700 bg-zinc-900/60 text-zinc-600 opacity-40"
                  role="img"
                  aria-label={OBJECTIVE_NODES[item.icon].label}
                >
                  {OBJECTIVE_NODES[item.icon].content}
                </div>
                <div className="objectives-item-media">
                  <img src={item.image} alt={item.imageAlt} className="objectives-image" />
                </div>
              </div>
            </ObjectivesRevealItem>
          ))}
        </ul>
      </div>
    </section>
  )
}
