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
 *
 * Ataque dos monstros (issue #385): fila sequencial por atacante com bloqueio
 * da entrada do turno — lag deliberado de ~1,3s com 1 monstro e ~1,9s com 2
 * (`DURACAO_BASE_ATAQUE_MS + n × DURACAO_ATAQUE_POR_ATACANTE_MS`).
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

// ── Ataque dos monstros (issue #385) ──
// Mapeamento confirmado pelo usuário: uivo do Vulto → vulto-uivo.mp3, trovão
// do Espectro → trovao.mp3, tremida → impacto.mp3, defesa → defesa.mp3.
export const CAMINHO_SOM_VULTO = comBase('/media/vulto-uivo.mp3')
export const CAMINHO_SOM_ESPECTRO = comBase('/media/trovao.mp3')
export const CAMINHO_SOM_TREMIDA_ATAQUE = comBase('/media/impacto.mp3')
export const CAMINHO_SOM_DEFESA_ATAQUE = comBase('/media/defesa.mp3')

/**
 * Volumes base dos sons do ataque (contrato com o futuro botão de volume,
 * ADR-0007: `audio.volume = master × VOLUME_BASE_*`, com master em [0, 1]).
 * Monstros gritam (base alta, pontuais); tremida e defesa acompanham abaixo.
 */
export const VOLUME_BASE_SOM_VULTO = 0.9
export const VOLUME_BASE_SOM_ESPECTRO = 0.9
export const VOLUME_BASE_SOM_TREMIDA_ATAQUE = 0.7
export const VOLUME_BASE_SOM_DEFESA_ATAQUE = 0.6

/**
 * Fila do ataque (issue #385): o gesto de disparo precede a reação em cadeia
 * (`DURACAO_DISPARO_ATAQUE_MS`); cada atacante ocupa um slot de
 * `DURACAO_ATAQUE_POR_ATACANTE_MS` e o primeiro item carrega ainda a base de
 * `DURACAO_BASE_ATAQUE_MS` — 700 + 600 = ~1,3s com 1 monstro,
 * 700 + 2×600 = ~1,9s com 2. A onda do Vulto ondula por camadas de distância
 * (`DURACAO_ONDA_VULTO_CAMADA_MS` por camada, direções em paralelo dentro da
 * camada); o Espectro reage junto nas adjacentes (sem stagger).
 */
export const DURACAO_BASE_ATAQUE_MS = 700
export const DURACAO_ATAQUE_POR_ATACANTE_MS = 600
export const DURACAO_DISPARO_ATAQUE_MS = 250
export const DURACAO_ONDA_VULTO_CAMADA_MS = 120

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
