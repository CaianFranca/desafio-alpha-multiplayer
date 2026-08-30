import {
  LIMIAR_ARRASTO_PX,
  FATOR_ZOOM_MAX,
  SENSIBILIDADE_WHEEL,
  DISTANCIA_MINIMA_POR_ALTURA,
  MARGEM_CAMERA_INTERATIVA,
  FATOR_INCLINACAO,
  atingiuLimiar,
  worldPerPixel,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaAfastada,
  calcularDistanciaProxima,
  clampDistancia,
  aspectoSeguro,
  aspectoDeSize,
  getBordaMolduraPxViaEstilo,
  aspectoVisivel,
  areaVisivel,
  resolverAltura,
  resolverDistanciaProximaEfetiva,
  validarRangeZoom,
  calcularFatorPinch,
  criarDragInicial,
  criarPinchInicial,
  poseCamera,
} from '../web/src/game/ambiente/cameraLimites'
import {
  FOV_CAMERA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  ESPESSURA_MESA,
  tangenteMeioFov,
  distanciaParaEnquadrar,
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

  it('usa tangenteMeioFov internamente', () => {
    const fov = 50
    const dist = 10
    const h = 500
    expect(worldPerPixel(fov, dist, h)).toBeCloseTo(
      (2 * tangenteMeioFov(fov) * dist) / h,
      10,
    )
  })

  it('retorna 0 quando clientHeight é zero', () => {
    expect(worldPerPixel(50, 10, 0)).toBe(0)
  })

  it('panDeltaToWorld inverte X e Z com fator 45° em Z', () => {
    const fov = 50
    const dist = 10
    const h = 600
    // Oráculo independente (não usa worldPerPixel) para evitar tautologia:
    // wpp = 2*tan(fov/2)*dist / h
    const wppEsperado = (2 * tangenteMeioFov(fov) * dist) / h
    const delta = panDeltaToWorld(10, 5, fov, dist, h)
    expect(delta.x).toBeCloseTo(-10 * wppEsperado, 10)
    expect(delta.z).toBeCloseTo(-5 * wppEsperado * FATOR_INCLINACAO, 10)
    expect(FATOR_INCLINACAO).toBeCloseTo(Math.SQRT2, 10)
  })

  it('panDeltaToWorld: proporção Z/X reflete FATOR_INCLINACAO', () => {
    const fov = 50
    const dist = 12
    const h = 600
    const dx = 10
    const dy = 10
    const delta = panDeltaToWorld(dx, dy, fov, dist, h)
    // Mesmo deslocamento em px deve gerar |delta.z| ≈ √2 * |delta.x|
    expect(Math.abs(delta.z)).toBeCloseTo(Math.abs(delta.x) * FATOR_INCLINACAO, 10)
    // Monotonicidade e sinal já cobertos, mas garante inclinação
    expect(delta.z / delta.x).toBeCloseTo(FATOR_INCLINACAO, 10)
  })

  it('arrastar para direita move alvo para esquerda (X negativo)', () => {
    const delta = panDeltaToWorld(20, 0, 50, 10, 500)
    expect(delta.x).toBeLessThan(0)
  })

  it('arrastar para baixo move alvo para trás (Z negativo) — revela topo', () => {
    const delta = panDeltaToWorld(0, 15, 50, 10, 500)
    expect(delta.z).toBeLessThan(0)
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

  it('SENSIBILIDADE_WHEEL exportada é 0.002', () => {
    expect(SENSIBILIDADE_WHEEL).toBe(0.002)
  })
})

describe('cameraLimites — aspectoDeSize / getBorda / aspectoVisivel', () => {
  it('aspectoDeSize delega para aspectoSeguro', () => {
    expect(aspectoDeSize({ width: 1920, height: 1080 })).toBeCloseTo(1920 / 1080, 10)
    expect(aspectoDeSize({ width: 0, height: 1080 })).toBe(1)
    expect(aspectoDeSize({ width: 800, height: 0 })).toBe(1)
    expect(aspectoDeSize({ width: -10, height: 100 })).toBe(1)
  })

  it('getBordaMolduraPxViaEstilo parseia string e number', () => {
    expect(getBordaMolduraPxViaEstilo('12px')).toBe(12)
    expect(getBordaMolduraPxViaEstilo('8px')).toBe(8)
    expect(getBordaMolduraPxViaEstilo('0px')).toBe(0)
    expect(getBordaMolduraPxViaEstilo('')).toBe(0)
    expect(getBordaMolduraPxViaEstilo('abc')).toBe(0)
    expect(getBordaMolduraPxViaEstilo(16)).toBe(16)
    expect(getBordaMolduraPxViaEstilo(0)).toBe(0)
    expect(getBordaMolduraPxViaEstilo(Number.NaN)).toBe(0)
    expect(getBordaMolduraPxViaEstilo(-5)).toBe(0)
    expect(getBordaMolduraPxViaEstilo('-3px')).toBe(0)
  })

  it('aspectoVisivel subtrai borda dos dois lados', () => {
    const size = { width: 1920, height: 1080 }
    // sem borda
    expect(aspectoVisivel(size, 0)).toBeCloseTo(1920 / 1080, 10)
    // com borda 8 (widthVis=1904, heightVis=1064)
    expect(aspectoVisivel(size, 8)).toBeCloseTo(1904 / 1064, 10)
    // com borda 12
    expect(aspectoVisivel(size, 12)).toBeCloseTo((1920 - 24) / (1080 - 24), 10)
  })

  it('aspectoVisivel fallback 1 quando visível ≤0', () => {
    expect(aspectoVisivel({ width: 10, height: 10 }, 10)).toBe(1)
    expect(aspectoVisivel({ width: 0, height: 0 }, 0)).toBe(1)
    expect(aspectoVisivel({ width: 100, height: 100 }, 100)).toBe(1)
  })

  it('areaVisivel retorna dimensões visíveis', () => {
    expect(areaVisivel({ width: 100, height: 80 }, 10)).toEqual({ width: 80, height: 60 })
    expect(areaVisivel({ width: 10, height: 10 }, 10)).toEqual({ width: 0, height: 0 })
  })

  it('distanciaParaEnquadrar e tangenteMeioFov coerentes', () => {
    const meia = 10
    expect(tangenteMeioFov(50)).toBeCloseTo(Math.tan((50 * Math.PI) / 360), 10)
    expect(distanciaParaEnquadrar(meia, 0.8, 50)).toBeCloseTo(
      (meia * 0.8) / Math.tan((50 * Math.PI) / 360),
      10,
    )
  })
})

describe('cameraLimites — poseCamera invariância 45°', () => {
  it('poseCamera mantém inclinação 45° e alvo em y=0', () => {
    const alvo = { x: 2, z: -3 }
    const dist = 17
    const { pos, alvo: alvoOut } = poseCamera(alvo, dist)
    const c = dist / Math.SQRT2
    expect(pos).toEqual([2, c, -3 + c])
    expect(alvoOut).toEqual([2, 0, -3])
    const altura = pos[1]
    const horiz = Math.hypot(pos[0] - alvoOut[0], pos[2] - alvoOut[2])
    expect(Math.atan2(altura, horiz)).toBeCloseTo(Math.PI / 4, 10)
  })

  it('poseCamera com alvo na origem coincide com descreverCameraFixa projetada', () => {
    const dist = calcularDistanciaAfastada(1)
    const { pos } = poseCamera({ x: 0, z: 0 }, dist)
    const c = dist / Math.SQRT2
    expect(pos[0]).toBeCloseTo(0, 10)
    expect(pos[1]).toBeCloseTo(c, 10)
    expect(pos[2]).toBeCloseTo(c, 10)
  })
})

describe('cameraLimites — limites de pan (FOV + aspect)', () => {
  it('clampAlvo dentro dos limites não altera', () => {
    const dist = calcularDistanciaAfastada()
    const aspect = 16 / 9
    const alvo = { x: 0, z: 0 }
    expect(clampAlvo(alvo, dist, FOV_CAMERA, aspect)).toEqual({ x: 0, z: 0 })
  })

  it('clampAlvo restringe X e Z quando fora (Z com fator 45°)', () => {
    const dist = calcularDistanciaAfastada()
    const aspect = 1
    const halfH = Math.tan((FOV_CAMERA * Math.PI) / 360) * dist
    const halfW = halfH * aspect
    const maxX = Math.max(0, LARGURA_MESA / 2 - halfW)
    const maxZ = Math.max(0, PROFUNDIDADE_MESA / 2 - halfH * FATOR_INCLINACAO)
    const fora = { x: 100, z: -100 }
    const clamp = clampAlvo(fora, dist, FOV_CAMERA, aspect)
    expect(clamp.x).toBeCloseTo(maxX, 6)
    expect(clamp.z).toBeCloseTo(-maxZ, 6)
  })

  it('maxPan aumenta quando distância diminui (zoom in)', () => {
    const distMin = calcularDistanciaAfastada()
    const distMax = calcularDistanciaProxima(distMin)
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
    const dist = calcularDistanciaAfastada()
    const clampZero = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, 0)
    const clampUm = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, 1)
    expect(clampZero).toEqual(clampUm)
  })

  it('aspect NaN também faz fallback para 1', () => {
    const dist = calcularDistanciaAfastada()
    const cNaN = clampAlvo({ x: 1, z: 1 }, dist, FOV_CAMERA, Number.NaN)
    const cUm = clampAlvo({ x: 1, z: 1 }, dist, FOV_CAMERA, 1)
    expect(cNaN).toEqual(cUm)
    expect(typeof cNaN.x).toBe('number')
    expect(typeof cNaN.z).toBe('number')
  })

  it('clampAlvo com borda 0 vs 16 vs 48: maxPan menor com borda maior', () => {
    const size = { width: 800, height: 600 }
    const dist = calcularDistanciaAfastada()
    const aspect0 = aspectoVisivel(size, 0)
    const aspect16 = aspectoVisivel(size, 16)
    const aspect48 = aspectoVisivel(size, 48)
    const m0 = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, aspect0)
    const m16 = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, aspect16)
    const m48 = clampAlvo({ x: 999, z: 999 }, dist, FOV_CAMERA, aspect48)
    // borda aumenta redução da área visível; pan limite não deve aumentar
    // comparação por maxPanX: com bordas similares o aspect muda pouco, mas não cresce
    expect(Math.abs(m16.x)).toBeLessThanOrEqual(Math.abs(m0.x) + 1e-9)
    expect(Math.abs(m48.x)).toBeLessThanOrEqual(Math.abs(m16.x) + 1e-9)
  })
})

describe('cameraLimites — zoom e clamp de distância', () => {
  it('FATOR_ZOOM_MAX define proporção afastada/proxima (comportamental)', () => {
    const afastada = calcularDistanciaAfastada()
    const proxima = calcularDistanciaProxima(afastada)
    // Invariante comportamental: proxima = afastada / FATOR_ZOOM_MAX e < afastada
    expect(proxima).toBeCloseTo(afastada / FATOR_ZOOM_MAX, 10)
    expect(proxima).toBeLessThan(afastada)
    expect(proxima).toBeGreaterThan(0)
    // Sanity de ordem de grandeza sem travar valor exato (evita lock de 2.8)
    expect(FATOR_ZOOM_MAX).toBeGreaterThan(1)
    expect(FATOR_ZOOM_MAX).toBeLessThan(10)
  })

  it('calcularDistanciaAfastada com margem enquadra Mesa e usa max(eixoH,eixoW)', () => {
    const halfTan = tangenteMeioFov(FOV_CAMERA)
    // Sem margem deve ser menor que com MARGEM_CAMERA_INTERATIVA
    const distH_semMargem = distanciaParaEnquadrar(PROFUNDIDADE_MESA / 2, 1, FOV_CAMERA)
    const distW_semMargem = (LARGURA_MESA / 2) / (halfTan * 1)
    const esperadoSemMargem = Math.max(distH_semMargem, distW_semMargem)
    const comMargem = calcularDistanciaAfastada()
    expect(comMargem).toBeGreaterThan(esperadoSemMargem)
    // Com aspect 1 deve ser max entre altura e largura com margem
    const distH = distanciaParaEnquadrar(PROFUNDIDADE_MESA / 2, MARGEM_CAMERA_INTERATIVA, FOV_CAMERA)
    const distW = (LARGURA_MESA / 2 * MARGEM_CAMERA_INTERATIVA) / (halfTan * 1)
    const esperadoComMargem = Math.max(distH, distW)
    expect(comMargem).toBeCloseTo(esperadoComMargem, 10)
    expect(calcularDistanciaAfastada(1)).toBeCloseTo(esperadoComMargem, 10)
    // Margem efetiva >1 garante respiro
    expect(MARGEM_CAMERA_INTERATIVA).toBeGreaterThan(1)
  })

  it('calcularDistanciaAfastada com aspect 16/9 vs 0.5: portrait maior', () => {
    const dLandscape = calcularDistanciaAfastada(16 / 9)
    const dPortrait = calcularDistanciaAfastada(0.5)
    const dSquare = calcularDistanciaAfastada(1)
    // landscape deve ser igual a square (domina altura), portrait deve ser maior (largura domina)
    expect(dLandscape).toBeCloseTo(dSquare, 10)
    expect(dPortrait).toBeGreaterThan(dSquare)
    const halfTan = tangenteMeioFov(FOV_CAMERA)
    const distH = (PROFUNDIDADE_MESA / 2 * MARGEM_CAMERA_INTERATIVA) / halfTan
    const distWPortrait = (LARGURA_MESA / 2 * MARGEM_CAMERA_INTERATIVA) / (halfTan * 0.5)
    expect(dPortrait).toBeCloseTo(Math.max(distH, distWPortrait), 10)
  })

  it('calcularDistanciaAfastada fallback aspect inválido → 1', () => {
    expect(calcularDistanciaAfastada(0)).toBeCloseTo(calcularDistanciaAfastada(1), 10)
    expect(calcularDistanciaAfastada(Number.NaN)).toBeCloseTo(calcularDistanciaAfastada(1), 10)
    expect(calcularDistanciaAfastada(undefined)).toBeCloseTo(calcularDistanciaAfastada(1), 10)
  })

  it('calcularDistanciaProxima = afastada / FATOR_ZOOM_MAX', () => {
    const min = calcularDistanciaAfastada()
    expect(calcularDistanciaProxima(min)).toBeCloseTo(min / FATOR_ZOOM_MAX, 10)
  })

  it('clampDistancia limita entre max (perto) e min (longe)', () => {
    const min = calcularDistanciaAfastada()
    const max = calcularDistanciaProxima(min)
    expect(clampDistancia(min + 10, min, max)).toBeCloseTo(min, 10)
    expect(clampDistancia(max - 10, min, max)).toBeCloseTo(Math.max(max, DISTANCIA_MINIMA_POR_ALTURA), 10)
    expect(clampDistancia((min + max) / 2, min, max)).toBeCloseTo((min + max) / 2, 10)
  })

  it('não cruza y=0: altura mínima > ESPESSURA/2 + 0.5', () => {
    const min = calcularDistanciaAfastada()
    const maxTeorico = calcularDistanciaProxima(min)
    const minAltDist = (ESPESSURA_MESA / 2 + 0.5) * Math.SQRT2
    const clamped = clampDistancia(0.1, min, maxTeorico)
    const altura = clamped / Math.SQRT2
    expect(altura).toBeGreaterThan(ESPESSURA_MESA / 2 + 0.5)
    expect(clamped).toBeGreaterThanOrEqual(minAltDist)
  })

  it('DISTANCIA_MINIMA_POR_ALTURA coerente com ESPESSURA', () => {
    expect(DISTANCIA_MINIMA_POR_ALTURA).toBeCloseTo((ESPESSURA_MESA / 2 + 0.5) * Math.SQRT2, 10)
  })

  it('resolverDistanciaProximaEfetiva e validarRangeZoom', () => {
    const min = calcularDistanciaAfastada()
    const max = calcularDistanciaProxima(min)
    expect(resolverDistanciaProximaEfetiva(min, max)).toBeGreaterThan(0)
    expect(resolverDistanciaProximaEfetiva(min, max)).toBeLessThanOrEqual(min)

    const r = validarRangeZoom(min, max)
    expect(r.efetivo).toBe(resolverDistanciaProximaEfetiva(min, max))
    expect(r.colapsou).toBe(false)
  })

  it('validarRangeZoom colapso quando DIST_MIN_ALT > min (mesa fictícia pequena)', () => {
    // Simula mesa muito pequena onde min teórico já é menor que altura mínima
    const minPequeno = 1
    const maxTeorico = 0.3
    const { efetivo, colapsou } = validarRangeZoom(minPequeno, maxTeorico)
    // lower = max(0.3, DIST_ALT≈2.12) = 2.12 ; efetivo = min(2.12,1)=1 → colapsou
    expect(efetivo).toBe(minPequeno)
    expect(colapsou).toBe(true)
    // clampDistancia nesse regime sempre retorna min
    expect(clampDistancia(0.5, minPequeno, maxTeorico)).toBe(minPequeno)
    expect(clampDistancia(2, minPequeno, maxTeorico)).toBe(minPequeno)
  })
})

describe('cameraLimites — re-clamp pós-zoom', () => {
  it('após zoom-out, alvo fora do novo limite é re-clampado via clampAlvo', () => {
    const min = calcularDistanciaAfastada()
    const max = calcularDistanciaProxima(min)
    const aspect = 1
    const alvoZoomIn = clampAlvo({ x: 4, z: 4 }, max, FOV_CAMERA, aspect)
    const reClamp = clampAlvo(alvoZoomIn, min, FOV_CAMERA, aspect)
    const direto = clampAlvo(alvoZoomIn, min, FOV_CAMERA, aspect)
    expect(reClamp).toEqual(direto)
    const maxPanMin = Math.max(0, LARGURA_MESA / 2 - Math.tan((FOV_CAMERA * Math.PI) / 360) * min * aspect)
    expect(Math.abs(reClamp.x)).toBeLessThanOrEqual(maxPanMin + 1e-9)
  })

  it('após zoom-in, limite amplia e alvo central permanece', () => {
    const min = calcularDistanciaAfastada()
    const max = calcularDistanciaProxima(min)
    const alvo = { x: 0, z: 0 }
    expect(clampAlvo(alvo, max, FOV_CAMERA, 1)).toEqual(alvo)
  })

  it('re-clamp diferencial: portrait vs landscape dão limites distintos em zoom fechado', () => {
    const dLandscapeMin = calcularDistanciaAfastada(16 / 9)
    const dPortraitMin = calcularDistanciaAfastada(0.5)
    const dLandscape = calcularDistanciaProxima(dLandscapeMin)
    const dPortrait = calcularDistanciaProxima(dPortraitMin)
    const alvo = { x: 5, z: 5 }
    const cLand = clampAlvo(alvo, dLandscape, FOV_CAMERA, 16 / 9)
    const cPort = clampAlvo(alvo, dPortrait, FOV_CAMERA, 0.5)
    // em distância mínima (longe, margem 1.05) ambos zeram; em zoom fechado o espaço para pan difere por orientação
    const cLandMin = clampAlvo(alvo, dLandscapeMin, FOV_CAMERA, 16 / 9)
    const cPortMin = clampAlvo(alvo, dPortraitMin, FOV_CAMERA, 0.5)
    expect(cLandMin).toEqual({ x: 0, z: 0 })
    expect(cPortMin).toEqual({ x: 0, z: 0 })
    // zoom fechado libera pan e resulta em limites distintos
    expect(cLand.x !== cPort.x || cLand.z !== cPort.z).toBe(true)
    expect(Math.abs(cLand.x) + Math.abs(cLand.z)).toBeGreaterThan(0)
    expect(Math.abs(cPort.x) + Math.abs(cPort.z)).toBeGreaterThan(0)
  })
})

describe('cameraLimites — calcularFatorPinch', () => {
  it('fator é distanciaInicial / distAtual', () => {
    expect(calcularFatorPinch(100, 50)).toBeCloseTo(2, 10)
    expect(calcularFatorPinch(100, 200)).toBeCloseTo(0.5, 10)
    expect(calcularFatorPinch(100, 100)).toBeCloseTo(1, 10)
  })

  it('protege divisão por zero', () => {
    expect(calcularFatorPinch(100, 0)).toBe(100)
    expect(Number.isFinite(calcularFatorPinch(50, 0))).toBe(true)
  })
})

describe('cameraLimites — pinch ancorado no mundo (integração do hook)', () => {
  // Replica a aritmética do hook useCameraInterativa:
  // novaDist = distanciaRef.current * calcularFatorPinch(distanciaInicial_px, distAtual_px)
  // Documenta a invariante que impede a regressão de R2: a base do zoom deve
  // ser a distância de mundo corrente, NUNCA o gap em px dos dedos.
  function novaDistanciaHook(world: number, inicioPx: number, atualPx: number): number {
    return world * calcularFatorPinch(inicioPx, atualPx)
  }

  it('pinch-in (dedos se afastam, atual > início) aproxima, não joga ao zoom-out', () => {
    const afastada = calcularDistanciaAfastada(16 / 9)
    const proxima = calcularDistanciaProxima(afastada)
    const world = afastada // câmera começa no teto do zoom
    const inicioPx = 100
    const atualPx = 200 // dedos se afastam → aproximar
    const novaDist = novaDistanciaHook(world, inicioPx, atualPx)
    const clamped = clampDistancia(novaDist, afastada, proxima)
    // Aproximação: distância final menor que a atual, dentro do range válido
    expect(novaDist).toBeLessThan(world)
    expect(clamped).toBeLessThan(world)
    expect(clamped).toBeGreaterThanOrEqual(proxima)
  })

  it('pinch-out (dedos se juntam, atual < início) afasta para o teto', () => {
    const afastada = calcularDistanciaAfastada(16 / 9)
    const proxima = calcularDistanciaProxima(afastada)
    const world = proxima // câmera começa no piso do zoom
    const inicioPx = 100
    const atualPx = 50 // dedos se juntam → afastar
    const novaDist = novaDistanciaHook(world, inicioPx, atualPx)
    const clamped = clampDistancia(novaDist, afastada, proxima)
    expect(novaDist).toBeGreaterThan(world)
    expect(clamped).toBeGreaterThan(world)
    expect(clamped).toBeLessThanOrEqual(afastada)
  })

  it('gap px não vaza para a unidade de mundo (regressão de ancoragem)', () => {
    const afastada = calcularDistanciaAfastada(16 / 9)
    const proxima = calcularDistanciaProxima(afastada)
    const world = afastada
    const inicioPx = 100
    const atualPx = 200
    const novaDist = novaDistanciaHook(world, inicioPx, atualPx)
    // Se a base fosse o gap em px (bug de R2), novaDist = início²/atual ≈ 50
    // e clamparia para o zoom-out máximo. Com a âncora no mundo, fica ~½ da
    // distância atual e permanece DENTRO do range (não colapsa no teto).
    const pxVazado = (inicioPx * inicioPx) / atualPx
    expect(novaDist).not.toBeCloseTo(pxVazado, 6)
    const clampedPxVazado = clampDistancia(pxVazado, afastada, proxima)
    const clampedAncorado = clampDistancia(novaDist, afastada, proxima)
    expect(clampedAncorado).toBeLessThan(clampedPxVazado)
  })
})

describe('cameraLimites — estado inicial drag/pinch', () => {
  it('criarDragInicial retorna objeto neutro', () => {
    expect(criarDragInicial()).toEqual({
      ativo: false,
      pointerId: null,
      inicioX: 0,
      inicioY: 0,
      ultimoX: 0,
      ultimoY: 0,
      engatado: false,
    })
    // cada chamada retorna nova instância
    expect(criarDragInicial()).not.toBe(criarDragInicial())
  })

  it('criarPinchInicial retorna sem centroInicial', () => {
    const p = criarPinchInicial()
    expect(p).toEqual({ ativo: false, distanciaInicial: 0 })
    expect((p as unknown as Record<string, unknown>).centroInicial).toBeUndefined()
  })
})
