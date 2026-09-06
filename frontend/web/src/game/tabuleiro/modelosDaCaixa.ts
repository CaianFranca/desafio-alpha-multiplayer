/**
 * Modelos 3D da zona da Caixa (issue #274, spec #273).
 *
 * Seam puro: `caixa | cesta → URL` dos 2 GLBs já commitados em
 * `web/public/assets/3d-models/` (servidos sob
 * `import.meta.env.BASE_URL + assets/3d-models/…`, empacotados no `dist` via
 * `publicDir` — ver `frontend/vite.config.ts`). Sem three.js/DOM: só URLs e
 * o ajuste fino de normalização — testável em jsdom.
 *
 * A orientação e a escala finas dos GLBs ficam para feedback humano
 * pós-implementação (via screenshot): `AJUSTES_DOS_MODELOS_DA_CAIXA` é o
 * ponto único de ajuste (multiplicador de escala + rotação Y pós
 * normalização, por modelo), sem tocar no contrato nem no componente.
 */

export type NomeDoModeloDaCaixa = 'caixa' | 'cesta'

function baseAssets(): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return base.endsWith('/') ? base : `${base}/`
}

function modelo(nomeDoArquivo: string): string {
  return `${baseAssets()}assets/3d-models/${nomeDoArquivo}`
}

/** URLs dos GLBs da zona da Caixa (corpo + visual da bandeja). */
export const MODELOS_DA_CAIXA: Record<NomeDoModeloDaCaixa, string> = {
  caixa: modelo('wooden_box_with_maori_carving.glb'),
  cesta: modelo('serving_tray_model__realistic.glb'),
}

/** Os 2 modelos com visual próprio (ordem da zona, de trás para frente). */
export const NOMES_DOS_MODELOS_DA_CAIXA: readonly NomeDoModeloDaCaixa[] = [
  'caixa',
  'cesta',
]

/** Resolve a URL do GLB de um modelo da zona da Caixa. */
export function modeloDaCaixa(nome: NomeDoModeloDaCaixa): string {
  return MODELOS_DA_CAIXA[nome]
}

/**
 * Ajuste fino pós-normalização, por modelo — ponto único para o feedback
 * humano de orientação/escala (via screenshot):
 * - `escala`: multiplicador sobre a escala uniforme que cabe o modelo na
 *   pegada do contrato (`CAIXA_*` / `BANDEJA_*`).
 * - `rotacaoY`: giro em radianos aplicado DEPOIS da normalização (não muda a
 *   pegada calculada; só a apresentação).
 */
export interface AjusteDoModeloDaCaixa {
  readonly escala: number
  readonly rotacaoY: number
}

export const AJUSTES_DOS_MODELOS_DA_CAIXA: Record<
  NomeDoModeloDaCaixa,
  AjusteDoModeloDaCaixa
> = {
  caixa: { escala: 1, rotacaoY: 0 },
  cesta: { escala: 1, rotacaoY: 0 },
}
