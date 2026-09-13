/**
 * Sons do ataque dos monstros (issue #385).
 *
 * Quatro pontos próprios no duto canônico de mídia (`frontend/web/media/` →
 * servido em `/media/`): uivo no disparo do Vulto, trovão no impacto do
 * Espectro, tremida na chegada ao alvo e defesa no protegido — sons distintos
 * do THUD de recusa (`somDeRecusa.ts`, intacto: recusas de jogada mantêm o
 * genérico; a penalidade do ataque usa estes sons, nunca o genérico).
 *
 * Sem arquivo = no-op silencioso (`new Audio(...)` + `play()` com `catch`,
 * espelhando `somDoEncaixe.ts`). Volumes base próprios (contrato da ADR-0007:
 * `audio.volume = master × VOLUME_BASE_*`, com master em [0, 1] padrão 1 —
 * sem novo controle de volume nesta issue).
 */

import {
  CAMINHO_SOM_DEFESA_ATAQUE,
  CAMINHO_SOM_ESPECTRO,
  CAMINHO_SOM_TREMIDA_ATAQUE,
  CAMINHO_SOM_VULTO,
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_ESPECTRO,
  VOLUME_BASE_SOM_TREMIDA_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../../game/tabuleiro/animacao'

/** Tipo do monstro atacante — decide entre uivo (Vulto) e trovão (Espectro). */
export type TipoDeMonstroAtacante = 'vulto' | 'espectro'

function tocarAssetDoAtaque(caminho: string, volumeBase: number, mestre: number): void {
  try {
    const audio = new Audio(caminho)
    // Contrato de volume (ADR-0007): base fixa do ponto vezes o mestre
    // (futuro botão de volume), preso a [0, 1].
    const mestrePreso = Math.min(1, Math.max(0, mestre))
    audio.volume = mestrePreso * volumeBase
    const tocando: unknown = audio.play()
    // jsdom não implementa play(): retorna undefined em vez de Promise.
    if (
      typeof tocando === 'object' &&
      tocando !== null &&
      'catch' in tocando &&
      typeof (tocando as { catch: unknown }).catch === 'function'
    ) {
      ;(tocando as Promise<void>).catch(() => {})
    }
  } catch {
    // Sem asset ou autoplay bloqueado: silêncio sem quebrar a Partida.
  }
}

/**
 * Toca o som do monstro no gesto de disparo — sempre, mesmo sem vítimas
 * (só monstro). Habilitado por padrão, no-op silencioso se falhar.
 */
export function tocarSomDoMonstro(tipo: TipoDeMonstroAtacante, mestre = 1): void {
  if (tipo === 'vulto') {
    tocarAssetDoAtaque(CAMINHO_SOM_VULTO, VOLUME_BASE_SOM_VULTO, mestre)
  } else {
    tocarAssetDoAtaque(CAMINHO_SOM_ESPECTRO, VOLUME_BASE_SOM_ESPECTRO, mestre)
  }
}

/**
 * Toca a tremida na chegada ao alvo — só com atingido (nunca sem vítimas,
 * nunca no protegido). Habilitado por padrão, no-op silencioso se falhar.
 */
export function tocarTremidaDoAtaque(mestre = 1): void {
  tocarAssetDoAtaque(CAMINHO_SOM_TREMIDA_ATAQUE, VOLUME_BASE_SOM_TREMIDA_ATAQUE, mestre)
}

/**
 * Toca a defesa no protegido — só com alvo protegido na chegada (sem tremor
 * e sem debilitação: só brilho de escudo + este som). Habilitado por padrão,
 * no-op silencioso se falhar.
 */
export function tocarDefesaDoAtaque(mestre = 1): void {
  tocarAssetDoAtaque(CAMINHO_SOM_DEFESA_ATAQUE, VOLUME_BASE_SOM_DEFESA_ATAQUE, mestre)
}
