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

// Nós-ícone da timeline: círculos de conquista do HUD no estilo ACESO
// (máximo contraste — o apagado ficava ilegível sobre o fundo). Glifos ⚡/▣
// reaproveitados do HudDaPartida; o Portão usa o asset door_open_icon.svg
// já existente, com o estilo aceso da Proteção (terceiro estilo "aceso" do
// HUD, distinto do âmbar dos Geradores e do esmeralda do Cartão).
const OBJECTIVE_NODES: Record<ObjectiveIcon, { label: string; className: string; content: ReactNode }> = {
  geradores: {
    label: 'Geradores',
    className:
      'border-solid border-amber-300 bg-amber-400/15 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.5)]',
    content: <span aria-hidden="true">⚡</span>,
  },
  cartao: {
    label: 'Cartão de Acesso',
    className:
      'border-solid border-emerald-300 bg-emerald-400/15 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.5)]',
    content: <span aria-hidden="true">▣</span>,
  },
  portao: {
    label: 'Portão de Saída',
    className:
      'border-solid border-cyan-400/70 bg-cyan-400/10 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.35)]',
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
          {objectives.items.map((item, index) => {
            // Fallback defensivo: typo em `placeholders.ts` não quebra o runtime.
            const node = OBJECTIVE_NODES[item.icon] ?? OBJECTIVE_NODES.geradores
            return (
            <ObjectivesRevealItem key={item.title} index={index}>
              <div className={`objectives-item${index % 2 === 1 ? ' is-flipped' : ''}`}>
                <div className="objectives-item-text-wrap">
                  <h3 className="objectives-item-title">{item.title}</h3>
                  <p className="objectives-item-desc">{item.description}</p>
                </div>
                <div
                  className={`objectives-item-node ${node.className}`}
                  role="img"
                  aria-label={node.label}
                >
                  {node.content}
                </div>
                <div className="objectives-item-media">
                  <img src={item.image} alt={item.imageAlt} className="objectives-image" />
                </div>
              </div>
            </ObjectivesRevealItem>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
