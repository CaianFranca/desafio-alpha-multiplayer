import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { features } from './placeholders'
import { FeatureCard } from './FeatureCard'
import { comBase } from '../../api/basePath'

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

const ICONE_FALLBACK = comBase('/assets/explore_icon.svg')

const featureIcons: Record<(typeof features.items)[number]['title'], string> = {
  'Cooperação': comBase('/assets/group_icon.svg'),
  'O tabuleiro vivo': comBase('/assets/explore_icon.svg'),
  'Iluminação & visibilidade': comBase('/assets/visibility_icon.svg'),
  'Salas estratégicas': comBase('/assets/psychologt_icon.svg'),
  'Ameaças sobrenaturais': comBase('/assets/sound_detection_glass_break_icon.svg'),
}

function FeaturesRevealItem({ index, children }: { index: number; children: ReactNode }) {
  const { ref, revealState } = useReveal<HTMLLIElement>()
  const spanClass = index < 3 ? 'md:col-span-2' : index === 3 ? 'md:col-span-4' : 'md:col-span-2'
  return (
    <li
      ref={ref}
      style={{ transitionDelay: `${index * 90}ms`, animationDelay: `${index * 90}ms` }}
      className={`features-reveal ${revealState} ${spanClass} w-full`}
    >
      {children}
    </li>
  )
}

export function FeaturesSection() {
  const { ref: titleRef, revealState: titleState } = useReveal<HTMLHeadingElement>()

  return (
    <section id={features.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-surface" aria-labelledby="features-title">
      <div className="max-w-7xl mx-auto">
        <h2 ref={titleRef} id="features-title" className={`features-eyebrow features-reveal ${titleState}`}>{features.title}</h2>
        <ul className="features-grid grid grid-cols-1 md:grid-cols-6 gap-8 list-none m-0 p-0" role="list">
          {features.items.map((item, index) => (
            <FeaturesRevealItem key={item.title} index={index}>
              <FeatureCard title={item.title} description={item.description} iconSrc={featureIcons[item.title] ?? ICONE_FALLBACK} />
            </FeaturesRevealItem>
          ))}
        </ul>
      </div>
    </section>
  )
}
