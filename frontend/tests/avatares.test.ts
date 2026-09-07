/**
 * Avatares 3D dos peões (issues #297 e #300, spec #296).
 *
 * Só comportamento externo observável do seam puro: o slot por cor espelha a
 * ordem canônica do engine, o mapa de slots aponta os 2 GLBs do Diretor e da
 * Enfermeira (slots 0 e 1 nesta etapa) e a derivação de Baixa Iluminação
 * projeta o estado do Vulto por peão. Nada de three.js/DOM — jsdom-safe.
 */

import { CORES_DOS_PEOES } from '../web/src/game/tabuleiro/contrato'
import {
  AVATARES_POR_SLOT,
  slotDoAvatar,
  temAvatarNoSlot,
} from '../web/src/game/tabuleiro/avatares'
import {
  peoesEmBaixaIluminacaoDe,
  type SanidadePorPeao,
} from '../web/src/game/tabuleiro/reducao'

describe('avatares dos peões (issues #297 e #300)', () => {
  it('slot espelha a ordem canônica do engine (branco = 0 = Diretor)', () => {
    expect(CORES_DOS_PEOES).toEqual(['branco', 'vermelho', 'azul', 'amarelo'])
    expect(slotDoAvatar('branco')).toBe(0)
    expect(slotDoAvatar('vermelho')).toBe(1)
    expect(slotDoAvatar('azul')).toBe(2)
    expect(slotDoAvatar('amarelo')).toBe(3)
  })

  it('slots 0 (Diretor) e 1 (Enfermeira) têm avatar; demais seguem placeholder', () => {
    expect(temAvatarNoSlot(0)).toBe(true)
    expect(temAvatarNoSlot(1)).toBe(true)
    for (const slot of [2, 3, -1, 4]) {
      expect(temAvatarNoSlot(slot)).toBe(false)
    }
  })

  it('mapa do slot 0 aponta os 2 GLBs do Diretor servidos por URL', () => {
    const avatar = AVATARES_POR_SLOT.get(0)
    expect(avatar).toBeDefined()
    expect(avatar?.urlAcesa).toContain('assets/')
    expect(avatar?.urlAcesa.endsWith('diretor_base_acesa.glb')).toBe(true)
    expect(avatar?.urlApagada).toContain('assets/')
    expect(avatar?.urlApagada.endsWith('diretor_base_apagado.glb')).toBe(true)
    expect(avatar?.urlAcesa).not.toBe(avatar?.urlApagada)
  })

  it('mapa do slot 1 aponta os 2 GLBs da Enfermeira servidos por URL', () => {
    const avatar = AVATARES_POR_SLOT.get(1)
    expect(avatar).toBeDefined()
    expect(avatar?.urlAcesa).toContain('assets/')
    expect(avatar?.urlAcesa.endsWith('enfermeira_base_acesa.glb')).toBe(true)
    expect(avatar?.urlApagada).toContain('assets/')
    expect(avatar?.urlApagada.endsWith('enfermeira_base_apagada.glb')).toBe(true)
    expect(avatar?.urlAcesa).not.toBe(avatar?.urlApagada)
  })

  it('deriva os peões em Baixa Iluminação do estado por jogador (per-player)', () => {
    const sanidadePorPeao: SanidadePorPeao = {
      'peao-branco': { sanidade: 2, emBaixaIluminacao: true, amedrontado: false },
      'peao-vermelho': { sanidade: 3, emBaixaIluminacao: false, amedrontado: true },
      'peao-azul': { sanidade: 1, emBaixaIluminacao: true, amedrontado: false },
    }
    const emBaixa = peoesEmBaixaIluminacaoDe(sanidadePorPeao)
    expect([...emBaixa].sort()).toEqual(['peao-azul', 'peao-branco'])
    // Amedrontado NÃO liga o set: o gatilho do avatar apagado é só Baixa
    // Iluminação (o set de afetados, de resgate, segue sendo o outro).
    expect(emBaixa.has('peao-vermelho')).toBe(false)
  })

  it('derivação vazia em sanidade vazia: set sem peões', () => {
    expect([...peoesEmBaixaIluminacaoDe({})]).toEqual([])
  })
})
