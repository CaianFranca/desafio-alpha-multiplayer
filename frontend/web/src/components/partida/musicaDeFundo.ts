/**
 * Música de fundo em loop da Partida (issue #403).
 *
 * Ponto de música ÚNICO e centralizado da tela da Partida: toca em loop o
 * asset (`/media/musica-de-fundo.mp3`, servido pelo proxy a partir de
 * `frontend/web/media/` — duto existente de mídia estática, `infra/nginx`)
 * enquanto a Partida está em andamento. O ciclo de vida (quando tocar/parar,
 * desbloqueio no primeiro gesto, limpeza) vive no `useMusicaDeFundo`; aqui
 * ficam só as constantes e as operações sobre uma instância de `Audio`.
 *
 * Volume base 0.1 (VOLUME_BASE_MUSICA_DE_FUNDO): abaixo dos SFX (recusa/
 * clique em 0.3), confortável ao fundo. A camada de música do modal de
 * volume (issue #438) controla este ponto via `camada * VOLUME_BASE`.
 * `play()` com `catch` silencioso como defensivo (no-op se falhar, ex.:
 * autoplay bloqueado ou asset ausente) — nunca quebra a Partida.
 */

import { comBase } from '../../api/basePath'
import { obterVolumeDeMusica } from './volumesDasCamadas'

/** Asset da música de fundo (web/media → servido em /media/), já com o subpath do build. */
export const CAMINHO_MUSICA_DE_FUNDO = comBase('/media/musica-de-fundo.mp3')

/**
 * Volume base da música de fundo (contrato com o modal de volume,
 * ADR-0007 + issue #438: `audio.volume = camada de música * VOLUME_BASE_MUSICA_DE_FUNDO`, com
 * camada em [0, 1]).
 */
export const VOLUME_BASE_MUSICA_DE_FUNDO = 0.1

/**
 * Cria a instância da música de fundo: loop contínuo, volume
 * `obterVolumeDeMusica() * VOLUME_BASE_MUSICA_DE_FUNDO`. Não toca sozinha —
 * o hook decide quando chamar `tocarMusicaDeFundo` / `pararMusicaDeFundo`.
 */
export function criarMusicaDeFundo(): HTMLAudioElement {
  const audio = new Audio(CAMINHO_MUSICA_DE_FUNDO)
  audio.loop = true
  // Contrato de volume (ADR-0007 + issue #438): `audio.volume = camada de música * VOLUME_BASE`.
  audio.volume = obterVolumeDeMusica() * VOLUME_BASE_MUSICA_DE_FUNDO
  return audio
}

/**
 * Atualiza o volume da instância já em loop sem recriar ou interromper —
 * lê a camada de música no momento da chamada (mesma fórmula da criação).
 */
export function atualizarVolumeDaMusicaDeFundo(audio: HTMLAudioElement): void {
  try {
    audio.volume = obterVolumeDeMusica() * VOLUME_BASE_MUSICA_DE_FUNDO
  } catch {
    // Atualização silenciosa — nunca quebra o loop.
  }
}

/**
 * Toca a música de fundo — no-op silencioso se o áudio falhar (autoplay
 * bloqueado, asset ausente). Guarda para o jsdom, que não implementa
 * `play()` (retorna undefined em vez de Promise).
 */
export function tocarMusicaDeFundo(audio: HTMLAudioElement): void {
  try {
    const tocando: unknown = audio.play()
    if (
      typeof tocando === 'object' &&
      tocando !== null &&
      'catch' in tocando &&
      typeof (tocando as { catch: unknown }).catch === 'function'
    ) {
      ;(tocando as Promise<void>).catch(() => {})
    }
  } catch {
    // Música silenciosa sem quebrar nada.
  }
}

/**
 * Para a música de fundo — no-op silencioso se `pause()` falhar.
 */
export function pararMusicaDeFundo(audio: HTMLAudioElement): void {
  try {
    audio.pause()
  } catch {
    // Pausa silenciosa sem quebrar nada.
  }
}
