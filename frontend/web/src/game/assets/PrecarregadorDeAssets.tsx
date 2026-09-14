/**
 * Disparo do preload 3D dentro do `<Canvas>` (primeiro filho).
 *
 * Montar aqui — e não na página — é o que mantém os testes intactos: no
 * jsdom o Canvas renderiza só o `fallback` (sem WebGL) e este efeito nunca
 * roda, então nenhum loader real dispara (sem rede, sem poluir o
 * `DefaultLoadingManager` global). Em produção o Canvas monta junto com a
 * página — bem antes do snapshot — e o download total corre em paralelo com
 * a espera do WebSocket (`aguardando`).
 */

import { useEffect } from 'react'
import { precarregarTexturasEGlb } from './preloadDeAssets'

export function PrecarregadorDeAssets() {
  useEffect(() => {
    precarregarTexturasEGlb()
  }, [])
  return null
}
