/**
 * Sons da limpeza e da caixa da Partida (issue #438, spec-mãe #435).
 *
 * Dois pontos próprios no duto canônico de mídia (`frontend/web/media/` →
 * servido em `/media/`):
 *   - som sombrio a cada `LIMPEZA_APLICADA` com peças removidas (antes fora
 *     do contrato de volume — `tocarSom` com 0.7 fixo; agora migra para
 *     `tocarAsset` com base nomeada na camada de efeitos, preservando os 0.7
 *     efetivos);
 *   - slide da caixa (asset ainda sem arquivo commitado — no-op silencioso
 *     até pousar; o ponto já nasce lendo a camada de efeitos).
 *
 * Sem arquivo = no-op silencioso (`new Audio(...)` + `play()` com `catch`,
 * espelhando `somDoEncaixe.ts`). Volumes base em `animacao.ts` (contrato da
 * ADR-0007 + issue #438: `audio.volume = camada de efeitos × VOLUME_BASE_*`,
 * com a camada lida no momento do toque via slider do modal de volume).
 */

import {
  CAMINHO_SOM_SLIDE_CAIXA,
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  VOLUME_BASE_SOM_SLIDE_CAIXA,
  VOLUME_BASE_SOM_SOMBRIO_LIMPEZA,
} from '../../game/tabuleiro/animacao'
import { tocarAsset } from '../../game/audio/sons'
import { obterVolumeDeEfeitos } from './volumesDasCamadas'

/**
 * Toca o som sombrio da limpeza — evento-driven, só com peças removidas
 * (o chamador decide o gatilho; snapshots nunca soam). Habilitado por
 * padrão, no-op silencioso se falhar.
 */
export function tocarSomSombrioDaLimpeza(): void {
  tocarAsset(
    CAMINHO_SOM_SOMBRIO_LIMPEZA,
    VOLUME_BASE_SOM_SOMBRIO_LIMPEZA,
    obterVolumeDeEfeitos(),
  )
}

/**
 * Toca o slide da caixa — ponto pronto sem chamador ainda (o asset não tem
 * arquivo commitado: no-op silencioso até pousar). Já nasce na camada de
 * efeitos para nenhum som ignorar sua camada.
 */
export function tocarSlideDaCaixa(): void {
  tocarAsset(CAMINHO_SOM_SLIDE_CAIXA, VOLUME_BASE_SOM_SLIDE_CAIXA, obterVolumeDeEfeitos())
}
