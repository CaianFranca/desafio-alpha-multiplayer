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
 * da entrada do turno — cada atacante tem 1s de telegraph silencioso antes
 * do próprio disparo; lag deliberado por decisão do usuário de ~2,3s com 1
 * monstro e ~3,9s com 2 (`DURACAO_BASE_ATAQUE_MS + n × (TELEGRAPH + SLOT)`) —
 * pacing do jogo, não bug de performance.
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
// do Espectro → trovao.mp3, tremor → impacto.mp3, defesa → defesa.mp3.
export const CAMINHO_SOM_VULTO = comBase('/media/vulto-uivo.mp3')
export const CAMINHO_SOM_ESPECTRO = comBase('/media/trovao.mp3')
export const CAMINHO_SOM_TREMOR_ATAQUE = comBase('/media/impacto.mp3')
export const CAMINHO_SOM_DEFESA_ATAQUE = comBase('/media/defesa.mp3')

/**
 * Volumes base dos sons do ataque (contrato com o futuro botão de volume,
 * ADR-0007: `audio.volume = master × VOLUME_BASE_*`, com master em [0, 1]).
 * Monstros gritam (base alta, pontuais); tremor e defesa acompanham abaixo.
 */
export const VOLUME_BASE_SOM_VULTO = 0.9
export const VOLUME_BASE_SOM_ESPECTRO = 0.9
export const VOLUME_BASE_SOM_TREMOR_ATAQUE = 0.7
export const VOLUME_BASE_SOM_DEFESA_ATAQUE = 0.6

// ── Conquistas da Confirmação de Posição (issue #385, follow-up) ──
// Mapeamento confirmado pelo usuário: gerador liga → gerador.mp3, cartão de
// acesso → accessCard.mp3, proteção da Sala Médica → medicine.mp3.
export const CAMINHO_SOM_GERADOR_LIGADO = comBase('/media/gerador.mp3')
export const CAMINHO_SOM_CARTAO_ACESSO = comBase('/media/accessCard.mp3')
export const CAMINHO_SOM_PROTECAO_ADQUIRIDA = comBase('/media/medicine.mp3')

/**
 * Volumes base dos sons de conquista (contrato com o futuro botão de volume,
 * ADR-0007: `audio.volume = master × VOLUME_BASE_*`, com master em [0, 1]).
 * Conquistas celebram (bases médias-altas, pontuais — uma vez por aquisição).
 */
export const VOLUME_BASE_SOM_GERADOR_LIGADO = 0.1
export const VOLUME_BASE_SOM_CARTAO_ACESSO = 0.5
export const VOLUME_BASE_SOM_PROTECAO_ADQUIRIDA = 0.5

/**
 * Fila do ataque (issue #385): cada item abre com o telegraph silencioso
 * (`DURACAO_TELEGRAPH_ATAQUE_MS`, contorno vermelho pulsante na peça do
 * monstro) e só depois o gesto de disparo precede a reação em cadeia
 * (`DURACAO_DISPARO_ATAQUE_MS`); cada atacante ocupa telegraph + slot de
 * `DURACAO_ATAQUE_POR_ATACANTE_MS` e o primeiro item carrega ainda a base de
 * `DURACAO_BASE_ATAQUE_MS` — 700 + (1000 + 600) = ~2,3s com 1 monstro,
 * 700 + 2×(1000 + 600) = ~3,9s com 2. A onda do Vulto ondula por camadas de
 * distância (`DURACAO_ONDA_VULTO_CAMADA_MS` por camada, direções em paralelo
 * dentro da camada); o Espectro reage junto nas adjacentes (sem stagger).
 */
export const DURACAO_BASE_ATAQUE_MS = 700
export const DURACAO_ATAQUE_POR_ATACANTE_MS = 600
export const DURACAO_TELEGRAPH_ATAQUE_MS = 1000
export const DURACAO_DISPARO_ATAQUE_MS = 250
/**
 * Janela do gatilho da confirmação (review pós-PR #399): a iluminação e a
 * limpeza do lote da confirmação seguram até o `ATAQUE_RESOLVIDO` chegar —
 * mas SÓ se ele vier no mesmo burst (ms). Sem ataque no prazo, a janela
 * fecha sozinha e o lote aplica ao confirmar, sem esperar a virada de turno.
 */
export const DURACAO_JANELA_GATILHO_MS = 200
export const DURACAO_ONDA_VULTO_CAMADA_MS = 120
/** Vermelho do telegraph do ataque (contorno 3D + marca DOM, issue #385). */
export const COR_TELEGRAPH_ATAQUE = '#ef4444'
/** Lilás do flash do gesto de disparo do atacante (issue #385, follow-up). */
export const COR_FLASH_DISPARO_ATAQUE = '#ddd6fe'

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
