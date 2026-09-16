/**
 * Névoa da Mesa (pura, sem three.js/DOM — testável em jsdom).
 *
 * Manchas posicionáveis: pouca névoa sobre o tampo (quadriculado legível)
 * e densa ao redor da Mesa, abraçando a borda por baixo — como na
 * referência. Manchas de topo têm um buraco quadrado sobre o tabuleiro
 * 7×7; as laterais são cheias. Ponto único de ajuste (`MANCHAS_DA_NEVOA`).
 */

import { LARGURA_MESA, PROFUNDIDADE_MESA } from '../ambiente/contrato'
import { LARGURA_TABULEIRO, PROFUNDIDADE_TABULEIRO } from './contrato'

/**
 * Meio-lado da zona limpa (quadrado central sem névoa): cobre o meio-lado
 * do tabuleiro (5.6) com margem — a pena do gerador dissolve a borda.
 */
export const MEIO_BURACO_NEVOA = 6.2

/** Tom da névoa: escuro e frio, quase encostando no vazio — o contorno
 * contra o escuro some porque quase não há contraste; o calor das velas
 * vem das luzes da cena e levanta a névoa só perto das chamas. */
export const COR_NEVOA = '#565d66'

/** Mancha de névoa: centro XZ, altura, pegada, opacidade, giro e buraco. */
export interface ManchaDeNevoa {
  readonly centro: readonly [number, number]
  readonly y: number
  readonly largura: number
  readonly profundidade: number
  readonly opacidade: number
  readonly giro: number
  /** Com buraco sobre o tabuleiro (só as de topo). */
  readonly comBuraco: boolean
}

export const MANCHAS_DA_NEVOA: readonly ManchaDeNevoa[] = [
  // Topo (fraca): quadriculado limpo para leitura do jogo.
  { centro: [0, 0], y: 0.12, largura: 19, profundidade: 19, opacidade: 0.3, giro: 0, comBuraco: true },
  { centro: [0, 0], y: 0.3, largura: 19, profundidade: 19, opacidade: 0.2, giro: Math.PI / 2, comBuraco: true },
  // Lados (densos, sem vincos): ao redor da Mesa, abaixo da borda — sem
  // sobreposição entre vizinhas (o cruzamento de dois quads transparentes
  // desenha um vinco claro) e só se tocam em quina. Opacidade contida: com
  // o tom escuro, o contorno contra o vazio some.
  { centro: [0, -15], y: -2.5, largura: 20, profundidade: 10, opacidade: 0.35, giro: 0, comBuraco: false },
  { centro: [0, 15], y: -3.1, largura: 20, profundidade: 10, opacidade: 0.35, giro: 0.4, comBuraco: false },
  { centro: [15, 0], y: -2.7, largura: 10, profundidade: 20, opacidade: 0.35, giro: 1.2, comBuraco: false },
  { centro: [-15, 0], y: -3.3, largura: 10, profundidade: 20, opacidade: 0.35, giro: 2.0, comBuraco: false },
]

/** Invariante de layout: topo contido com buraco, lados ao redor sem flutuar. */
export function validarNevoaDaMesa(): string | null {
  for (const [indice, mancha] of MANCHAS_DA_NEVOA.entries()) {
    const [cx, cz] = mancha.centro
    if (
      !(mancha.largura > 0 && mancha.profundidade > 0) ||
      !(mancha.opacidade > 0 && mancha.opacidade < 1) ||
      !Number.isFinite(mancha.giro)
    ) {
      return `Névoa ${indice} deve ter pegada, opacidade e giro válidos`
    }
    if (mancha.comBuraco) {
      // No tampo: contida na Mesa, baixa, com o buraco cobrindo o tabuleiro.
      if (
        Math.abs(cx) + mancha.largura / 2 > LARGURA_MESA / 2 ||
        Math.abs(cz) + mancha.profundidade / 2 > PROFUNDIDADE_MESA / 2
      ) {
        return `Névoa ${indice} deve caber no tampo da Mesa`
      }
      if (!(mancha.y > 0 && mancha.y < 2)) {
        return `Névoa ${indice} deve flutuar baixa sobre o tampo`
      }
      if (
        MEIO_BURACO_NEVOA <
        Math.max(LARGURA_TABULEIRO, PROFUNDIDADE_TABULEIRO) / 2 + 0.3
      ) {
        return 'Buraco da névoa deve cobrir o tabuleiro'
      }
    } else {
      // Ao redor: fora da pegada da Mesa, na altura da borda ou abaixo.
      const foraX = Math.abs(cx) - mancha.largura / 2 >= LARGURA_MESA / 2 - 1
      const foraZ = Math.abs(cz) - mancha.profundidade / 2 >= PROFUNDIDADE_MESA / 2 - 1
      if (!(foraX || foraZ)) {
        return `Névoa ${indice} deve ficar ao redor da Mesa`
      }
      if (!(mancha.y > -8 && mancha.y <= 0.5)) {
        return `Névoa ${indice} deve ficar na altura da borda ou abaixo`
      }
    }
  }
  // Alturas todas distintas: sem faces coplanares entre manchas sobrepostas.
  const alturas = MANCHAS_DA_NEVOA.map((mancha) => mancha.y)
  if (new Set(alturas).size !== MANCHAS_DA_NEVOA.length) {
    return 'Manchas de névoa devem ter alturas distintas'
  }
  return null
}
