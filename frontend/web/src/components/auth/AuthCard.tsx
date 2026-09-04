import type { ReactNode } from 'react'

interface AuthCardProps {
  title: string
  subtitle: string
  children: ReactNode
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="foundation-scope min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-[var(--color-surface)] border border-white/10 rounded-xl p-8 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
        <h1 className="text-2xl font-semibold text-center tracking-wide">{title}</h1>
        <p className="text-sm text-[var(--color-muted)] text-center mt-2 font-display">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}
