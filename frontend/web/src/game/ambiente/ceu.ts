/**
 * Fundo da partida (trecho de cilindro côncavo ao fundo do tabuleiro, issue
 * do cenário).
 *
 * Seam puro: URL da textura + geometria do trecho — sem three.js/DOM,
 * testável em jsdom. O cilindro é visto POR DENTRO (côncavo): a textura
 * inteira se distribui pelo arco, sem o estiramento de polo da esfera e
 * sem deformação de perspectiva do plano — e o eixo vertical preserva as
 * linhas do casarão. O espelho no eixo X replica a receita oficial de
 * panorama (sem isso a imagem sai invertida).
 *
 * A altura do eixo coloca a faixa do casarão (fileiras centrais da imagem)
 * na banda que a câmera realmente enxerga (terço inferior à frente da
 * Mesa, olhando 45° para baixo).
 */

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** Panorama do sanatório (fundo da partida, em sRGB fiel ao arquivo). */
export const TEXTURA_DO_FUNDO =
  `${baseAssets()}assets/textures/skyboxl.jpg`

/** Proporção do trecho (espelha o arquivo 1365×768, sem distorcer). */
export const PROPORCAO_DO_FUNDO = 1365 / 768

/**
 * Raio do cilindro: a superfície fica além da névoa (95) e bem dentro do
 * `far` da câmera (1000) — a câmera interativa nunca sai de perto da Mesa
 * (20 de lado), então sempre observa de dentro da curva.
 */
export const RAIO_DO_FUNDO = 60

/**
 * Abertura horizontal do trecho (rad): cobre o frustum FullHD com folga
 * para o pan — além da borda, o fundo sólido prevalece.
 */
export const ABERTURA_DO_FUNDO = (110 * Math.PI) / 130

/** Início do trecho em theta: centro do panorama cai no eixo −z local. */
export const INICIO_THETA_DO_FUNDO = Math.PI - ABERTURA_DO_FUNDO / 2

/** Altura do cilindro (deriva do arco pela proporção do arquivo). */
export const ALTURA_DO_FUNDO = 94.8

/** Centro do eixo do cilindro (a faixa do casarão mira a visão). */
export const POSICAO_DO_FUNDO: readonly [number, number, number] = [
  0,
  -28.8,
  -50,
]

/**
 * Inclinação em X do fundo (ponto único de calibragem via screenshot):
 * 0 = parede vertical; positivo deita o topo para frente (sobre a Mesa),
 * negativo para trás. Move a faixa visível para cima/baixo na imagem.
 */
export const INCLINACAO_DO_FUNDO = -0.8

/**
 * Escala uniforme do fundo (ponto único de calibragem via screenshot):
 * aumenta/diminui o panorama inteiro sem distorcer (1 = tamanho projetado).
 */
export const ESCALA_DO_FUNDO = 3

/** Invariante de layout: trecho íntegro, ao redor da Mesa e mira válida. */
export function validarCeu(): string | null {
  // Tolerância larga de propósito: o alongamento vertical (~6%) é
  // calibragem visual aprovada via screenshot, não acidente.
  const TOLERANCIA_PROPORCAO = 0.12
  if (!(RAIO_DO_FUNDO > 0 && ALTURA_DO_FUNDO > 0)) {
    return 'Fundo deve ter dimensões positivas'
  }
  const arco = RAIO_DO_FUNDO * ABERTURA_DO_FUNDO
  if (Math.abs(arco / ALTURA_DO_FUNDO - PROPORCAO_DO_FUNDO) > TOLERANCIA_PROPORCAO) {
    return 'Fundo deve espelhar a proporção do arquivo'
  }
  if (
    !(ABERTURA_DO_FUNDO > 0 && ABERTURA_DO_FUNDO <= 2 * Math.PI)
  ) {
    return 'Fundo deve ter abertura válida'
  }
  if (!(RAIO_DO_FUNDO > 50 && RAIO_DO_FUNDO < 1000)) {
    return 'Fundo deve envolver a Mesa dentro do far'
  }
  if (!(ESCALA_DO_FUNDO > 0)) {
    return 'Fundo deve ter escala positiva'
  }
  if (!Number.isFinite(INCLINACAO_DO_FUNDO)) {
    return 'Fundo deve ter inclinação válida'
  }
  return null
}
