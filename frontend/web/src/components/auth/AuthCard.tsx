import type { ReactNode } from 'react'

interface AuthCardProps {
  title: string
  subtitle: string
  children: ReactNode
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-[var(--color-surface)] border border-white/10 rounded-xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-center">{title}</h1>
        <p className="text-sm text-[var(--color-muted)] text-center mt-2">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}
