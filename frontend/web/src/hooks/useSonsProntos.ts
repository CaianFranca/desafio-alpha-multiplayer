/**
 * Prontidão dos sons da partida para o gate da revelação.
 *
 * Dispara o aquecimento (`fetch` + consumo do corpo) no mount da página e
 * resolve `true` quando todos os sons assentarem (baixados ou falhados —
 * falha abre com silêncio, nunca trava). Sem ambiente com rede de mídia
 * (jsdom/SSR) nasce `true`: sem `fetch`, sem update pós-render.
 */

import { useEffect, useState } from 'react'
import { aquecerSons, semRedeDeMidia } from '../game/assets/preloadDeAssets'

export function useSonsProntos(): boolean {
  const [prontos, setProntos] = useState(() => semRedeDeMidia())
  useEffect(() => {
    if (semRedeDeMidia()) return
    let vivo = true
    void aquecerSons().then(() => {
      if (vivo) setProntos(true)
    })
    return () => {
      vivo = false
    }
  }, [])
  return prontos
}
