import { renderHook } from '@testing-library/react'
import {
  CAMINHO_MUSICA_DE_FUNDO,
  VOLUME_BASE_MUSICA_DE_FUNDO,
  criarMusicaDeFundo,
  pararMusicaDeFundo,
  tocarMusicaDeFundo,
} from '../web/src/components/partida/musicaDeFundo'
import { useMusicaDeFundo } from '../web/src/components/partida/useMusicaDeFundo'
import { VOLUME_BASE_SOM_DE_RECUSA } from '../web/src/components/partida/somDeRecusa'
import { VOLUME_PADRAO_DA_CAMADA } from '../web/src/components/partida/volumesDasCamadas'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  pausasDeAudio,
  toquesDeAudio,
} from './helpers/mockAudio'

// Música de fundo em loop da Partida (issue #403): comportamento externo —
// constantes do contrato de volume (ADR-0007), loop contínuo só em
// andamento, pausa ao sair/terminar/desmontar, falha silenciosa e retry no
// primeiro gesto (autoplay bloqueado). Áudio mockado globalmente
// (tests/helpers/mockAudio.ts).

describe('música de fundo — constantes (issue #403)', () => {
  it('caminho aponta ao duto /media/ com o subpath do build', () => {
    expect(CAMINHO_MUSICA_DE_FUNDO).toContain('/media/musica-de-fundo.mp3')
  })

  it('volume base é confortável, abaixo dos SFX', () => {
    expect(VOLUME_BASE_MUSICA_DE_FUNDO).toBe(0.1)
    expect(VOLUME_BASE_MUSICA_DE_FUNDO).toBeLessThan(VOLUME_BASE_SOM_DE_RECUSA)
  })

  it('instância nasce em loop com volume camada de música * base (ADR-0007 + #438)', () => {
    const audio = criarMusicaDeFundo()
    expect(audio.loop).toBe(true)
    expect(audio.volume).toBe(VOLUME_PADRAO_DA_CAMADA * VOLUME_BASE_MUSICA_DE_FUNDO)
  })
})

describe('useMusicaDeFundo — ciclo de vida (issue #403)', () => {
  it('toca em loop ao ativar (Partida em andamento)', () => {
    renderHook(() => useMusicaDeFundo(true))

    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]?.src).toBe(CAMINHO_MUSICA_DE_FUNDO)
    expect(toquesDeAudio[0]?.volume).toBe(VOLUME_BASE_MUSICA_DE_FUNDO)
    expect(toquesDeAudio[0]?.loop).toBe(true)
  })

  it('não toca sem Partida em andamento', () => {
    renderHook(() => useMusicaDeFundo(false))

    expect(toquesDeAudio).toHaveLength(0)
    expect(pausasDeAudio).toHaveLength(1)
  })

  it('pausa ao desativar (término da Partida)', () => {
    const { rerender } = renderHook(({ emAndamento }: { emAndamento: boolean }) =>
      useMusicaDeFundo(emAndamento),
    { initialProps: { emAndamento: true } })

    expect(toquesDeAudio).toHaveLength(1)

    rerender({ emAndamento: false })

    expect(pausasDeAudio).toHaveLength(1)
    expect(pausasDeAudio[0]).toBe(CAMINHO_MUSICA_DE_FUNDO)
  })

  it('pausa ao desmontar (saída da Partida)', () => {
    const { unmount } = renderHook(() => useMusicaDeFundo(true))

    expect(toquesDeAudio).toHaveLength(1)

    unmount()

    expect(pausasDeAudio).toHaveLength(1)
    expect(pausasDeAudio[0]).toBe(CAMINHO_MUSICA_DE_FUNDO)
  })

  it('tenta de novo no primeiro gesto e depois se remove (autoplay bloqueado)', () => {
    renderHook(() => useMusicaDeFundo(true))
    expect(toquesDeAudio).toHaveLength(1)

    window.dispatchEvent(new Event('pointerdown'))
    expect(toquesDeAudio).toHaveLength(2)

    // Listener único: o segundo gesto não re-dispara.
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    expect(toquesDeAudio).toHaveLength(2)
  })

  it('gesto de teclado também desbloqueia', () => {
    renderHook(() => useMusicaDeFundo(true))
    expect(toquesDeAudio).toHaveLength(1)

    window.dispatchEvent(new Event('keydown'))
    expect(toquesDeAudio).toHaveLength(2)

    window.dispatchEvent(new Event('keydown'))
    expect(toquesDeAudio).toHaveLength(2)
  })
})

describe('música de fundo — falha silenciosa (issue #403)', () => {
  it('play() rejeitado não quebra', async () => {
    armarFalhaNoProximoPlay()
    expect(() => renderHook(() => useMusicaDeFundo(true))).not.toThrow()
    expect(toquesDeAudio).toHaveLength(1)
    // Unhandled rejections quebrariam a suíte — dá um giro ao event loop.
    await Promise.resolve()
  })

  it('play() com exceção síncrona não quebra', () => {
    armarExcecaoNoProximoPlay()
    expect(() => renderHook(() => useMusicaDeFundo(true))).not.toThrow()
  })

  it('tocar/parar avulsos nunca lançam', () => {
    armarExcecaoNoProximoPlay()
    const audio = criarMusicaDeFundo()
    expect(() => tocarMusicaDeFundo(audio)).not.toThrow()
    expect(() => pararMusicaDeFundo(audio)).not.toThrow()
  })
})
