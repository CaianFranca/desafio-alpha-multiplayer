import { useEffect, useState } from 'react'
import { DefaultLoadingManager } from 'three'

/** Silêncio sem novos loads para considerar a cena pronta (cobre loads encadeados). */
export const CENA_PRONTA_QUIET_MS = 400
/** Teto anti-travamento: nunca segura os dots além disso. */
export const CENA_PRONTA_TETO_MS = 15000

/**
 * Prontidão dos assets 3D da Partida (texturas + GLTFs via `useLoader` do R3F,
 * que usam o `DefaultLoadingManager`). Sem novas dependências.
 *
 * - Começa `true` (aberto): no jsdom nenhum loader real dispara, então os
 *   testes que esperam o tabuleiro visível seguem verdes sem alteração.
 * - Em produção o `onStart` da Mesa dispara no mount do Canvas — bem antes
 *   do `disponivel` — fechando o gate a tempo.
 * - `onLoad` + silêncio de `CENA_PRONTA_QUIET_MS` libera; erro de asset não
 *   trava (segue para o quiet); o teto garante a liberação.
 */
export function useCenaPronta(): boolean {
  const [pronta, setPronta] = useState(true)

  useEffect(() => {
    const manager = DefaultLoadingManager
    const prevOnStart = manager.onStart
    const prevOnLoad = manager.onLoad
    const prevOnError = manager.onError
    let quietTimer: number | null = null
    let tetoTimer: number | null = null
    let cancelado = false

    const limparQuiet = () => {
      if (quietTimer !== null) {
        window.clearTimeout(quietTimer)
        quietTimer = null
      }
    }
    const agendarQuiet = () => {
      limparQuiet()
      quietTimer = window.setTimeout(() => {
        quietTimer = null
        if (!cancelado) setPronta((anterior) => (anterior ? anterior : true))
      }, CENA_PRONTA_QUIET_MS)
    }

    manager.onStart = (url, loaded, total) => {
      prevOnStart?.(url, loaded, total)
      if (cancelado) return
      limparQuiet()
      setPronta((anterior) => (anterior ? false : anterior))
    }
    manager.onLoad = () => {
      prevOnLoad?.()
      if (!cancelado) agendarQuiet()
    }
    manager.onError = (url) => {
      prevOnError?.(url)
      // Erro não trava os dots: a fila esvazia e o onLoad/quiet libera.
      if (!cancelado) agendarQuiet()
    }
    tetoTimer = window.setTimeout(() => {
      if (!cancelado) setPronta((anterior) => (anterior ? anterior : true))
    }, CENA_PRONTA_TETO_MS)

    return () => {
      cancelado = true
      limparQuiet()
      if (tetoTimer !== null) window.clearTimeout(tetoTimer)
      manager.onStart = prevOnStart
      manager.onLoad = prevOnLoad
      manager.onError = prevOnError
    }
  }, [])

  return pronta
}
