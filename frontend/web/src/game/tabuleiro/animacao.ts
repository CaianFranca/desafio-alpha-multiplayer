/**
 * Tokens centralizados de animação e áudio (spec #238).
 *
 * Durações e caminhos de áudio vivem aqui — nunca hardcoded nos componentes.
 * Duto canônico de mídia: `frontend/web/media/` → servido em `/media/` via
 * proxy/nginx (mesmo duto de `somDeRecusa.ts:/media/bumpintowall.mp3`).
 * Sem arquivo = no-op silencioso (ver `game/audio/sons.ts`).
 *
 * Valores de partida da spec: encaixe ~250ms, peão ~500ms, fade limpeza ~300ms,
 * slide caixa ~400ms. Esta issue usa apenas o fade da limpeza; os demais ficam
 * reservados para os tickets paralelos.
 */

import { comBase } from '../../api/basePath'

export const DURACAO_ENCAIXE_MS = 250
export const DURACAO_VOO_PEAO_MS = 500
export const DURACAO_FADE_LIMPEZA_MS = 300
export const DURACAO_SLIDE_CAIXA_MS = 400

// Subpath (VITE_BASE_PATH): os assets de mídia acompanham o prefixo do app.
export const CAMINHO_SOM_CARTA = comBase('/media/card-flick.wav')
export const CAMINHO_TOQUE_ENIGMATICO = comBase('/media/scary-sound.mp3')
export const CAMINHO_SOM_SOMBRIO_LIMPEZA = comBase('/media/toque-sombrio-limpeza.mp3')
export const CAMINHO_SOM_SLIDE_CAIXA = comBase('/media/som-slide-caixa.mp3')

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
