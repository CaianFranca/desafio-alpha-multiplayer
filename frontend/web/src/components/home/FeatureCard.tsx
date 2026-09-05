import { useState } from 'react'
import type { CSSProperties } from 'react'

interface FeatureCardProps {
  title: string
  description: string
  iconSrc: string
}

interface Acabamento {
  cardStyle: CSSProperties
  badgeStyle: CSSProperties
}

// Acabamento estático por montagem: tilt do card [-2.5deg, 2.5deg], tilt do
// selo [-9deg, 9deg] e uma largura por lado [3px, 6px]. Sorteio único via
// `useState` inicial — estável entre re-renders, sem nova aleatoriedade e
// sem efeito no reveal (que vive no `li` externo).
function sortearAcabamento(): Acabamento {
  const tiltCard = Math.random() * 5 - 2.5
  const tiltBadge = Math.random() * 18 - 9
  const sortearLado = () => Math.random() * 3 + 3
  return {
    cardStyle: {
      transform: `rotate(${tiltCard.toFixed(2)}deg)`,
      borderTopWidth: `${sortearLado().toFixed(1)}px`,
      borderRightWidth: `${sortearLado().toFixed(1)}px`,
      borderBottomWidth: `${sortearLado().toFixed(1)}px`,
      borderLeftWidth: `${sortearLado().toFixed(1)}px`,
    },
    badgeStyle: {
      transform: `rotate(${tiltBadge.toFixed(2)}deg)`,
    },
  }
}

export function FeatureCard({ title, description, iconSrc }: FeatureCardProps) {
  const [acabamento] = useState(sortearAcabamento)
  return (
    <div className="features-card" style={acabamento.cardStyle}>
      <span aria-hidden="true" className="features-badge" style={acabamento.badgeStyle}>
        <img src={iconSrc} alt="" aria-hidden="true" draggable={false} className="features-badge-icon" />
      </span>
      <h3 className="text-xl mt-4 mb-2">{title}</h3>
      <p className="text-muted text-sm leading-relaxed m-0">{description}</p>
    </div>
  )
}
