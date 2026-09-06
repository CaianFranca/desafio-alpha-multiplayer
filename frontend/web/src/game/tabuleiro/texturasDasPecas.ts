/**
 * Texturas das peças (issues #275/#276/#277, spec #273).
 *
 * Seam puro: `TipoDaPeca → { map, normalMap }` cobrindo os 10 tipos com os 20
 * JPGs já commitados em `web/public/assets/textures/` (servidos sob
 * `import.meta.env.BASE_URL + assets/textures/…`, empacotados no `dist` via
 * `publicDir` — ver `frontend/vite.config.ts`). Sem three.js/DOM: só URLs e
 * o ângulo do motivo por orientação — testável em jsdom.
 */

import type { Orientacao, TipoDaPeca } from './contrato'

/** Par de texturas de um tipo de peça: cor (sRGB) + relevo (linear). */
export interface TexturaDaPeca {
  readonly map: string
  readonly normalMap: string
}

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

function textura(nomeDoArquivo: string): string {
  return `${baseAssets()}assets/textures/${nomeDoArquivo}`
}

/**
 * Pareamento aprovado (decisão do plano): L/inicial, reto, T, cruz, gerador,
 * diretor, médica, portão usam sufixo `2` (cor) + `NP` (normal); monstros
 * usam o nome base + `NM` no normal. Todos `.jpg`.
 */
export const TEXTURAS_DAS_PECAS: Record<TipoDaPeca, TexturaDaPeca> = {
  inicial: {
    map: textura('caminho-L-inicial2.jpg'),
    normalMap: textura('caminho-L-inicialNP.jpg'),
  },
  reta: {
    map: textura('caminho-reto2.jpg'),
    normalMap: textura('caminho-retoNP.jpg'),
  },
  T: {
    map: textura('caminho-t2.jpg'),
    normalMap: textura('caminho-tNP.jpg'),
  },
  cruz: {
    map: textura('caminho-cruz2.jpg'),
    normalMap: textura('caminho-cruzNP.jpg'),
  },
  gerador: {
    map: textura('gerador2.jpg'),
    normalMap: textura('geradorNP.jpg'),
  },
  sala_do_diretor: {
    map: textura('sala-diretor2.jpg'),
    normalMap: textura('sala-diretorNP.jpg'),
  },
  sala_medica: {
    map: textura('sala-medica2.jpg'),
    normalMap: textura('sala-medicaNP.jpg'),
  },
  portao_de_saida: {
    map: textura('portao2.jpg'),
    normalMap: textura('portaoNP.jpg'),
  },
  vulto: {
    map: textura('vulto.jpg'),
    normalMap: textura('vultoNM.jpg'),
  },
  espectro: {
    map: textura('espectro.jpg'),
    normalMap: textura('espectroNM.jpg'),
  },
}

/** Os 10 tipos com visual próprio (ordem canônica do contrato). */
export const TIPOS_COM_TEXTURA: readonly TipoDaPeca[] = [
  'inicial',
  'reta',
  'T',
  'cruz',
  'gerador',
  'sala_do_diretor',
  'sala_medica',
  'portao_de_saida',
  'vulto',
  'espectro',
]

/** Resolve o par map/normalMap de um tipo de peça. */
export function texturaDaPeca(tipo: TipoDaPeca): TexturaDaPeca {
  return TEXTURAS_DAS_PECAS[tipo]
}

/**
 * Rotação do motivo pela orientação da peça (radianos, para
 * `texture.center = (0.5, 0.5)` + `texture.rotation`).
 *
 * A orientação do tabuleiro gira no sentido horário vista de cima
 * (`bordasAbertas`: norte→leste aos 90°); `Texture.rotation` é
 * anti-horária no UV — por isso o sinal negativo.
 */
export function rotacaoDoMotivo(orientacao: Orientacao): number {
  if (orientacao === 0) return 0
  return (-orientacao * Math.PI) / 180
}
