import {
  MARGEM_ENQUADRAMENTO,
  COR_FUNDO,
  COR_LATERAIS_MESA,
  ESPESSURA_MESA,
  FOV_CAMERA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  descreverCameraFixa,
} from '../web/src/game/ambiente/contrato'

function canais(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

describe('contrato do ambiente de jogo', () => {
  it('Mesa quadrada, com dimensões positivas, cujo plano superior é a origem (y = 0)', () => {
    expect(LARGURA_MESA).toBeGreaterThan(0)
    expect(PROFUNDIDADE_MESA).toBe(LARGURA_MESA)
    expect(ESPESSURA_MESA).toBeGreaterThan(0)
    // A origem [0, 0, 0] é o centro do plano superior da Mesa; a espessura
    // só se estende para y negativo e a câmera mira essa origem.
  })

  it('câmera fixa mira a origem [0, 0, 0]', () => {
    const { alvo } = descreverCameraFixa(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA)
    expect(alvo).toEqual([0, 0, 0])
  })

  it('câmera fixa tem inclinação de referência de 45° e altura positiva', () => {
    const { posicao } = descreverCameraFixa(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA)
    const [x, altura, z] = posicao
    expect(altura).toBeGreaterThan(0)
    const elevacao = Math.atan2(altura, Math.hypot(x, z))
    expect(elevacao).toBeCloseTo(Math.PI / 4, 10)
  })

  it('câmera enquadra a margem da maior dimensão da Mesa conforme o FOV', () => {
    const { posicao } = descreverCameraFixa(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA)
    const [, altura, z] = posicao
    const distancia = Math.hypot(altura, z)
    const meiaAlturaVisivel = Math.tan((FOV_CAMERA * Math.PI) / 360) * distancia
    // A câmera cobre MARGEM_ENQUADRAMENTO da maior dimensão: margem < 1
    // aproxima o enquadramento e corta a borda escura da textura fora da tela.
    expect(meiaAlturaVisivel).toBeCloseTo((LARGURA_MESA / 2) * MARGEM_ENQUADRAMENTO, 6)
  })

  it('exporta cores do tema: fundo quase-preto e laterais escuras', () => {
    expect(canais(COR_FUNDO).every((c) => c <= 0x14)).toBe(true)
    expect(canais(COR_LATERAIS_MESA).every((c) => c <= 0x20)).toBe(true)
  })
})
