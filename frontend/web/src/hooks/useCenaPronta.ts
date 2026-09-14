import { useEffect, useRef, useState } from 'react'
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
 * - Re-arme (`temConteudo`): os loads das peças só começam quando o snapshot
 *   chega — se o quiet da Mesa já esvaziou antes, a chegada do conteúdo
 *   fecha o gate de novo. Sem isso o latch liberaria antes das peças
 *   baixarem (pop-in progressivo). Com tudo em cache, o quiet libera em
 *   400ms sem travar.
 *
 * @param temConteudo `estadoExibicao !== null` — a cena tem o que carregar.
 */
export function useCenaPronta(temConteudo: boolean): boolean {
  const [pronta, setPronta] = useState(true)
  // Pendentes na fila do manager (o three não expõe `isLoading()`).
  const pendentesRef = useRef(0)
  const quietTimerRef = useRef<number | null>(null)
  const viuConteudoRef = useRef(false)

  // Assinatura do manager (montagem).
  useEffect(() => {
    const manager = DefaultLoadingManager
    const prevOnStart = manager.onStart
    const prevOnLoad = manager.onLoad
    const prevOnProgress = manager.onProgress
    const prevOnError = manager.onError
    let tetoTimer: number | null = null
    let cancelado = false

    const limparQuiet = () => {
      if (quietTimerRef.current !== null) {
        window.clearTimeout(quietTimerRef.current)
        quietTimerRef.current = null
      }
    }
    const agendarQuiet = () => {
      limparQuiet()
      quietTimerRef.current = window.setTimeout(() => {
        quietTimerRef.current = null
        if (!cancelado) setPronta((anterior) => (anterior ? anterior : true))
      }, CENA_PRONTA_QUIET_MS)
    }

    manager.onStart = (url, loaded, total) => {
      prevOnStart?.(url, loaded, total)
      if (cancelado) return
      pendentesRef.current = total - loaded
      limparQuiet()
      setPronta((anterior) => (anterior ? false : anterior))
    }
    manager.onProgress = (url, loaded, total) => {
      prevOnProgress?.(url, loaded, total)
      if (cancelado) return
      pendentesRef.current = total - loaded
    }
    manager.onLoad = () => {
      prevOnLoad?.()
      if (cancelado) return
      pendentesRef.current = 0
      agendarQuiet()
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
      manager.onProgress = prevOnProgress
      manager.onError = prevOnError
    }
  }, [])

  // Re-arme na chegada do conteúdo (mão única).
  useEffect(() => {
    if (!temConteudo || viuConteudoRef.current) return
    viuConteudoRef.current = true
    setPronta((anterior) => (anterior ? false : anterior))
    if (pendentesRef.current === 0) {
      // Nada em voo (tudo em cache): o quiet libera rápido sem travar.
      // Com loads em voo, o `onLoad` agenda o quiet.
      if (quietTimerRef.current !== null) window.clearTimeout(quietTimerRef.current)
      quietTimerRef.current = window.setTimeout(() => {
        quietTimerRef.current = null
        setPronta((anterior) => (anterior ? anterior : true))
      }, CENA_PRONTA_QUIET_MS)
    }
  }, [temConteudo])

  return pronta
}
