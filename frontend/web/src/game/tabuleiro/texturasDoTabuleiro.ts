/**
 * Textura do tabuleiro (issue #278, spec #273).
 *
 * Seam puro: par único `{ map, normalMap }` para as paredes do grid
 * (plano da Célula vazia + 4 bordas), com leitura de escuridão/abismo do
 * sanatório — névoa e bordas de abismo como sugestão, coerente com a Limpeza
 * que engole peças — sem alterar tamanho/proporção.
 *
 * Assets `tabuleiro-abismo.jpg` (cor, sRGB) + `tabuleiro-abismoNP.jpg`
 * (relevo, linear) em `web/public/assets/textures/`, servidos sob
 * `import.meta.env.BASE_URL + assets/textures/…` e empacotados no `dist` via
 * `publicDir` — mesmo padrão das peças (`texturasDasPecas.ts`, ver
 * `frontend/vite.config.ts`). Sem three.js/DOM: só URLs — testável em jsdom.
 *
 * Pendência humana (decisão do plano): o asset final é alinhado com PO/time
 * e enviado para aprovação em grupo — os JPGs entram manualmente no repo; o
 * seam e a cena já resolvem este par isolado, fácil de trocar sem tocar em
 * geometria/interação.
 */

export interface TexturaDoTabuleiro {
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
 * Par único do grid (plano + bordas compartilham o motivo): sufixo `NP` no
 * normal, no mesmo padrão das peças de caminho (`*2.jpg` + `*NP.jpg`).
 */
export const TEXTURA_DO_TABULEIRO: TexturaDoTabuleiro = {
  map: textura('tabuleiro-abismo.jpg'),
  normalMap: textura('tabuleiro-abismoNP.jpg'),
}

/** Resolve o par map/normalMap do tabuleiro. */
export function texturaDoTabuleiro(): TexturaDoTabuleiro {
  return TEXTURA_DO_TABULEIRO
}
