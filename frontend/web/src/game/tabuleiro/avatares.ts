/**
 * Avatares 3D dos peões (issues #297, #300 e #301, spec #296).
 *
 * Seam puro: slot → par de GLBs (aceso/apagado) cobrindo os 4 slots de
 * `CORES_DOS_PEOES` (ordem = slot). Os slots 0 (`branco` — Diretor),
 * 1 (`vermelho` — Enfermeira) e 2 (`azul` — Janitor) têm avatar nesta etapa;
 * apenas o slot 3 (`amarelo` — Paciente, issue #299) segue no
 * `PeaoPlaceholder`.
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
 * entrada"); preenchidos os slots 0 (Diretor/branco), 1
 * (Enfermeira/vermelho) e 2 (Janitor/azul) nesta etapa.
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
  [
    2,
    {
      urlAcesa: `${baseAssets()}assets/janitor_base_aceso.glb`,
      urlApagada: `${baseAssets()}assets/janitor_base_apagado.glb`,
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
