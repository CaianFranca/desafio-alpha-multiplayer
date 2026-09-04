import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary'
type Size = 'md' | 'sm'

const variantClasses: Record<Variant, string> = {
  primary: 'font-display inline-block border-0 rounded-none bg-[var(--color-text)] text-[#0c0c0e] cursor-pointer font-semibold uppercase tracking-[0.12em] text-center hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 transition-opacity',
  secondary: 'font-display inline-block border border-[var(--color-muted)] rounded-none bg-transparent text-[var(--color-text)] cursor-pointer font-semibold uppercase tracking-[0.12em] text-center hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 transition-colors',
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
 * primário (accent sólido) e secundário (borda muted) usado na aplicação.
 * Use `size` para as variações padrão de tamanho e `className` para extras.
 */
export function CtaLink({ to, variant, size = 'md', className, children }: CtaLinkProps) {
  return (
    <Link to={to} className={`${variantClasses[variant]} ${sizeClasses[size]}${className ? ` ${className}` : ''}`}>
      {children}
    </Link>
  )
}
