/**
 * Avatares 3D dos peões (issues #297, #300, #301 e #299, spec #296).
 *
 * Só comportamento externo observável do seam puro: o slot por cor espelha a
 * ordem canônica do engine, o mapa de slots aponta os 2 GLBs do Diretor, da
 * Enfermeira, do Janitor e do Paciente (slots 0, 1, 2 e 3 nesta etapa) e a
 * derivação de Baixa Iluminação projeta o estado do Vulto por peão. Nada de
 * three.js/DOM — jsdom-safe.
 */

import { CORES_DOS_PEOES } from '../web/src/game/tabuleiro/contrato'
import {
  AVATARES_POR_SLOT,
  FOTOS_DOS_AVATARES_POR_SLOT,
  FOTOS_VARIANTES_POR_SLOT,
  fotoDoAvatarPorCor,
  fotoDoAvatarPorSlot,
  montarImagemPorJogador,
  slotDoAvatar,
  temAvatarNoSlot,
} from '../web/src/game/tabuleiro/avatares'
import {
  peoesEmBaixaIluminacaoDe,
  type SanidadePorPeao,
} from '../web/src/game/tabuleiro/reducao'

describe('avatares dos peões (issues #297, #300, #301 e #299)', () => {
  it('slot espelha a ordem canônica do engine (branco = 0 = Diretor)', () => {
    expect(CORES_DOS_PEOES).toEqual(['branco', 'vermelho', 'azul', 'amarelo'])
    expect(slotDoAvatar('branco')).toBe(0)
    expect(slotDoAvatar('vermelho')).toBe(1)
    expect(slotDoAvatar('azul')).toBe(2)
    expect(slotDoAvatar('amarelo')).toBe(3)
  })

  it('slots 0 (Diretor), 1 (Enfermeira), 2 (Janitor) e 3 (Paciente) têm avatar; demais seguem placeholder', () => {
    expect(temAvatarNoSlot(0)).toBe(true)
    expect(temAvatarNoSlot(1)).toBe(true)
    expect(temAvatarNoSlot(2)).toBe(true)
    expect(temAvatarNoSlot(3)).toBe(true)
    for (const slot of [-1, 4]) {
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

  it('mapa do slot 2 aponta os 2 GLBs do Janitor servidos por URL', () => {
    const avatar = AVATARES_POR_SLOT.get(2)
    expect(avatar).toBeDefined()
    expect(avatar?.urlAcesa).toContain('assets/')
    expect(avatar?.urlAcesa.endsWith('janitor_base_aceso.glb')).toBe(true)
    expect(avatar?.urlApagada).toContain('assets/')
    expect(avatar?.urlApagada.endsWith('janitor_base_apagado.glb')).toBe(true)
    expect(avatar?.urlAcesa).not.toBe(avatar?.urlApagada)
  })

  it('mapa do slot 3 aponta os 2 GLBs do Paciente servidos por URL', () => {
    const avatar = AVATARES_POR_SLOT.get(3)
    expect(avatar).toBeDefined()
    expect(avatar?.urlAcesa).toContain('assets/')
    expect(avatar?.urlAcesa.endsWith('paciente_base_aceso.glb')).toBe(true)
    expect(avatar?.urlApagada).toContain('assets/')
    expect(avatar?.urlApagada.endsWith('paciente_base_apagado.glb')).toBe(true)
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

  it('fotos 2D do HUD (issue #404): slot → PNG aceso fixo dos 4 avatares', () => {
    expect(FOTOS_DOS_AVATARES_POR_SLOT.size).toBe(4)
    expect(FOTOS_DOS_AVATARES_POR_SLOT.get(0)).toContain('assets/')
    expect(FOTOS_DOS_AVATARES_POR_SLOT.get(0)?.endsWith('diretor.png')).toBe(true)
    expect(FOTOS_DOS_AVATARES_POR_SLOT.get(1)?.endsWith('enfermeira.png')).toBe(true)
    expect(FOTOS_DOS_AVATARES_POR_SLOT.get(2)?.endsWith('janitor.png')).toBe(true)
    expect(FOTOS_DOS_AVATARES_POR_SLOT.get(3)?.endsWith('paciente.png')).toBe(true)
  })

  it('foto por slot retorna a URL e null fora dos 4 slots', () => {
    expect(fotoDoAvatarPorSlot(0)?.endsWith('diretor.png')).toBe(true)
    expect(fotoDoAvatarPorSlot(1)?.endsWith('enfermeira.png')).toBe(true)
    expect(fotoDoAvatarPorSlot(2)?.endsWith('janitor.png')).toBe(true)
    expect(fotoDoAvatarPorSlot(3)?.endsWith('paciente.png')).toBe(true)
    expect(fotoDoAvatarPorSlot(-1)).toBeNull()
    expect(fotoDoAvatarPorSlot(4)).toBeNull()
  })

  it('foto por cor espelha a ordem canônica (branco → Diretor … amarelo → Paciente)', () => {
    expect(fotoDoAvatarPorCor('branco')?.endsWith('diretor.png')).toBe(true)
    expect(fotoDoAvatarPorCor('vermelho')?.endsWith('enfermeira.png')).toBe(true)
    expect(fotoDoAvatarPorCor('azul')?.endsWith('janitor.png')).toBe(true)
    expect(fotoDoAvatarPorCor('amarelo')?.endsWith('paciente.png')).toBe(true)
  })

  it('fiação da PartidaPage (issue #404): jogadorId → foto pela cor do peão', () => {
    const mapa = montarImagemPorJogador({
      j1: { cor: 'branco' },
      j2: { cor: 'vermelho' },
      j3: { cor: 'azul' },
      j4: { cor: 'amarelo' },
    })
    expect(Object.keys(mapa).sort()).toEqual(['j1', 'j2', 'j3', 'j4'])
    expect(mapa.j1.endsWith('diretor.png')).toBe(true)
    expect(mapa.j2.endsWith('enfermeira.png')).toBe(true)
    expect(mapa.j3.endsWith('janitor.png')).toBe(true)
    expect(mapa.j4.endsWith('paciente.png')).toBe(true)
    expect(montarImagemPorJogador({})).toEqual({})
  })

  it('variantes 2D por estado (extra PR #421): trio normal/amedrontada/baixa nos 4 slots', () => {
    expect(FOTOS_VARIANTES_POR_SLOT.size).toBe(4)
    expect(FOTOS_VARIANTES_POR_SLOT.get(0)?.normal.endsWith('diretor.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(0)?.amedrontada.endsWith('diretor_amedrontado.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(0)?.baixa.endsWith('diretor_baixa.png')).toBe(true)
    // Nome feminino: enfermeira_amedrontada.png (não _amedrontado).
    expect(FOTOS_VARIANTES_POR_SLOT.get(1)?.normal.endsWith('enfermeira.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(1)?.amedrontada.endsWith('enfermeira_amedrontada.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(1)?.baixa.endsWith('enfermeira_baixa.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(2)?.amedrontada.endsWith('janitor_amedrontado.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(2)?.baixa.endsWith('janitor_baixa.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(3)?.amedrontada.endsWith('paciente_amedrontado.png')).toBe(true)
    expect(FOTOS_VARIANTES_POR_SLOT.get(3)?.baixa.endsWith('paciente_baixa.png')).toBe(true)
  })

  it('foto por slot/cor resolve a variante: baixa > amedrontado > normal', () => {
    // Normal (sem estado) mantém a base.
    expect(fotoDoAvatarPorSlot(0)?.endsWith('diretor.png')).toBe(true)
    expect(fotoDoAvatarPorCor('vermelho')?.endsWith('enfermeira.png')).toBe(true)
    // Amedrontado sem baixa → variante amedrontada (feminino incluso).
    expect(fotoDoAvatarPorSlot(1, { amedrontado: true })?.endsWith('enfermeira_amedrontada.png')).toBe(true)
    expect(fotoDoAvatarPorCor('azul', { amedrontado: true })?.endsWith('janitor_amedrontado.png')).toBe(true)
    // Baixa Iluminação → variante baixa.
    expect(fotoDoAvatarPorSlot(0, { emBaixaIluminacao: true })?.endsWith('diretor_baixa.png')).toBe(true)
    expect(fotoDoAvatarPorCor('amarelo', { emBaixaIluminacao: true })?.endsWith('paciente_baixa.png')).toBe(true)
    // Ambos → baixa (prioridade da decisão do usuário).
    expect(
      fotoDoAvatarPorSlot(0, { amedrontado: true, emBaixaIluminacao: true })?.endsWith('diretor_baixa.png'),
    ).toBe(true)
    expect(
      fotoDoAvatarPorCor('vermelho', { amedrontado: true, emBaixaIluminacao: true })?.endsWith('enfermeira_baixa.png'),
    ).toBe(true)
  })

  it('foto com estado fora dos 4 slots segue null (fallback preservado)', () => {
    expect(fotoDoAvatarPorSlot(-1, { amedrontado: true })).toBeNull()
    expect(fotoDoAvatarPorSlot(4, { emBaixaIluminacao: true })).toBeNull()
  })

  it('montarImagemPorJogador misto: cada jogador resolve sua variante pelo próprio estado', () => {
    const mapa = montarImagemPorJogador({
      j1: { cor: 'branco' },
      j2: { cor: 'vermelho', amedrontado: true },
      j3: { cor: 'azul', emBaixaIluminacao: true },
      j4: { cor: 'amarelo', amedrontado: true, emBaixaIluminacao: true },
    })
    expect(mapa.j1.endsWith('diretor.png')).toBe(true)
    expect(mapa.j2.endsWith('enfermeira_amedrontada.png')).toBe(true)
    expect(mapa.j3.endsWith('janitor_baixa.png')).toBe(true)
    expect(mapa.j4.endsWith('paciente_baixa.png')).toBe(true)
  })
})
