import { useEffect, useState } from 'react'

/**
 * Limite superior exclusivo para considerar viewport como celular.
 * Igual a Tailwind `md` (768px) e `max-width: 767px` usado em scenes.css.
 */
export const LIMITE_CELULAR_PX = 768

type AoMudarTela = (e: MediaQueryListEvent) => void

type MqlLegado = {
  addListener: (cb: AoMudarTela) => void
  removeListener: (cb: AoMudarTela) => void
}

/**
 * Assina mudanças da media query de tela em retrato.
 * Cobre `addEventListener` moderno e `addListener` legado.
 * Retorna função de cancelamento. (S2)
 */
export function assinarMudancaDeTela(mql: MediaQueryList, cb: AoMudarTela): () => void {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', cb)
    return () => {
      mql.removeEventListener('change', cb)
    }
  }
  const legado = mql as unknown as MqlLegado
  legado.addListener(cb)
  return () => {
    legado.removeListener(cb)
  }
}

function telaEmRetrato(): boolean {
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
  return telaEmRetrato()
}

/**
 * Hook restrito a celular com tela em retrato vertical.
 * Retorna `true` apenas quando `width < 768` e a tela está em retrato,
 * liberando automaticamente em paisagem sem recarregar.
 */
export function useRequerModoPaisagem(): boolean {
  const [requer, setRequer] = useState<boolean>(() => deveExibirOverlay())

  useEffect(() => {
    function atualizar(): void {
      setRequer(deveExibirOverlay())
    }

    // Estado inicial síncrono (caso já tenha mudado entre render e effect)
    atualizar()

    let cancelarAssinatura: (() => void) | null = null

    if (typeof window.matchMedia === 'function') {
      try {
        const mql = window.matchMedia('(orientation: portrait)')
        cancelarAssinatura = assinarMudancaDeTela(mql, () => atualizar())
      } catch {
        cancelarAssinatura = null
      }
    }

    window.addEventListener('resize', atualizar)
    window.addEventListener('orientationchange', atualizar)

    return () => {
      window.removeEventListener('resize', atualizar)
      window.removeEventListener('orientationchange', atualizar)
      cancelarAssinatura?.()
    }
  }, [])

  return requer
}
