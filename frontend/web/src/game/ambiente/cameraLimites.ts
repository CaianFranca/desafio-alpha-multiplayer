import {
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  FOV_CAMERA,
  MARGEM_ENQUADRAMENTO,
  componenteInclinacao45,
  distanciaParaEnquadrar,
  tangenteMeioFov,
} from './contrato'

export const LIMIAR_ARRASTO_PX = 6
export const FATOR_ZOOM_MAX = 2.8
export const SENSIBILIDADE_WHEEL = 0.002

export const ALTURA_MINIMA_ACIMA_MESA = ESPESSURA_MESA / 2 + 0.5
export const DISTANCIA_MINIMA_POR_ALTURA = ALTURA_MINIMA_ACIMA_MESA * Math.SQRT2

export type AlvoXZ = { x: number; z: number }

export function atingiuLimiar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= LIMIAR_ARRASTO_PX
}

export function worldPerPixel(fovGraus: number, distancia: number, clientHeight: number): number {
  if (clientHeight <= 0) return 0
  return (2 * tangenteMeioFov(fovGraus) * distancia) / clientHeight
}

export function panDeltaToWorld(
  dxPx: number,
  dyPx: number,
  fovGraus: number,
  distancia: number,
  clientHeight: number,
): AlvoXZ {
  const wpp = worldPerPixel(fovGraus, distancia, clientHeight)
  return { x: -dxPx * wpp, z: -dyPx * wpp }
}

export function aspectoSeguro(aspect: number): number {
  if (Number.isFinite(aspect) && aspect > 0) return aspect
  return 1
}

export function aspectoDeSize(size: { width: number; height: number }): number {
  const raw = size.width > 0 && size.height > 0 ? size.width / size.height : 1
  return aspectoSeguro(raw)
}

export function getBordaMolduraPxViaEstilo(borderWidth: string | number): number {
  if (typeof borderWidth === 'number') {
    return Number.isFinite(borderWidth) && borderWidth >= 0 ? borderWidth : 0
  }
  const v = parseFloat(borderWidth)
  if (!Number.isFinite(v) || v < 0) return 0
  return v
}

function normalizarBordaPx(bordaPx: number): number {
  return Number.isFinite(bordaPx) && bordaPx >= 0 ? bordaPx : 0
}

function dimensoesVisiveis(
  size: { width: number; height: number },
  bordaPx: number,
): { widthVis: number; heightVis: number } {
  const b = normalizarBordaPx(bordaPx)
  return { widthVis: size.width - 2 * b, heightVis: size.height - 2 * b }
}

export function aspectoVisivel(
  size: { width: number; height: number },
  bordaPx: number,
): number {
  const { widthVis, heightVis } = dimensoesVisiveis(size, bordaPx)
  if (widthVis <= 0 || heightVis <= 0) return 1
  return aspectoSeguro(widthVis / heightVis)
}

export function areaVisivel(
  size: { width: number; height: number },
  bordaPx: number,
): { width: number; height: number } {
  const { widthVis, heightVis } = dimensoesVisiveis(size, bordaPx)
  return { width: Math.max(0, widthVis), height: Math.max(0, heightVis) }
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
  const halfHeight = tangenteMeioFov(fovGraus) * distancia
  const halfWidth = halfHeight * safeAspect
  const maxPanX = Math.max(0, LARGURA_MESA / 2 - halfWidth)
  const maxPanZ = Math.max(0, PROFUNDIDADE_MESA / 2 - halfHeight)
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, alvo.x)),
    z: Math.max(-maxPanZ, Math.min(maxPanZ, alvo.z)),
  }
}

export function calcularDistanciaMin(aspectVisivel?: number): number {
  const halfTan = tangenteMeioFov(FOV_CAMERA)
  const distH = distanciaParaEnquadrar(PROFUNDIDADE_MESA / 2, MARGEM_ENQUADRAMENTO, FOV_CAMERA)
  const aspect = aspectoSeguro(aspectVisivel ?? 1)
  const distW = (LARGURA_MESA / 2 * MARGEM_ENQUADRAMENTO) / (halfTan * aspect)
  return Math.max(distH, distW)
}

export function calcularDistanciaMax(distanciaMin: number): number {
  return distanciaMin / FATOR_ZOOM_MAX
}

export function resolverDistanciaMaxEfetiva(
  distanciaMin: number,
  distanciaMaxTeorica: number,
): number {
  const lower = Math.max(distanciaMaxTeorica, DISTANCIA_MINIMA_POR_ALTURA)
  return Math.min(lower, distanciaMin)
}

export function validarRangeZoom(
  min: number,
  maxTeorico: number,
): { efetivo: number; colapsou: boolean } {
  const efetivo = resolverDistanciaMaxEfetiva(min, maxTeorico)
  return { efetivo, colapsou: efetivo >= min }
}

export function clampDistancia(
  distancia: number,
  distanciaMin: number,
  distanciaMax: number,
): number {
  const maxEfetivo = resolverDistanciaMaxEfetiva(distanciaMin, distanciaMax)
  if (distancia > distanciaMin) return distanciaMin
  if (distancia < maxEfetivo) return maxEfetivo
  return distancia
}

export interface EstadoDrag {
  ativo: boolean
  pointerId: number | null
  inicioX: number
  inicioY: number
  ultimoX: number
  ultimoY: number
  engatado: boolean
}

export const criarDragInicial = (): EstadoDrag => ({
  ativo: false,
  pointerId: null,
  inicioX: 0,
  inicioY: 0,
  ultimoX: 0,
  ultimoY: 0,
  engatado: false,
})

export interface EstadoPinch {
  ativo: boolean
  distInicial: number
  distanciaInicial: number
}

export const criarPinchInicial = (): EstadoPinch => ({
  ativo: false,
  distInicial: 0,
  distanciaInicial: 0,
})

export function calcularFatorPinch(distInicial: number, distAtual: number): number {
  return distInicial / (distAtual || 1)
}

export function distanciaEntrePontos(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanciaPinch(ponteiros: Map<number, { x: number; y: number }>): number {
  const pts = Array.from(ponteiros.values())
  if (pts.length < 2) return 0
  return distanciaEntrePontos(pts[0], pts[1])
}

export function poseCamera(
  alvo: AlvoXZ,
  distancia: number,
): { pos: [number, number, number]; alvo: [number, number, number] } {
  const c = componenteInclinacao45(distancia)
  return { pos: [alvo.x, c, alvo.z + c], alvo: [alvo.x, 0, alvo.z] }
}
