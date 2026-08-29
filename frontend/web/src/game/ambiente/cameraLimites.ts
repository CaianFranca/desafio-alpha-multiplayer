/**
 * Matemática pura da câmera interativa (issue #77).
 *
 * - Pan translada alvo no plano XZ, mantendo offset fixo normalizado [0,1,1] * distancia.
 * - Limites relativos à Mesa considerando frustum (FOV + aspect) e MARGEM_ENQUADRAMENTO.
 * - Zoom centrado: min enquadra Mesa+MARGEM, max = min / FATOR_ZOOM_MAX sem cruzar y=0.
 * - Limiar de arrasto para preservar clique.
 *
 * Sem three.js / DOM — testável em unidade.
 */
import {
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  FOV_CAMERA,
  MARGEM_ENQUADRAMENTO,
} from './contrato'

export const LIMIAR_ARRASTO_PX = 6
export const FATOR_ZOOM_MAX = 2.8

/** Altura mínima acima do plano da Mesa para não cruzar y=0 (margem de segurança 0.5m). */
export const ALTURA_MINIMA_ACIMA_MESA = ESPESSURA_MESA / 2 + 0.5
export const DISTANCIA_MINIMA_POR_ALTURA = ALTURA_MINIMA_ACIMA_MESA * Math.SQRT2

/**
 * Verdadeiro quando o deslocamento em pixels atingiu o limiar de arrasto.
 * Usa Math.hypot para norma euclidiana.
 */
export function atingiuLimiar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= LIMIAR_ARRASTO_PX
}

/**
 * Conversão pixel → mundo no plano da Mesa.
 * worldPerPixel = 2 * tan(fov/2) * dist / clientHeight
 */
export function worldPerPixel(fovGraus: number, distancia: number, clientHeight: number): number {
  if (clientHeight <= 0) return 0
  return (2 * Math.tan((fovGraus * Math.PI) / 360) * distancia) / clientHeight
}

/**
 * Converte delta de arrasto em pixels para delta em mundo (XZ).
 * X invertido para seguir o gesto (arrastar para direita move alvo para esquerda).
 */
export function panDeltaToWorld(
  dxPx: number,
  dyPx: number,
  fovGraus: number,
  distancia: number,
  clientHeight: number,
): { x: number; z: number } {
  const wpp = worldPerPixel(fovGraus, distancia, clientHeight)
  return { x: -dxPx * wpp, z: dyPx * wpp }
}

function fallbackAspect(): number {
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return window.innerWidth / window.innerHeight
  }
  return 1
}

function aspectoSeguro(aspect: number): number {
  if (Number.isFinite(aspect) && aspect > 0) return aspect
  return fallbackAspect()
}

/**
 * Limites de pan relativos à Mesa e ao frustum.
 * halfHeight = tan(fov/2) * dist ; halfWidth = halfHeight * aspect
 * maxPan = max(0, mesa/2 - half)  — mantém a borda da Mesa fora do vazio
 * se a Mesa cabe inteira, clamp em 0 (sem pan).
 */
export function clampAlvo(
  alvo: { x: number; z: number },
  distancia: number,
  fovGraus: number,
  aspect: number,
  larguraMesa: number = LARGURA_MESA,
  profundidadeMesa: number = PROFUNDIDADE_MESA,
): { x: number; z: number } {
  const safeAspect = aspectoSeguro(aspect)
  const halfHeight = Math.tan((fovGraus * Math.PI) / 360) * distancia
  const halfWidth = halfHeight * safeAspect
  const maxPanX = Math.max(0, larguraMesa / 2 - halfWidth)
  const maxPanZ = Math.max(0, profundidadeMesa / 2 - halfHeight)
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, alvo.x)),
    z: Math.max(-maxPanZ, Math.min(maxPanZ, alvo.z)),
  }
}

/**
 * Distância mais afastada (zoom mínimo) que enquadra a maior dimensão da Mesa
 * com MARGEM_ENQUADRAMENTO, idêntica a descreverCameraFixa.
 */
export function calcularDistanciaMin(
  larguraMesa: number = LARGURA_MESA,
  profundidadeMesa: number = PROFUNDIDADE_MESA,
  fovGraus: number = FOV_CAMERA,
): number {
  const meiaMaior = Math.max(larguraMesa, profundidadeMesa) / 2
  return (meiaMaior * MARGEM_ENQUADRAMENTO) / Math.tan((fovGraus * Math.PI) / 360)
}

/**
 * Distância mais próxima (zoom máximo) = min / FATOR_ZOOM_MAX.
 * O clamp de altura é aplicado em clampDistancia, não aqui.
 */
export function calcularDistanciaMax(distanciaMin: number): number {
  return distanciaMin / FATOR_ZOOM_MAX
}

function calcularDistanciaMaxEfetiva(distanciaMin: number, distanciaMaxTeorica: number): number {
  const lower = Math.max(distanciaMaxTeorica, DISTANCIA_MINIMA_POR_ALTURA)
  // Se a altura mínima exceder o min (mesa hipotética muito pequena), a distância mínima efetiva é o próprio min.
  return Math.min(lower, distanciaMin)
}

/**
 * Clampa distância entre [maxEfetivo, min], garantindo altura > ESPESSURA/2+0.5
 * e re-clamp implícito do alvo deve ser feito separadamente via clampAlvo.
 */
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

/**
 * Helper para re-clampar o alvo após mudança de distância/zoom.
 */
export function reclampAlvoAposZoom(
  alvo: { x: number; z: number },
  novaDistancia: number,
  fovGraus: number,
  aspect: number,
  larguraMesa: number = LARGURA_MESA,
  profundidadeMesa: number = PROFUNDIDADE_MESA,
): { x: number; z: number } {
  return clampAlvo(alvo, novaDistancia, fovGraus, aspect, larguraMesa, profundidadeMesa)
}
