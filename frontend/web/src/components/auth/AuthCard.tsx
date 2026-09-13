import type { CSSProperties, ReactNode } from 'react'
import { comBase } from '../../api/basePath'

/** Fundo das telas de auth já com o subpath do build (VITE_BASE_PATH). */
const AUTH_IMAGE = `url("${comBase('/assets/imagem_fundo_cadastro_login.png')}")`

interface AuthCardProps {
  title: string
  subtitle: string
  children: ReactNode
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="relative foundation-scope min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-12">
      <div
        className="auth-media"
        aria-hidden="true"
        style={{ '--scene-auth-image': AUTH_IMAGE } as CSSProperties}
      />
      <div className="auth-card max-w-md w-full p-8 sm:p-10">
        <h1 className="text-3xl font-bold text-center tracking-wide">{title}</h1>
        <p className="text-base text-muted text-center mt-2">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}
