import {
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  FOV_CAMERA,
  componenteInclinacao45,
  distanciaParaEnquadrar,
  tangenteMeioFov,
} from './contrato'

export const LIMIAR_ARRASTO_PX = 6
export const LIMIAR_POR_TIPO: Record<string, number> = {
  mouse: 6,
  pen: 8,
  touch: 10,
}
export const FATOR_ZOOM_MAX = 2.8
export const SENSIBILIDADE_WHEEL = 0.002

/** Margem da câmera interativa: >1 para deixar respiro entre borda da Mesa e frustum. */
export const MARGEM_CAMERA_INTERATIVA = 1.05

/**
 * Fator de inclinação 45° (√2): projeção do movimento vertical da tela no
 * eixo Z do mundo quando a câmera está inclinada 45° sobre o plano da Mesa.
 *
 * Fundamento geométrico: com a câmera a 45° (altura == distância horizontal
 * ao alvo, cf. `componenteInclinacao45`), um deslocamento no plano
 * perpendicular à câmera corresponde a um deslocamento maior no chão. O
 * fator √2 (≈1.414) é `1 / cos(45°)` e converte span vertical em span no
 * chão. Usado em `panDeltaToWorld` (dyPx → delta.z) e em `clampAlvo`
 * (`halfHeightVis * FATOR_INCLINACAO` para span no chão inclinado).
 *
 * Mantido como √2 por recalibragem intencional — não unificar sem revisar
 * `calcularDistanciaAfastada` (ver JSDoc lá).
 */
export const FATOR_INCLINACAO = Math.SQRT2

export const ALTURA_MINIMA_ACIMA_MESA = ESPESSURA_MESA / 2 + 0.5
export const DISTANCIA_MINIMA_POR_ALTURA = ALTURA_MINIMA_ACIMA_MESA * Math.SQRT2

export type AlvoXZ = { x: number; z: number }

/** Ponto 2D genérico (px ou mundo) para helpers de geometria de ponteiros. */
export type Ponto2D = { x: number; y: number }

export function atingiuLimiar(dx: number, dy: number, pointerType?: string): boolean {
  const tipo = pointerType ?? 'mouse'
  const limiar = LIMIAR_POR_TIPO[tipo] ?? LIMIAR_ARRASTO_PX
  return Math.hypot(dx, dy) >= limiar
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
  return { x: -dxPx * wpp, z: -dyPx * wpp * FATOR_INCLINACAO }
}

export function aspectoSeguro(aspect: number): number {
  if (Number.isFinite(aspect) && aspect > 0) return aspect
  return 1
}

// ── helpers internos ──

/** @internal — helper de teste/derivado, não faz parte da API pública */
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

/** @internal — helper de teste/derivado, não faz parte da API pública */
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

/**
 * Clampa o alvo XZ para que o frustum não ultrapasse a Mesa.
 * `halfHeightVis * FATOR_INCLINACAO` modela o span vertical projetado no
 * chão inclinado a 45° (ver JSDoc de `FATOR_INCLINACAO`); sem o fator, o
 * clamp subestima o espaço ocupado no eixo Z.
 */
export function clampAlvo(
  alvo: AlvoXZ,
  distancia: number,
  fovGraus: number,
  aspect: number,
): AlvoXZ {
  const safeAspect = aspectoSeguro(aspect)
  const halfHeightVis = tangenteMeioFov(fovGraus) * distancia
  const halfWidthVis = halfHeightVis * safeAspect
  const maxPanX = Math.max(0, LARGURA_MESA / 2 - halfWidthVis)
  const maxPanZ = Math.max(0, PROFUNDIDADE_MESA / 2 - halfHeightVis * FATOR_INCLINACAO)
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, alvo.x)),
    z: Math.max(-maxPanZ, Math.min(maxPanZ, alvo.z)),
  }
}

/**
 * Distância mais afastada (teto do zoom) que ainda enquadra a Mesa com a margem interativa.
 * @param aspectVisivel - aspect da área visível (descontada a borda da moldura)
 *
 * Nota sobre FATOR_INCLINACAO: `distH`/`distW` aqui são calculados no plano
 * perpendicular à câmera (sem `* FATOR_INCLINACAO`), intencionalmente
 * conservador vs `clampAlvo` que aplica `* FATOR_INCLINACAO` no chão. Unificar
 * (aplicar √2 aqui) aumentaria `distanciaAfastada` ~1.414× e exigiria
 * recalibragem de zoom/pan — documentado, não alterado nesta PR.
 */
export function calcularDistanciaAfastada(aspectVisivel?: number): number {
  const halfTan = tangenteMeioFov(FOV_CAMERA)
  const distH = distanciaParaEnquadrar(PROFUNDIDADE_MESA / 2, MARGEM_CAMERA_INTERATIVA, FOV_CAMERA)
  const aspect = aspectoSeguro(aspectVisivel ?? 1)
  const distW = (LARGURA_MESA / 2 * MARGEM_CAMERA_INTERATIVA) / (halfTan * aspect)
  return Math.max(distH, distW)
}

/**
 * Distância mais próxima teórica (piso do zoom) derivada da afastada e do fator de zoom.
 * @param distanciaAfastada - valor retornado por calcularDistanciaAfastada
 */
export function calcularDistanciaProxima(distanciaAfastada: number): number {
  return distanciaAfastada / FATOR_ZOOM_MAX
}

export function resolverDistanciaProximaEfetiva(
  distanciaAfastada: number,
  distanciaProximaTeorica: number,
): number {
  const lower = Math.max(distanciaProximaTeorica, DISTANCIA_MINIMA_POR_ALTURA)
  return Math.min(lower, distanciaAfastada)
}

/** @internal — helper de teste/derivado, não faz parte da API pública */
export function validarRangeZoom(
  distanciaAfastada: number,
  distanciaProximaTeorica: number,
): { efetivo: number; colapsou: boolean } {
  const efetivo = resolverDistanciaProximaEfetiva(distanciaAfastada, distanciaProximaTeorica)
  return { efetivo, colapsou: efetivo >= distanciaAfastada }
}

export function clampDistancia(
  distancia: number,
  distanciaAfastada: number,
  distanciaProxima: number,
): number {
  const proximaEfetiva = resolverDistanciaProximaEfetiva(distanciaAfastada, distanciaProxima)
  if (distancia > distanciaAfastada) return distanciaAfastada
  if (distancia < proximaEfetiva) return proximaEfetiva
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

/**
 * Estado do gesto de pinça (pinch) para zoom.
 * @property distanciaInicial - distância entre ponteiros no início do gesto
 */
export interface EstadoPinch {
  ativo: boolean
  distanciaInicial: number
}

export const criarPinchInicial = (): EstadoPinch => ({
  ativo: false,
  distanciaInicial: 0,
})

export function calcularFatorPinch(distanciaInicial: number, distAtual: number): number {
  return distanciaInicial / (distAtual || 1)
}

export function distanciaEntrePontos(a: Ponto2D, b: Ponto2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanciaPinch(ponteiros: Map<number, Ponto2D>): number {
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
