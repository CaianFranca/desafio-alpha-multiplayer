import {
  tocarDefesaDoAtaque,
  tocarSomDoMonstro,
  tocarTremorDoAtaque,
} from '../web/src/components/partida/somDoAtaque'
import {
  CAMINHO_SOM_DEFESA_ATAQUE,
  CAMINHO_SOM_ESPECTRO,
  CAMINHO_SOM_TREMOR_ATAQUE,
  CAMINHO_SOM_VULTO,
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_ESPECTRO,
  VOLUME_BASE_SOM_TREMOR_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../web/src/game/tabuleiro/animacao'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeAudio,
} from './helpers/mockAudio'

// Sons do ataque (issue #385): comportamento externo — tocou/não tocou (com
// qual asset e volume base × mestre). Áudio mockado globalmente
// (tests/helpers/mockAudio.ts). Duto canônico, sem arquivo = no-op.

describe('som do ataque — duto canônico com base × mestre (issue #385)', () => {
  it('Vulto soa o uivo e Espectro o trovão, com as bases próprias', () => {
    tocarSomDoMonstro('vulto')
    tocarSomDoMonstro('espectro')

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    expect(toquesDeAudio[1]).toMatchObject({ src: CAMINHO_SOM_ESPECTRO, volume: VOLUME_BASE_SOM_ESPECTRO })
  })

  it('tremor e defesa usam impacto.mp3 e defesa.mp3 com as bases próprias', () => {
    tocarTremorDoAtaque()
    tocarDefesaDoAtaque()

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({
      src: CAMINHO_SOM_TREMOR_ATAQUE,
      volume: VOLUME_BASE_SOM_TREMOR_ATAQUE,
    })
    expect(toquesDeAudio[1]).toMatchObject({
      src: CAMINHO_SOM_DEFESA_ATAQUE,
      volume: VOLUME_BASE_SOM_DEFESA_ATAQUE,
    })
  })

  it('mestre escala a base (contrato ADR-0007: volume = mestre × base)', () => {
    tocarSomDoMonstro('vulto', 0.5)
    tocarTremorDoAtaque(0.5)

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]?.volume).toBeCloseTo(VOLUME_BASE_SOM_VULTO * 0.5, 5)
    expect(toquesDeAudio[1]?.volume).toBeCloseTo(VOLUME_BASE_SOM_TREMOR_ATAQUE * 0.5, 5)
  })

  it('falha de play() não quebra (no-op sem arquivo)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarSomDoMonstro('vulto')).not.toThrow()
    expect(toquesDeAudio).toHaveLength(1)
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarDefesaDoAtaque()).not.toThrow()
  })
})
