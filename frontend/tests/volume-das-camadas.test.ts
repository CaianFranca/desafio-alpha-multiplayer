import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAVE_VOLUME_POR_CAMADA,
  MUSICA_DE_FUNDO_DISPONIVEL,
  definirVolumeDaCamada,
  obterVolumeDaCamada,
  obterVolumeDeEfeitos,
  obterVolumeDeMonstros,
  obterVolumeDeMusica,
  prenderVolumeDaCamada,
} from '../web/src/components/partida/volumesDasCamadas'
import { tocarSomDeRecusa, VOLUME_BASE_SOM_DE_RECUSA } from '../web/src/components/partida/somDeRecusa'
import {
  tocarSomDeGiroDoEncaixe,
  tocarSomDeMovimentoDoEncaixe,
  VOLUME_BASE_SOM_DE_GIRO,
  VOLUME_BASE_SOM_DE_MOVIMENTO,
} from '../web/src/components/partida/somDoEncaixe'
import { tocarGeradorLigado } from '../web/src/components/partida/somDaConquista'
import { VOLUME_BASE_SOM_GERADOR_LIGADO } from '../web/src/game/tabuleiro/animacao'
import {
  tocarDefesaDoAtaque,
  tocarSomDoMonstro,
  tocarTremorDoAtaque,
} from '../web/src/components/partida/somDoAtaque'
import {
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../web/src/game/tabuleiro/animacao'
import { tocarBlipDoChat, VOLUME_BASE_SOM_DE_BLIP_DO_CHAT } from '../web/src/components/partida/somDeBlipDoChat'
import { tocarBaqueDoPeao, tocarCliqueDoPeao } from '../web/src/game/tabuleiro/vooDoPeao'
import { SOM_VOLUME_BASE_BAQUE_PEAO, SOM_VOLUME_BASE_CLIQUE_PEAO } from '../web/src/game/tabuleiro/vooDoPeao'
import {
  tocarSlideDaCaixa,
  tocarSomSombrioDaLimpeza,
} from '../web/src/components/partida/somDaLimpeza'
import {
  CAMINHO_SOM_SLIDE_CAIXA,
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  VOLUME_BASE_SOM_SLIDE_CAIXA,
  VOLUME_BASE_SOM_SOMBRIO_LIMPEZA,
} from '../web/src/game/tabuleiro/animacao'
import { registrosDeBlipDoChat, toquesDeAudio } from './helpers/mockAudio'

// Camadas de volume da Partida (issue #438): comportamento externo —
// persistência no navegador, clamp [0, 1], zero silencia a camada, cada ponto
// de som lê só a sua camada no momento do toque. Áudio mockado globalmente
// (tests/helpers/mockAudio.ts).

beforeEach(() => {
  window.localStorage.clear()
})

describe('camadas de volume — persistência (issue #438)', () => {
  it('padrão 1 sem valor persistido, nas 3 chaves globais', () => {
    expect(CHAVE_VOLUME_POR_CAMADA).toEqual({
      musica: 'flicker:volume:musica',
      efeitos: 'flicker:volume:efeitos',
      monstros: 'flicker:volume:monstros',
    })
    expect(obterVolumeDaCamada('musica')).toBe(1)
    expect(obterVolumeDaCamada('efeitos')).toBe(1)
    expect(obterVolumeDaCamada('monstros')).toBe(1)
  })

  it('valor persiste e sobrevive a releitura (reload)', () => {
    definirVolumeDaCamada('efeitos', 0.2)
    expect(window.localStorage.getItem('flicker:volume:efeitos')).toBe('0.2')
    expect(obterVolumeDaCamada('efeitos')).toBe(0.2)
    expect(obterVolumeDeEfeitos()).toBe(0.2)
  })

  it('cada camada é independente', () => {
    definirVolumeDaCamada('efeitos', 0.2)
    expect(obterVolumeDaCamada('monstros')).toBe(1)
    expect(obterVolumeDaCamada('musica')).toBe(1)
    expect(obterVolumeDeMonstros()).toBe(1)
  })

  it('prende em [0, 1]; inválido volta ao padrão', () => {
    expect(prenderVolumeDaCamada(2)).toBe(1)
    expect(prenderVolumeDaCamada(-0.5)).toBe(0)
    expect(prenderVolumeDaCamada(Number.NaN)).toBe(1)
    window.localStorage.setItem('flicker:volume:efeitos', 'invalido')
    expect(obterVolumeDaCamada('efeitos')).toBe(1)
    window.localStorage.setItem('flicker:volume:monstros', '7')
    expect(obterVolumeDaCamada('monstros')).toBe(1)
  })

  it('música indisponível sem a faixa (#403 OPEN), mas o valor persiste', () => {
    expect(MUSICA_DE_FUNDO_DISPONIVEL).toBe(false)
    definirVolumeDaCamada('musica', 0.4)
    expect(obterVolumeDeMusica()).toBe(0.4)
  })
})

describe('camadas de volume — cada ponto lê só a sua camada (issue #438)', () => {
  it('efeitos: recusa escala pela camada; zero silencia', () => {
    definirVolumeDaCamada('efeitos', 0.5)
    tocarSomDeRecusa('fora_da_vez')
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]?.volume).toBeCloseTo(VOLUME_BASE_SOM_DE_RECUSA * 0.5, 5)

    definirVolumeDaCamada('efeitos', 0)
    tocarSomDeRecusa('fora_da_vez')
    expect(toquesDeAudio[1]?.volume).toBe(0)
  })

  it('efeitos: encaixe, conquista, peão, limpeza, slide e blip seguem a camada', () => {
    definirVolumeDaCamada('efeitos', 0.5)

    tocarSomDeGiroDoEncaixe()
    tocarSomDeMovimentoDoEncaixe()
    tocarGeradorLigado()
    tocarCliqueDoPeao()
    tocarBaqueDoPeao()
    tocarSomSombrioDaLimpeza()
    tocarSlideDaCaixa()
    tocarBlipDoChat()

    expect(toquesDeAudio).toHaveLength(7)
    expect(toquesDeAudio[0]?.volume).toBeCloseTo(VOLUME_BASE_SOM_DE_GIRO * 0.5, 5)
    expect(toquesDeAudio[1]?.volume).toBeCloseTo(VOLUME_BASE_SOM_DE_MOVIMENTO * 0.5, 5)
    expect(toquesDeAudio[2]?.volume).toBeCloseTo(VOLUME_BASE_SOM_GERADOR_LIGADO * 0.5, 5)
    expect(toquesDeAudio[3]?.volume).toBeCloseTo(SOM_VOLUME_BASE_CLIQUE_PEAO * 0.5, 5)
    expect(toquesDeAudio[4]?.volume).toBeCloseTo(SOM_VOLUME_BASE_BAQUE_PEAO * 0.5, 5)
    expect(toquesDeAudio[5]).toMatchObject({ src: CAMINHO_SOM_SOMBRIO_LIMPEZA })
    expect(toquesDeAudio[5]?.volume).toBeCloseTo(VOLUME_BASE_SOM_SOMBRIO_LIMPEZA * 0.5, 5)
    expect(toquesDeAudio[6]).toMatchObject({ src: CAMINHO_SOM_SLIDE_CAIXA })
    expect(toquesDeAudio[6]?.volume).toBeCloseTo(VOLUME_BASE_SOM_SLIDE_CAIXA * 0.5, 5)
    expect(registrosDeBlipDoChat).toHaveLength(1)
    expect(registrosDeBlipDoChat[0]?.ganho).toBeCloseTo(VOLUME_BASE_SOM_DE_BLIP_DO_CHAT * 0.5, 5)
  })

  it('monstros: vulto, tremor e defesa escalam pela camada; zero silencia', () => {
    definirVolumeDaCamada('monstros', 0.5)
    tocarSomDoMonstro('vulto')
    tocarTremorDoAtaque()
    tocarDefesaDoAtaque()

    expect(toquesDeAudio).toHaveLength(3)
    expect(toquesDeAudio[0]?.volume).toBeCloseTo(VOLUME_BASE_SOM_VULTO * 0.5, 5)
    expect(toquesDeAudio[1]?.volume).toBeGreaterThan(0)
    expect(toquesDeAudio[2]?.volume).toBeCloseTo(VOLUME_BASE_SOM_DEFESA_ATAQUE * 0.5, 5)

    definirVolumeDaCamada('monstros', 0)
    tocarSomDoMonstro('vulto')
    expect(toquesDeAudio[3]?.volume).toBe(0)
  })

  it('camadas não vazam: efeitos zerados não calam monstros e vice-versa', () => {
    definirVolumeDaCamada('efeitos', 0)
    definirVolumeDaCamada('monstros', 0.5)

    tocarSomDeRecusa('fora_da_vez')
    tocarSomDoMonstro('vulto')

    expect(toquesDeAudio[0]?.volume).toBe(0)
    expect(toquesDeAudio[1]?.volume).toBeCloseTo(VOLUME_BASE_SOM_VULTO * 0.5, 5)
  })
})
