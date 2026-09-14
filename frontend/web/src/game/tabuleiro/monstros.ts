/**
 * Modelos 3D das peças de Monstro (vulto/espectro).
 *
 * Seam puro: tipo de monstro → URL do GLB, no mesmo precedente dos avatares
 * dos peões (`avatares.ts`) e dos modelos da Caixa (`modelosDaCaixa`). Os
 * GLBs vivem em `web/public/assets/3d-models/` (servidos sob
 * `import.meta.env.BASE_URL + assets/3d-models/…`, empacotados no `dist` via
 * `publicDir` — ver `frontend/vite.config.ts`). Sem three.js/DOM: só URLs —
 * testável em jsdom. A base da peça segue inalterada (`PecaPlaceholder`); o
 * modelo aparece sobre ela e o clique no modelo equivale ao clique na peça.
 */

import type { TipoDaPeca } from './contrato'

/** Tipos de peça que têm modelo 3D (Monstros). */
export type TipoDeMonstro = 'vulto' | 'espectro'

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** Mapa tipo de monstro → URL do GLB. */
export const MODELOS_DE_MONSTRO: Record<TipoDeMonstro, string> = {
  vulto: `${baseAssets()}assets/3d-models/vulto.glb`,
  espectro: `${baseAssets()}assets/3d-models/espectro.glb`,
}

/** Há modelo 3D para este tipo de peça? (só Monstros). */
export function temModeloDeMonstro(tipo: TipoDaPeca): tipo is TipoDeMonstro {
  return tipo === 'vulto' || tipo === 'espectro'
}

/** URL do GLB do monstro (espelha `modeloDaCaixa`). */
export function urlDoModeloDeMonstro(tipo: TipoDeMonstro): string {
  return MODELOS_DE_MONSTRO[tipo]
}
