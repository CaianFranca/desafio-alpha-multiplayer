import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary'
type Size = 'md' | 'sm'

const variantClasses: Record<Variant, string> = {
  primary: 'cta-primary font-display inline-block rounded-none cursor-pointer font-semibold uppercase tracking-[0.12em] text-center hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 transition-opacity',
  secondary: 'cta-secondary font-display inline-block rounded-none cursor-pointer font-semibold uppercase tracking-[0.12em] text-center focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 transition-colors',
}

const sizeClasses: Record<Size, string> = {
  md: 'px-5 py-3',
  sm: 'px-4 py-2 text-sm',
}

interface CtaLinkProps {
  to: string
  variant: Variant
  size?: Size
  className?: string
  children: ReactNode
}

/**
 * Primitiva compartilhada de chamada à ação: concentra o vocabulário visual
 * primário (preenchimento claro com texto escuro) e secundário (borda muted
 * com texto claro) usado na Hero/CTA final. As cores vivem nas classes
 * dedicadas `.cta-primary`/`.cta-secondary` em `styles/global.css` (valores
 * explícitos, fora de camadas, após o reset `a`) — não só em utilidades do
 * Tailwind, que perdem para o reset na cascata por camadas.
 * Use `size` para as variações padrão de tamanho e `className` para extras.
 */
export function CtaLink({ to, variant, size = 'md', className, children }: CtaLinkProps) {
  return (
    <Link to={to} className={`${variantClasses[variant]} ${sizeClasses[size]}${className ? ` ${className}` : ''}`}>
      {children}
    </Link>
  )
}
