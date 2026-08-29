import {
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  FOV_CAMERA,
  MARGEM_ENQUADRAMENTO,
} from './contrato'

export const LIMIAR_ARRASTO_PX = 6
export const FATOR_ZOOM_MAX = 2.8

export const ALTURA_MINIMA_ACIMA_MESA = ESPESSURA_MESA / 2 + 0.5
export const DISTANCIA_MINIMA_POR_ALTURA = ALTURA_MINIMA_ACIMA_MESA * Math.SQRT2

export type AlvoXZ = { x: number; z: number }

export function atingiuLimiar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= LIMIAR_ARRASTO_PX
}

export function worldPerPixel(fovGraus: number, distancia: number, clientHeight: number): number {
  if (clientHeight <= 0) return 0
  return (2 * Math.tan((fovGraus * Math.PI) / 360) * distancia) / clientHeight
}

export function panDeltaToWorld(
  dxPx: number,
  dyPx: number,
  fovGraus: number,
  distancia: number,
  clientHeight: number,
): AlvoXZ {
  const wpp = worldPerPixel(fovGraus, distancia, clientHeight)
  return { x: -dxPx * wpp, z: dyPx * wpp }
}

export function aspectoSeguro(aspect: number): number {
  if (Number.isFinite(aspect) && aspect > 0) return aspect
  return 1
}

export function resolverAltura(sizeHeight: number, canvasHeight: number): number {
  if (sizeHeight > 0) return sizeHeight
  if (canvasHeight > 0) return canvasHeight
  return 1
}

export function clampAlvo(
  alvo: AlvoXZ,
  distancia: number,
  fovGraus: number,
  aspect: number,
): AlvoXZ {
  const safeAspect = aspectoSeguro(aspect)
  const halfHeight = Math.tan((fovGraus * Math.PI) / 360) * distancia
  const halfWidth = halfHeight * safeAspect
  const maxPanX = Math.max(0, LARGURA_MESA / 2 - halfWidth)
  const maxPanZ = Math.max(0, PROFUNDIDADE_MESA / 2 - halfHeight)
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, alvo.x)),
    z: Math.max(-maxPanZ, Math.min(maxPanZ, alvo.z)),
  }
}

export function calcularDistanciaMin(): number {
  const meiaMaior = Math.max(LARGURA_MESA, PROFUNDIDADE_MESA) / 2
  return (meiaMaior * MARGEM_ENQUADRAMENTO) / Math.tan((FOV_CAMERA * Math.PI) / 360)
}

export function calcularDistanciaMax(distanciaMin: number): number {
  return distanciaMin / FATOR_ZOOM_MAX
}

function calcularDistanciaMaxEfetiva(distanciaMin: number, distanciaMaxTeorica: number): number {
  const lower = Math.max(distanciaMaxTeorica, DISTANCIA_MINIMA_POR_ALTURA)
  return Math.min(lower, distanciaMin)
}

export function clampDistancia(
  distancia: number,
  distanciaMin: number,
  distanciaMax: number,
): number {
  const maxEfetivo = calcularDistanciaMaxEfetiva(distanciaMin, distanciaMax)
  if (distancia > distanciaMin) return distanciaMin
  if (distancia < maxEfetivo) return maxEfetivo
  return distancia
}
