/**
 * Avatares 3D dos peões (issues #297, #300, #301 e #299, spec #296).
 *
 * Seam puro: slot → par de GLBs (aceso/apagado) cobrindo os 4 slots de
 * `CORES_DOS_PEOES` (ordem = slot). Os slots 0 (`branco` — Diretor),
 * 1 (`vermelho` — Enfermeira), 2 (`azul` — Janitor) e 3 (`amarelo` —
 * Paciente) têm avatar nesta etapa.
 * Os GLBs vivem em `web/public/assets/3d-models/` (servidos sob
 * `import.meta.env.BASE_URL + assets/3d-models/…`, empacotados no `dist` via
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
 * (Enfermeira/vermelho), 2 (Janitor/azul) e 3 (Paciente/amarelo) nesta etapa.
 */
export const AVATARES_POR_SLOT: ReadonlyMap<number, AvatarConfig> = new Map([
  [
    0,
    {
      urlAcesa: `${baseAssets()}assets/3d-models/diretor_base_acesa.glb`,
      urlApagada: `${baseAssets()}assets/3d-models/diretor_base_apagado.glb`,
    },
  ],
  [
    1,
    {
      urlAcesa: `${baseAssets()}assets/3d-models/enfermeira_base_acesa.glb`,
      urlApagada: `${baseAssets()}assets/3d-models/enfermeira_base_apagada.glb`,
    },
  ],
  [
    2,
    {
      urlAcesa: `${baseAssets()}assets/3d-models/janitor_base_aceso.glb`,
      urlApagada: `${baseAssets()}assets/3d-models/janitor_base_apagado.glb`,
    },
  ],
  [
    3,
    {
      urlAcesa: `${baseAssets()}assets/3d-models/paciente_base_aceso.glb`,
      urlApagada: `${baseAssets()}assets/3d-models/paciente_base_apagado.glb`,
    },
  ],
])

/**
 * Fotos 2D dos avatares para o HUD da Partida (issue #404).
 *
 * Seam puro: slot → URL do PNG (versão acesa fixa, sem variação por Baixa
 * Iluminação/Amedrontado — os estados seguem só nos indicadores do HUD). Os
 * PNGs vivem em `web/public/assets/avatars/` (servidos sob
 * `import.meta.env.BASE_URL + assets/avatars/…`, empacotados no `dist` via
 * `publicDir` — mesmo precedente dos GLBs acima). Sem three.js/DOM: só URLs
 * e slot — testável em jsdom.
 */
export const FOTOS_DOS_AVATARES_POR_SLOT: ReadonlyMap<number, string> =
  new Map([
    [0, `${baseAssets()}assets/avatars/diretor.png`],
    [1, `${baseAssets()}assets/avatars/enfermeira.png`],
    [2, `${baseAssets()}assets/avatars/janitor.png`],
    [3, `${baseAssets()}assets/avatars/paciente.png`],
  ])

/** Foto 2D do avatar neste slot (`null` quando sem foto). */
export function fotoDoAvatarPorSlot(slot: number): string | null {
  return FOTOS_DOS_AVATARES_POR_SLOT.get(slot) ?? null
}

/** Foto 2D do avatar do peão desta cor (`null` quando sem foto). */
export function fotoDoAvatarPorCor(cor: CorDoPeao): string | null {
  return fotoDoAvatarPorSlot(slotDoAvatar(cor))
}

/**
 * Fiação da PartidaPage (issue #404): jogadorId → URL da foto derivada da
 * cor do peão. Cores sem foto ficam fora do mapa (o HUD mantém as iniciais).
 */
export function montarImagemPorJogador(
  jogadorPorId: Readonly<Record<string, { readonly cor: CorDoPeao }>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [jogadorId, dados] of Object.entries(jogadorPorId)) {
    const foto = fotoDoAvatarPorCor(dados.cor)
    if (foto !== null) out[jogadorId] = foto
  }
  return out
}

/** Slot de um peão pela cor (índice em `CORES_DOS_PEOES`). */
export function slotDoAvatar(cor: CorDoPeao): number {
  return CORES_DOS_PEOES.indexOf(cor)
}

/** Há avatar 3D neste slot? (senão → placeholder de primitivas). */
export function temAvatarNoSlot(slot: number): boolean {
  return AVATARES_POR_SLOT.has(slot)
}
