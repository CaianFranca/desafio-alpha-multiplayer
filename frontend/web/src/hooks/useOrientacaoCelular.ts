import { useEffect, useState } from 'react'

/**
 * Limite superior exclusivo para considerar viewport como celular.
 * Igual a Tailwind `md` (768px) e `max-width: 767px` usado em scenes.css.
 */
export const LIMITE_CELULAR_PX = 768

function isPortrait(): boolean {
  if (typeof window === 'undefined') return false
  // Tenta matchMedia primeiro; fallback para comparação geométrica.
  if (typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(orientation: portrait)').matches
    } catch {
      // fallback abaixo
    }
  }
  return window.innerHeight > window.innerWidth
}

function deveExibirOverlay(): boolean {
  if (typeof window === 'undefined') return false
  const isCelular = window.innerWidth < LIMITE_CELULAR_PX
  if (!isCelular) return false
  return isPortrait()
}

/**
 * Hook restrito a celular em Portrait.
 * Retorna `true` apenas quando `width < 768` e orientação é portrait,
 * liberando automaticamente em landscape sem recarregar.
 */
export function useRequerOrientacaoLandscape(): boolean {
  const [requer, setRequer] = useState<boolean>(() => deveExibirOverlay())

  useEffect(() => {
    function atualizar(): void {
      setRequer(deveExibirOverlay())
    }

    // Estado inicial síncrono (caso já tenha mudado entre render e effect)
    atualizar()

    let mql: MediaQueryList | null = null
    let onMqlChange: ((e: MediaQueryListEvent) => void) | null = null

    if (typeof window.matchMedia === 'function') {
      try {
        mql = window.matchMedia('(orientation: portrait)')
        onMqlChange = () => atualizar()
        // addEventListener é moderno; addListener é fallback legado.
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', onMqlChange)
        } else {
          ;(mql as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(
            onMqlChange,
          )
        }
      } catch {
        mql = null
      }
    }

    window.addEventListener('resize', atualizar)
    window.addEventListener('orientationchange', atualizar)

    return () => {
      window.removeEventListener('resize', atualizar)
      window.removeEventListener('orientationchange', atualizar)
      if (mql && onMqlChange) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', onMqlChange)
        } else {
          ;(mql as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener(
            onMqlChange,
          )
        }
      }
    }
  }, [])

  return requer
}
