/**
 * Modelos 3D da zona da Caixa (issue #274, spec #273).
 *
 * Só comportamento externo observável, nunca detalhe interno de material ou
 * asset: os 2 modelos resolvem URLs distintas sob `assets/3d-models/` com
 * extensão `.glb`, o ajuste fino nasce neutro (parametrizado para o feedback
 * humano via screenshot) e o contrato da zona da Caixa segue inalterado.
 */

import {
  BANDEJA_LARGURA,
  BANDEJA_PROFUNDIDADE,
  CAIXA_ALTURA,
  CAIXA_LARGURA,
  CAIXA_PROFUNDIDADE,
  POSICAO_BANDEJA,
  POSICAO_CAIXA,
  POSICAO_INICIAIS,
} from '../web/src/game/tabuleiro/contrato'
import {
  AJUSTES_DOS_MODELOS_DA_CAIXA,
  MODELOS_DA_CAIXA,
  NOMES_DOS_MODELOS_DA_CAIXA,
  modeloDaCaixa,
} from '../web/src/game/tabuleiro/modelosDaCaixa'

describe('modelos 3D da zona da Caixa', () => {
  it('cobre caixa + cesta com URLs distintas sob assets/3d-models/*.glb', () => {
    expect([...NOMES_DOS_MODELOS_DA_CAIXA].sort()).toEqual(['caixa', 'cesta'])
    expect(Object.keys(MODELOS_DA_CAIXA).sort()).toEqual(['caixa', 'cesta'])
    for (const nome of NOMES_DOS_MODELOS_DA_CAIXA) {
      const url = modeloDaCaixa(nome)
      expect(url).toBe(MODELOS_DA_CAIXA[nome])
      expect(url).toContain('assets/3d-models/')
      expect(url.endsWith('.glb')).toBe(true)
    }
    expect(MODELOS_DA_CAIXA.caixa).not.toBe(MODELOS_DA_CAIXA.cesta)
  })

  it('usa os GLBs já commitados (corpo da caixa + cesta da bandeja)', () => {
    expect(MODELOS_DA_CAIXA.caixa).toContain(
      'wooden_box_with_maori_carving.glb',
    )
    expect(MODELOS_DA_CAIXA.cesta).toContain(
      'serving_tray_model__realistic.glb',
    )
  })

  it('ajuste fino nasce neutro e parametrizado (escala 1, sem giro)', () => {
    for (const nome of NOMES_DOS_MODELOS_DA_CAIXA) {
      const ajuste = AJUSTES_DOS_MODELOS_DA_CAIXA[nome]
      expect(ajuste.escala).toBe(1)
      expect(ajuste.rotacaoY).toBe(0)
      expect(Number.isFinite(ajuste.escala)).toBe(true)
      expect(Number.isFinite(ajuste.rotacaoY)).toBe(true)
    }
  })

  it('contrato da zona da Caixa inalterado: posições e pegadas', () => {
    expect(POSICAO_CAIXA).toEqual([8.0, 0.02, -5.0])
    expect(POSICAO_BANDEJA).toEqual([8.0, 0.02, 0.0])
    expect(POSICAO_INICIAIS).toEqual([8.0, 0.02, 4.6])
    expect(CAIXA_LARGURA).toBe(2.4)
    expect(CAIXA_PROFUNDIDADE).toBe(1.8)
    expect(CAIXA_ALTURA).toBe(0.7)
    expect(BANDEJA_LARGURA).toBe(2.0)
    expect(BANDEJA_PROFUNDIDADE).toBe(2.0)
    // Ordem da zona +X, de trás (−z) para frente (+z): Caixa → bandeja → iniciais.
    expect(POSICAO_CAIXA[2]).toBeLessThan(POSICAO_BANDEJA[2])
    expect(POSICAO_BANDEJA[2]).toBeLessThan(POSICAO_INICIAIS[2])
  })
})
