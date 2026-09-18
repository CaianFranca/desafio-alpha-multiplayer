/**
 * Som do aviso de tempo de turno (issue #430, spec pai #405).
 *
 * Ponto de som ÚNICO do aviso: toca o asset curto de 3 bipes
 * (`/media/aviso-turno.wav`, gerado por `gerar-aviso-turno.py`, servido pelo
 * proxy a partir de `frontend/web/media/` — duto existente de mídia estática,
 * `infra/nginx`) uma única vez na chegada de `TURNO_AVISO_30S`.
 *
 * A unicidade vem do evento (o relógio do game-server o emite uma única vez
 * por turno): a PartidaPage chama `tocarSomDeAvisoDoTurno` só no handler do
 * evento — snapshots, reloads, re-admissões e retornos nunca re-tocam.
 *
 * Volume base 0.2 (VOLUME_BASE_SOM_DE_AVISO_DO_TURNO): abaixo dos efeitos de
 * erro (0.3 da recusa), no contrato da ADR-0007 + issue #438
 * (`audio.volume = camada de efeitos × VOLUME_BASE`, com a camada lida no
 * momento do toque via slider do modal de volume). `play()` com `catch`
 * silencioso como defensivo (no-op se falhar), espelhando `somDeRecusa.ts`.
 */

import { comBase } from '../../api/basePath'
import { obterVolumeDeEfeitos } from './volumesDasCamadas'
import { tocarAsset } from '../../game/audio/sons'

/** Asset do aviso (web/media → servido em /media/), já com o subpath do build. */
export const CAMINHO_SOM_DE_AVISO_DO_TURNO = comBase('/media/aviso-turno.wav')

/**
 * Volume base do som de aviso (ADR-0007 + issue #438): abaixo dos efeitos de
 * erro (recusa 0.3) — o aviso é informativo, não punitivo. A camada de
 * efeitos do modal multiplica a base no momento do toque.
 */
export const VOLUME_BASE_SOM_DE_AVISO_DO_TURNO = 0.2

/**
 * Toca os 3 bipes do aviso de tempo — habilitado por padrão, no-op
 * silencioso se o áudio falhar. Sem mestre explícito, lê a camada de
 * efeitos no momento do toque. Chamar SOMENTE na chegada de
 * `TURNO_AVISO_30S` (a unicidade por turno é do evento, não daqui).
 */
export function tocarSomDeAvisoDoTurno(mestre = obterVolumeDeEfeitos()): void {
  tocarAsset(CAMINHO_SOM_DE_AVISO_DO_TURNO, VOLUME_BASE_SOM_DE_AVISO_DO_TURNO, mestre)
}
