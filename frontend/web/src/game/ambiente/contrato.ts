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
 * no frustum vertical (1.0 = encostado; > 1 = folga para a borda da Mesa).
 */
export const MARGEM_ENQUADRAMENTO = 1.15

/**
 * Cor do fundo/vazio: quase-preto amostrado das bordas da textura
 * (mesa_topo.png tem bordas escuras que se fundem nesse tom).
 */
export const COR_FUNDO = '#0a0a0c'

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
export function descreverCameraFixa(
  larguraMesa: number,
  profundidadeMesa: number,
  fov: number,
): CameraFixa {
  const meiaMaiorDimensao = Math.max(larguraMesa, profundidadeMesa) / 2
  const distancia = (meiaMaiorDimensao * MARGEM_ENQUADRAMENTO) / Math.tan((fov * Math.PI) / 360)
  // Inclinação de 45°: atan2(altura, distanciaHorizontal) = atan2(c, c) = 45°.
  const componente = distancia / Math.SQRT2
  return { posicao: [0, componente, componente], alvo: [0, 0, 0] }
}
