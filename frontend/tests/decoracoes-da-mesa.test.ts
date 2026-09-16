/**
 * Decorações da Mesa: só comportamento externo observável.
 *
 * A vela resolve URL sob `assets/3d-models/vela.glb`, fica a noroeste da
 * Caixa, fora do tabuleiro central e dentro da Mesa 20×20.
 */

import {
  AJUSTES_DAS_DECORACOES,
  MODELOS_DAS_DECORACOES,
  NOMES_DAS_DECORACOES,
  POSICAO_VELA,
  escalaEfetivaDaDecoracao,
  modeloDaDecoracao,
  validarPosicaoDaVela,
} from '../web/src/game/tabuleiro/decoracoesDaMesa'
import { POSICAO_CAIXA } from '../web/src/game/tabuleiro/contrato'

describe('decorações da Mesa', () => {
  it('vela resolve URL sob assets/3d-models/vela.glb', () => {
    expect([...NOMES_DAS_DECORACOES]).toEqual(['vela'])
    const url = modeloDaDecoracao('vela')
    expect(url).toBe(MODELOS_DAS_DECORACOES.vela)
    expect(url).toContain('assets/3d-models/')
    expect(url).toContain('vela.glb')
  })

  it('vela a noroeste da Caixa, fora do tabuleiro e dentro da Mesa', () => {
    expect(validarPosicaoDaVela()).toBeNull()
    const [x, y, z] = POSICAO_VELA
    expect(y).toBe(0)
    expect(x).toBeLessThan(POSICAO_CAIXA[0])
    expect(z).toBeLessThan(POSICAO_CAIXA[2])
  })

  it('ajuste inicial contido (×1, sem giro)', () => {
    expect(AJUSTES_DAS_DECORACOES.vela.escala).toBe(1)
    expect(AJUSTES_DAS_DECORACOES.vela.rotacaoY).toBe(0)
  })

  it('escala efetiva aplica o multiplicador sobre o encaixe', () => {
    const escala = escalaEfetivaDaDecoracao(
      1.2,
      1.2,
      { x: 1, y: 1, z: 1 },
      AJUSTES_DAS_DECORACOES.vela,
    )
    expect(escala).toBeCloseTo(1.2)
  })
})
