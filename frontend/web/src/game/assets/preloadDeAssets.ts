/**
 * Preload total dos assets da Partida (texturas + GLBs + sons).
 *
 * - 3D (`precarregarTexturasEGlb`): dispara `useLoader.preload` para cada
 *   grupo do manifesto, espelhando loader + forma do input das chamadas
 *   `useLoader` dos componentes. O R3F guarda o resultado no cache do
 *   `useLoader` (chave `[loader, ...urls]`), então quando o board monta os
 *   componentes resolvem do cache SEM baixar de novo — inclusive os GLBs de
 *   monstro, que antes só baixavam no meio da partida. Os loads passam pelo
 *   `DefaultLoadingManager`, logo o gate existente (`useCenaPronta`) os
 *   observa sem recostura.
 *   Só chamar dentro do `<Canvas>` (via `PrecarregadorDeAssets`): no jsdom o
 *   Canvas renderiza só o fallback (sem WebGL) e os filhos nunca comitem —
 *   nenhum loader real dispara nos testes, sem poluir o manager global.
 * - Sons (`aquecerSons`): baixa cada mp3/wav via `fetch` consumindo o corpo,
 *   aquecendo o cache HTTP para o `new Audio()` do primeiro toque (antes o
 *   som baixava na hora de tocar). Idempotente (voo único por sessão).
 *   Falha de qualquer item (404, rede) assenta como concluída: o jogo abre
 *   com fallback (error boundary visual / silêncio no áudio), nunca trava.
 */

import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  GLBS_AVULSOS,
  PARES_DE_AVATARES_POR_SLOT,
  PAR_DE_TEXTURA_DO_TABULEIRO,
  SONS_DA_PARTIDA,
  TEXTURAS_AVULSAS,
  TRIPLAS_DE_TEXTURA_DAS_PECAS,
} from './manifestoDeAssets'

/**
 * Ambiente sem rede real de mídia (SSR ou jsdom): o aquecimento de sons
 * assenta na hora, sem `fetch` — os testes seguem verdes e silenciosos (sem
 * rede, sem update pós-render fora de `act`).
 */
export function semRedeDeMidia(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return true
  }
  const agente =
    typeof window.navigator?.userAgent === 'string'
      ? window.navigator.userAgent
      : ''
  return /jsdom/i.test(agente)
}

/** Dispara o preload 3D no cache do `useLoader` (efeito colateral, sem retorno). */
export function precarregarTexturasEGlb(): void {
  for (const url of TEXTURAS_AVULSAS) {
    useLoader.preload(THREE.TextureLoader, url)
  }
  for (const tripla of TRIPLAS_DE_TEXTURA_DAS_PECAS) {
    useLoader.preload(THREE.TextureLoader, tripla)
  }
  useLoader.preload(THREE.TextureLoader, PAR_DE_TEXTURA_DO_TABULEIRO)
  for (const url of GLBS_AVULSOS) {
    useLoader.preload(GLTFLoader, url)
  }
  for (const par of PARES_DE_AVATARES_POR_SLOT) {
    useLoader.preload(GLTFLoader, par)
  }
}

let promessaDoAquecimento: Promise<void> | null = null

async function aquecerUmSom(
  buscar: typeof globalThis.fetch,
  url: string,
): Promise<void> {
  try {
    const resposta = await buscar(url)
    // Consome o corpo: garante o download completo (não só os headers).
    if (resposta?.ok && typeof resposta.arrayBuffer === 'function') {
      await resposta.arrayBuffer()
    }
  } catch {
    // Falha assenta (o ponto de som segue no-op silencioso sem o arquivo).
  }
}

/**
 * Mecanismo do aquecimento (seam testável): baixa todos os sons com o
 * `fetch` injetado e resolve quando TODOS assentarem. Nunca rejeita.
 */
export function aquecerSonsViaFetch(
  buscar: typeof globalThis.fetch,
): Promise<void> {
  if (typeof buscar !== 'function') return Promise.resolve()
  return Promise.allSettled(SONS_DA_PARTIDA.map((url) => aquecerUmSom(buscar, url))).then(
    () => undefined,
  )
}

/**
 * Aquece os sons da partida (idempotente, voo único por sessão): resolve
 * quando TODOS assentarem (baixados ou falhados). Nunca rejeita. Sem
 * ambiente com rede de mídia (jsdom/SSR) resolve na hora, sem `fetch`.
 */
export function aquecerSons(): Promise<void> {
  if (promessaDoAquecimento === null) {
    promessaDoAquecimento = semRedeDeMidia()
      ? Promise.resolve()
      : aquecerSonsViaFetch(globalThis.fetch)
  }
  return promessaDoAquecimento
}
