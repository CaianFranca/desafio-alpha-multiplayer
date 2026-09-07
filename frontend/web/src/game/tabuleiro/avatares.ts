/**
 * Avatares 3D dos peões (issues #297 e #300, spec #296).
 *
 * Seam puro: slot → par de GLBs (aceso/apagado) cobrindo os 4 slots de
 * `CORES_DOS_PEOES` (ordem = slot). Os slots 0 (`branco` — Diretor) e
 * 1 (`vermelho` — Enfermeira) têm avatar nesta etapa; os demais seguem no
 * `PeaoPlaceholder` (issues #299 e #301).
 * Os GLBs vivem em `web/public/assets/` (servidos sob
 * `import.meta.env.BASE_URL + assets/…`, empacotados no `dist` via
 * `publicDir` — ver `frontend/vite.config.ts`), no mesmo precedente de
 * `texturasDasPecas`. Sem three.js/DOM: só URLs e slot — testável em jsdom.
 */

import type { CorDoPeao } from './contrato'
import { CORES_DOS_PEOES } from './contrato'

export interface AvatarConfig {
  /** GLB do avatar em iluminação normal (state aceso). */
  readonly urlAcesa: string
  /** GLB do avatar em Baixa Iluminação do jogador dono (state apagado). */
  readonly urlApagada: string
}

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Mapa slot → par de GLBs. Slot = índice em `CORES_DOS_PEOES` (espelho do
 * engine `packages/engine/src/tabuleiro.ts`, mesmo critério de "ordem de
 * entrada"); preenchidos os slots 0 (Diretor/branco) e 1
 * (Enfermeira/vermelho) nesta etapa.
 */
export const AVATARES_POR_SLOT: ReadonlyMap<number, AvatarConfig> = new Map([
  [
    0,
    {
      urlAcesa: `${baseAssets()}assets/diretor_base_acesa.glb`,
      urlApagada: `${baseAssets()}assets/diretor_base_apagado.glb`,
    },
  ],
  [
    1,
    {
      urlAcesa: `${baseAssets()}assets/enfermeira_base_acesa.glb`,
      urlApagada: `${baseAssets()}assets/enfermeira_base_apagada.glb`,
    },
  ],
])

/** Slot de um peão pela cor (índice em `CORES_DOS_PEOES`). */
export function slotDoAvatar(cor: CorDoPeao): number {
  return CORES_DOS_PEOES.indexOf(cor)
}

/** Há avatar 3D neste slot? (senão → placeholder de primitivas). */
export function temAvatarNoSlot(slot: number): boolean {
  return AVATARES_POR_SLOT.has(slot)
}
