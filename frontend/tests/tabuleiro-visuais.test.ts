/**
 * Visuais do tabuleiro (issue #278, spec #273).
 *
 * Só comportamento externo observável, nunca detalhe interno de material ou
 * asset: o grid resolve um par map/normal empacotado (mesmo padrão
 * `publicDir` das peças), distinto entre si e das peças; a geometria segue
 * quadrada e inalterada; o fallback grafite das bordas e o cursor pointer dos
 * destinos seguem preservados. O piso usa o `obscuro` contínuo da grade
 * (#274) e as paredes o par abismo (#278) — texturas distintas.
 */

import {
  BORDA_OFFSET,
  CELULA_INSET,
  COR_BORDA_CELULA,
  ESPESSURA_BORDA,
  LADO_DA_GRADE,
  LARGURA_TABULEIRO,
  PROFUNDIDADE_TABULEIRO,
  TAMANHO_CELULA,
} from '../web/src/game/tabuleiro/contrato'
import {
  TEXTURA_DO_TABULEIRO,
  texturaDoTabuleiro,
} from '../web/src/game/tabuleiro/texturasDoTabuleiro'
import {
  TEXTURA_OBSCURO_DA_GRADE,
  TEXTURAS_DAS_PECAS,
} from '../web/src/game/tabuleiro/texturasDasPecas'
import { handlersDeCursor } from '../web/src/game/tabuleiro/cursor'

describe('visuais do tabuleiro', () => {
  it('resolve par map/normal distinto e empacotado (assets/textures/*.jpg)', () => {
    const par = texturaDoTabuleiro()
    expect(par).toEqual(TEXTURA_DO_TABULEIRO)
    expect(par.map).toContain('assets/textures/')
    expect(par.map.endsWith('.jpg')).toBe(true)
    expect(par.normalMap).toContain('assets/textures/')
    expect(par.normalMap.endsWith('.jpg')).toBe(true)
    expect(par.normalMap).not.toBe(par.map)
    // Nomes do par isolado do grid, no padrão tabuleiro-*.jpg.
    expect(par.map).toContain('tabuleiro-')
    expect(par.normalMap).toContain('tabuleiro-')
  })

  it('par do grid não colide com nenhuma textura de peça', () => {
    const par = texturaDoTabuleiro()
    const dasPecas = Object.values(TEXTURAS_DAS_PECAS).flatMap((t) => [
      t.map,
      t.normalMap,
    ])
    expect(dasPecas).not.toContain(par.map)
    expect(dasPecas).not.toContain(par.normalMap)
  })

  it('geometria do grid inalterada: grade quadrada e contrato preservado', () => {
    expect(LADO_DA_GRADE).toBe(7)
    expect(TAMANHO_CELULA).toBeGreaterThan(0)
    expect(CELULA_INSET).toBeCloseTo(TAMANHO_CELULA * 0.98)
    expect(ESPESSURA_BORDA).toBeGreaterThan(0)
    expect(BORDA_OFFSET).toBeGreaterThanOrEqual(0)
    expect(LARGURA_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(PROFUNDIDADE_TABULEIRO).toBe(LADO_DA_GRADE * TAMANHO_CELULA)
    expect(LARGURA_TABULEIRO).toBe(PROFUNDIDADE_TABULEIRO)
  })

  it('piso e paredes usam texturas distintas (obscuro contínuo #274 × abismo #278)', () => {
    const par = texturaDoTabuleiro()
    expect(TEXTURA_OBSCURO_DA_GRADE).toContain('assets/textures/')
    expect(TEXTURA_OBSCURO_DA_GRADE).not.toBe(par.map)
    expect(TEXTURA_OBSCURO_DA_GRADE).not.toBe(par.normalMap)
  })

  it('contorno/cursor preservados: fallback grafite e pointer nos destinos', () => {
    // Fallback das bordas quando a textura ainda suspende (grafite da #274).
    expect(COR_BORDA_CELULA).toBe('#2e3138')
    // Cursor pointer dos destinos (vizinho/alvo/vaga) segue com os 3 handlers.
    const pointer = handlersDeCursor('pointer')
    expect(typeof pointer.onPointerOver).toBe('function')
    expect(typeof pointer.onPointerOut).toBe('function')
    expect(typeof pointer.onPointerLeave).toBe('function')
    const neutro = handlersDeCursor('default')
    expect(typeof neutro.onPointerOver).toBe('function')
  })
})
