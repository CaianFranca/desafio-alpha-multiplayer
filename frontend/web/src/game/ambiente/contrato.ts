/**
 * Contrato de coordenadas e constantes do ambiente de jogo (issue #75).
 *
 * ORIGEM DO ESPAÇO: [0, 0, 0] é o CENTRO DO PLANO SUPERIOR da Mesa.
 * O plano superior fica em y = 0; a espessura da Mesa se estende para
 * y negativo. Todo posicionamento futuro (grade 7x7 do ADR-0004, peças,
 * reserva) deve se apoiar nesse plano, com +x para a direita, +z para
 * "baixo" na tela (em direção à câmera) e +y para cima.
 *
 * O módulo é puro: sem three.js, sem DOM — testável isoladamente.
 */

/**
 * Dimensões da Mesa (quadrada): dimensionada para acomodar a grade 7x7 do
 * ADR-0004 mais a reserva dos jogadores. Ajustável antes da ST-10; a origem
 * no centro do plano superior não muda.
 */
export const LARGURA_MESA = 20
export const PROFUNDIDADE_MESA = 20
export const ESPESSURA_MESA = 2

/** FOV vertical da câmera fixa (graus). */
export const FOV_CAMERA = 50

/**
 * Margem de enquadramento: fração da maior dimensão da Mesa que deve caber
 * no frustum vertical (1.0 = encostado; < 1 aproxima a câmera e corta a
 * borda escura da textura fora da tela, ampliando o centro iluminado).
 */
export const MARGEM_ENQUADRAMENTO = 0.8

/**
 * Cor do fundo/vazio: o preto ao redor da Mesa na textura (mesa_topo.png),
 * de modo que o vazio funda com a borda da textura sem costura visível.
 */
export const COR_FUNDO = '#010101'

/** Cor sólida das laterais/base da Mesa (tom escuro coerente com o vazio). */
export const COR_LATERAIS_MESA = '#141112'

export interface CameraFixa {
  posicao: [number, number, number]
  alvo: [number, number, number]
}

/**
 * Deriva a pose da câmera fixa: inclinação de referência de 45° (a altura
 * acima do plano da Mesa é igual à distância horizontal até a origem),
 * alvo na origem [0, 0, 0] e distância calculada para enquadrar a maior
 * dimensão da Mesa com a margem definida.
 */
export function tangenteMeioFov(fovGraus: number): number {
  return Math.tan((fovGraus * Math.PI) / 360)
}

export function distanciaParaEnquadrar(
  meiaMaior: number,
  margem: number,
  fovGraus: number,
): number {
  return (meiaMaior * margem) / tangenteMeioFov(fovGraus)
}

export function componenteInclinacao45(distancia: number): number {
  return distancia / Math.SQRT2
}

export function descreverCameraFixa(
  larguraMesa: number,
  profundidadeMesa: number,
  fov: number,
): CameraFixa {
  const meiaMaiorDimensao = Math.max(larguraMesa, profundidadeMesa) / 2
  const distancia = distanciaParaEnquadrar(meiaMaiorDimensao, MARGEM_ENQUADRAMENTO, fov)
  const componente = componenteInclinacao45(distancia)
  return { posicao: [0, componente, componente], alvo: [0, 0, 0] }
}
