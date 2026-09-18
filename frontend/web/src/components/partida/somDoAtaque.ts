/**
 * Sons do ataque dos monstros (issue #385).
 *
 * Quatro pontos próprios no duto canônico de mídia (`frontend/web/media/` →
 * servido em `/media/`): uivo no disparo do Vulto, trovão no impacto do
 * Espectro, tremor na chegada ao alvo e defesa no protegido — sons distintos
 * do THUD de recusa (`somDeRecusa.ts`, intacto: Recusas de Ação mantêm o
 * genérico; a penalidade do ataque usa estes sons, nunca o genérico).
 *
 * Sem arquivo = no-op silencioso (`new Audio(...)` + `play()` com `catch`,
 * espelhando `somDoEncaixe.ts`). Volumes base próprios (contrato da ADR-0007
 * + issue #438: `audio.volume = camada de monstros × VOLUME_BASE_*`, com a
 * camada lida no momento do toque via slider do modal de volume).
 */

import {
  CAMINHO_SOM_DEFESA_ATAQUE,
  CAMINHO_SOM_ESPECTRO,
  CAMINHO_SOM_TREMOR_ATAQUE,
  CAMINHO_SOM_VULTO,
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_ESPECTRO,
  VOLUME_BASE_SOM_TREMOR_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../../game/tabuleiro/animacao'
import { tocarAsset } from '../../game/audio/sons'
import { obterVolumeDeMonstros } from './volumesDasCamadas'

/** Tipo do monstro atacante — decide entre uivo (Vulto) e trovão (Espectro). */
export type TipoDeMonstroAtacante = 'vulto' | 'espectro'

/**
 * Toca o som do monstro no gesto de disparo — sempre, mesmo sem vítimas
 * (só monstro). Habilitado por padrão, no-op silencioso se falhar.
 * Sem mestre explícito, lê a camada de monstros no momento do toque.
 */
export function tocarSomDoMonstro(tipo: TipoDeMonstroAtacante, mestre = obterVolumeDeMonstros()): void {
  if (tipo === 'vulto') {
    tocarAsset(CAMINHO_SOM_VULTO, VOLUME_BASE_SOM_VULTO, mestre)
  } else {
    tocarAsset(CAMINHO_SOM_ESPECTRO, VOLUME_BASE_SOM_ESPECTRO, mestre)
  }
}

/**
 * Toca o tremor na chegada ao alvo — só com atingido (nunca sem vítimas,
 * nunca no protegido). Habilitado por padrão, no-op silencioso se falhar.
 * Sem mestre explícito, lê a camada de monstros no momento do toque.
 */
export function tocarTremorDoAtaque(mestre = obterVolumeDeMonstros()): void {
  tocarAsset(CAMINHO_SOM_TREMOR_ATAQUE, VOLUME_BASE_SOM_TREMOR_ATAQUE, mestre)
}

/**
 * Toca a defesa no protegido — só com alvo protegido na chegada (sem tremor
 * e sem debilitação: só brilho de escudo + este som). Habilitado por padrão,
 * no-op silencioso se falhar. Sem mestre explícito, lê a camada de monstros
 * no momento do toque.
 */
export function tocarDefesaDoAtaque(mestre = obterVolumeDeMonstros()): void {
  tocarAsset(CAMINHO_SOM_DEFESA_ATAQUE, VOLUME_BASE_SOM_DEFESA_ATAQUE, mestre)
}
