import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary'
type Size = 'md' | 'sm'

const variantClasses: Record<Variant, string> = {
  primary: 'inline-block border-0 rounded-lg bg-[var(--color-accent)] text-gray-800 cursor-pointer font-sans font-bold text-center hover:opacity-90 transition-opacity',
  secondary: 'inline-block border-2 border-(--color-muted) rounded-lg bg-transparent text-(--color-muted) cursor-pointer font-sans font-semibold text-center hover:border-white hover:text-white transition-colors',
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
