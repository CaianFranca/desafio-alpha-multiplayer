/**
 * Fundo da partida: só comportamento externo observável.
 *
 * O panorama resolve sob `assets/textures/skyboxl.jpg` num trecho de
 * cilindro côncavo com a proporção do arquivo (sem distorcer), envolvendo
 * a Mesa com a faixa do casarão na visão.
 */

import {
  ABERTURA_DO_FUNDO,
  ALTURA_DO_FUNDO,
  ESCALA_DO_FUNDO,
  INCLINACAO_DO_FUNDO,
  POSICAO_DO_FUNDO,
  PROPORCAO_DO_FUNDO,
  RAIO_DO_FUNDO,
  TEXTURA_DO_FUNDO,
  validarCeu,
} from '../web/src/game/ambiente/ceu'

describe('fundo da partida', () => {
  it('panorama resolve sob assets/textures/skyboxl.jpg', () => {
    expect(TEXTURA_DO_FUNDO).toContain('assets/textures/')
    expect(TEXTURA_DO_FUNDO).toContain('skyboxl.jpg')
  })

  it('trecho calibrado via screenshot (alongamento vertical sutil)', () => {
    expect(PROPORCAO_DO_FUNDO).toBeCloseTo(1365 / 768)
    // Arco/altura ≈ 1.68 (arquivo 1.78): o estirão vertical é intencional.
    expect((RAIO_DO_FUNDO * ABERTURA_DO_FUNDO) / ALTURA_DO_FUNDO).toBeCloseTo(
      1.6824,
      3,
    )
    expect(validarCeu()).toBeNull()
  })

  it('curva envolve a Mesa além da névoa e dentro do far', () => {
    expect(RAIO_DO_FUNDO).toBeGreaterThan(50)
    expect(RAIO_DO_FUNDO).toBeLessThan(1000)
    expect(ABERTURA_DO_FUNDO).toBeCloseTo((110 * Math.PI) / 130)
    const [x, , z] = POSICAO_DO_FUNDO
    expect(x).toBe(0)
    expect(z).toBe(-50)
  })

  it('inclinação e escala calibradas via screenshot', () => {
    expect(INCLINACAO_DO_FUNDO).toBe(-0.8)
    expect(ESCALA_DO_FUNDO).toBe(3)
  })
})
