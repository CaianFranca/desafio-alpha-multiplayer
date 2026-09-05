import { useEffect, useState } from 'react'

/**
 * Espelha `prefers-reduced-motion: reduce`.
 * Com reduce ativo, as transições (limpeza fade+encolher, encaixe, voo, slide)
 * fazem snap instantâneo pixel-igual ao estado sem animação (spec #238).
 */
export function usePrefersReducedMotion(): boolean {
  const [prefereReduzido, setPrefereReduzido] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (event: MediaQueryListEvent) => setPrefereReduzido(event.matches)
    if (query.addEventListener) query.addEventListener('change', handler)
    else query.addListener(handler as unknown as (e: MediaQueryListEvent) => void)
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', handler)
      else query.removeListener(handler as unknown as (e: MediaQueryListEvent) => void)
    }
  }, [])

  return prefereReduzido
}

export function deveReduzirMovimento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
