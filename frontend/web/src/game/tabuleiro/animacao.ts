/**
 * Tokens centralizados de animação e áudio (spec #238).
 *
 * Durações e caminhos de áudio vivem aqui — nunca hardcoded nos componentes.
 * Assets ainda não existem: o duto é `web/public/assets` (Vite publicDir).
 * Sem arquivo = no-op silencioso (ver `game/audio/sons.ts`).
 *
 * Valores de partida da spec: encaixe ~250ms, peão ~500ms, fade limpeza ~300ms,
 * slide caixa ~400ms. Esta issue usa apenas o fade da limpeza; os demais ficam
 * reservados para os tickets paralelos.
 */

export const DURACAO_ENCAIXE_MS = 250
export const DURACAO_VOO_PEAO_MS = 500
export const DURACAO_FADE_LIMPEZA_MS = 300
export const DURACAO_SLIDE_CAIXA_MS = 400

export const CAMINHO_SOM_CARTA = '/assets/som-carta.mp3'
export const CAMINHO_TOQUE_ENIGMATICO = '/assets/toque-enigmatico.mp3'
export const CAMINHO_SOM_SOMBRIO_LIMPEZA = '/assets/toque-sombrio-limpeza.mp3'
export const CAMINHO_SOM_SLIDE_CAIXA = '/assets/som-slide-caixa.mp3'

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
