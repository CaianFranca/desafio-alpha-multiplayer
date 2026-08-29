import {
  LIMIAR_ARRASTO_PX,
  FATOR_ZOOM_MAX,
  DISTANCIA_MINIMA_POR_ALTURA,
  atingiuLimiar,
  worldPerPixel,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaMin,
  calcularDistanciaMax,
  clampDistancia,
  aspectoSeguro,
  resolverAltura,
} from '../web/src/game/ambiente/cameraLimites'
import {
  FOV_CAMERA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  ESPESSURA_MESA,
  MARGEM_ENQUADRAMENTO,
} from '../web/src/game/ambiente/contrato'

describe('cameraLimites — limiar de arrasto', () => {
  it('constante do limiar é 6px', () => {
    expect(LIMIAR_ARRASTO_PX).toBe(6)
  })

  it('não atinge limiar abaixo de 6px', () => {
    expect(atingiuLimiar(3, 4)).toBe(false)
    expect(atingiuLimiar(5, 0)).toBe(false)
    expect(atingiuLimiar(0, 0)).toBe(false)
  })

  it('atinge limiar exatamente em 6px', () => {
    expect(atingiuLimiar(6, 0)).toBe(true)
    expect(atingiuLimiar(0, 6)).toBe(true)
    expect(atingiuLimiar(3, 4) === false).toBe(true)
    const c = 6 / Math.SQRT2
    expect(atingiuLimiar(c, c)).toBe(true)
  })

  it('atinge limiar acima de 6px', () => {
    expect(atingiuLimiar(10, 0)).toBe(true)
    expect(atingiuLimiar(6, 6)).toBe(true)
  })

  it('preserva clique: deslocamento pequeno não deve ser considerado arrasto', () => {
    const dx = 2
    const dy = 2
    expect(atingiuLimiar(dx, dy)).toBe(false)
  })
})

describe('cameraLimites — conversão px→mundo', () => {
  it('worldPerPixel segue 2*tan(fov/2)*dist / clientHeight', () => {
    const fov = 50
    const dist = 17
    const h = 800
    const esperado = (2 * Math.tan((fov * Math.PI) / 360) * dist) / h
    expect(worldPerPixel(fov, dist, h)).toBeCloseTo(esperado, 10)
  })

  it('retorna 0 quando clientHeight é zero', () => {
    expect(worldPerPixel(50, 10, 0)).toBe(0)
  })

  it('panDeltaToWorld inverte X e preserva Z', () => {
    const fov = 50
    const dist = 10
    const h = 600
    const wpp = worldPerPixel(fov, dist, h)
    const delta = panDeltaToWorld(10, 5, fov, dist, h)
    expect(delta.x).toBeCloseTo(-10 * wpp, 10)
    expect(delta.z).toBeCloseTo(5 * wpp, 10)
  })

  it('arrastar para direita move alvo para esquerda (X negativo)', () => {
    const delta = panDeltaToWorld(20, 0, 50, 10, 500)
    expect(delta.x).toBeLessThan(0)
  })

  it('arrastar para baixo move alvo para frente (Z positivo)', () => {
    const delta = panDeltaToWorld(0, 15, 50, 10, 500)
    expect(delta.z).toBeGreaterThan(0)
  })
})

describe('cameraLimites — helpers determinísticos', () => {
  it('aspectoSeguro retorna aspecto válido e 1 para inválidos', () => {
    expect(aspectoSeguro(16 / 9)).toBeCloseTo(16 / 9)
    expect(aspectoSeguro(0)).toBe(1)
    expect(aspectoSeguro(-1)).toBe(1)
    expect(aspectoSeguro(Number.NaN)).toBe(1)
    expect(aspectoSeguro(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('resolverAltura prioriza size, depois canvas, depois 1', () => {
    expect(resolverAltura(600, 500)).toBe(600)
    expect(resolverAltura(0, 500)).toBe(500)
    expect(resolverAltura(0, 0)).toBe(1)
    expect(resolverAltura(-10, 0)).toBe(1)
  })
})

describe('cameraLimites — limites de pan (FOV + aspect)', () => {
  it('clampAlvo dentro dos limites não altera', () => {
    const dist = calcularDistanciaMin()
    const aspect = 16 / 9
    const alvo = { x: 0, z: 0 }
    expect(clampAlvo(alvo, dist, FOV_CAMERA, aspect)).toEqual({ x: 0, z: 0 })
  })

  it('clampAlvo restringe X e Z quando fora', () => {
    const dist = calcularDistanciaMin()
    const aspect = 1
    const halfH = Math.tan((FOV_CAMERA * Math.PI) / 360) * dist
    const halfW = halfH * aspect
    const maxX = Math.max(0, LARGURA_MESA / 2 - halfW)
    const maxZ = Math.max(0, PROFUNDIDADE_MESA / 2 - halfH)
    const fora = { x: 100, z: -100 }
    const clamp = clampAlvo(fora, dist, FOV_CAMERA, aspect)
    expect(clamp.x).toBeCloseTo(maxX, 6)
    expect(clamp.z).toBeCloseTo(-maxZ, 6)
  })

  it('maxPan aumenta quando distância diminui (zoom in)', () => {
    const distMin = calcularDistanciaMin()
    const distMax = calcularDistanciaMax(distMin)
    const aspect = 1.5
    const c1 = clampAlvo({ x: 999, z: 999 }, distMin, FOV_CAMERA, aspect)
    const c2 = clampAlvo({ x: 999, z: 999 }, distMax, FOV_CAMERA, aspect)
    expect(Math.abs(c2.x)).toBeGreaterThanOrEqual(Math.abs(c1.x))
    expect(Math.abs(c2.z)).toBeGreaterThanOrEqual(Math.abs(c1.z))
  })

  it('quando frustum maior que Mesa, maxPan é zero (sem pan)', () => {
    const distGrande = 100
    const clamp = clampAlvo({ x: 5, z: 5 }, distGrande, FOV_CAMERA, 1)
    expect(clamp).toEqual({ x: 0, z: 0 })
  })

  it('aspect zero faz fallback determinístico para 1', () => {
    const dist = calcularDistanciaMin()
    const clampZero = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, 0)
    const clampUm = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, 1)
    expect(clampZero).toEqual(clampUm)
  })

  it('aspect NaN também faz fallback para 1', () => {
    const dist = calcularDistanciaMin()
    const cNaN = clampAlvo({ x: 1, z: 1 }, dist, FOV_CAMERA, Number.NaN)
    const cUm = clampAlvo({ x: 1, z: 1 }, dist, FOV_CAMERA, 1)
    expect(cNaN).toEqual(cUm)
    expect(typeof cNaN.x).toBe('number')
    expect(typeof cNaN.z).toBe('number')
  })
})

describe('cameraLimites — zoom e clamp de distância', () => {
  it('FATOR_ZOOM_MAX é 2.8', () => {
    expect(FATOR_ZOOM_MAX).toBe(2.8)
  })

  it('calcularDistanciaMin usa MARGEM_ENQUADRAMENTO 0.8', () => {
    const meiaMaior = Math.max(LARGURA_MESA, PROFUNDIDADE_MESA) / 2
    const esperado = (meiaMaior * MARGEM_ENQUADRAMENTO) / Math.tan((FOV_CAMERA * Math.PI) / 360)
    expect(calcularDistanciaMin()).toBeCloseTo(esperado, 10)
  })

  it('calcularDistanciaMax = min / 2.8', () => {
    const min = calcularDistanciaMin()
    expect(calcularDistanciaMax(min)).toBeCloseTo(min / 2.8, 10)
  })

  it('clampDistancia limita entre max (perto) e min (longe)', () => {
    const min = calcularDistanciaMin()
    const max = calcularDistanciaMax(min)
    expect(clampDistancia(min + 10, min, max)).toBeCloseTo(min, 10)
    expect(clampDistancia(max - 10, min, max)).toBeCloseTo(Math.max(max, DISTANCIA_MINIMA_POR_ALTURA), 10)
    expect(clampDistancia((min + max) / 2, min, max)).toBeCloseTo((min + max) / 2, 10)
  })

  it('não cruza y=0: altura mínima > ESPESSURA/2 + 0.5', () => {
    const min = calcularDistanciaMin()
    const maxTeorico = calcularDistanciaMax(min)
    const minAltDist = (ESPESSURA_MESA / 2 + 0.5) * Math.SQRT2
    const clamped = clampDistancia(0.1, min, maxTeorico)
    const altura = clamped / Math.SQRT2
    expect(altura).toBeGreaterThan(ESPESSURA_MESA / 2 + 0.5)
    expect(clamped).toBeGreaterThanOrEqual(minAltDist)
  })

  it('DISTANCIA_MINIMA_POR_ALTURA coerente com ESPESSURA', () => {
    expect(DISTANCIA_MINIMA_POR_ALTURA).toBeCloseTo((ESPESSURA_MESA / 2 + 0.5) * Math.SQRT2, 10)
  })
})

describe('cameraLimites — re-clamp pós-zoom', () => {
  it('após zoom-out, alvo fora do novo limite é re-clampado via clampAlvo', () => {
    const min = calcularDistanciaMin()
    const max = calcularDistanciaMax(min)
    const aspect = 1
    const alvoZoomIn = clampAlvo({ x: 4, z: 4 }, max, FOV_CAMERA, aspect)
    const reClamp = clampAlvo(alvoZoomIn, min, FOV_CAMERA, aspect)
    const direto = clampAlvo(alvoZoomIn, min, FOV_CAMERA, aspect)
    expect(reClamp).toEqual(direto)
    const maxPanMin = Math.max(0, LARGURA_MESA / 2 - Math.tan((FOV_CAMERA * Math.PI) / 360) * min * aspect)
    expect(Math.abs(reClamp.x)).toBeLessThanOrEqual(maxPanMin + 1e-9)
  })

  it('após zoom-in, limite amplia e alvo central permanece', () => {
    const min = calcularDistanciaMin()
    const max = calcularDistanciaMax(min)
    const alvo = { x: 0, z: 0 }
    expect(clampAlvo(alvo, max, FOV_CAMERA, 1)).toEqual(alvo)
  })
})
