/**
 * Contorno por casca invertida (follow-up de #275/#276/#277, spec #273).
 *
 * Substitui o destaque emissivo das peças e do peão: em vez de lavar a
 * textura com luz, renderiza-se uma casca (`meshBasicMaterial` `BackSide`,
 * sem tone mapping) ligeiramente maior que o corpo, visível só sob destaque.
 * Funciona com `frameloop="demand"` (geometria estática, sem animação).
 *
 * Este módulo é puro (sem WebGL, sem three): a cor do contorno deriva da
 * semântica já decidida pelo chamador — âmbar default nos destinos comuns,
 * azul-resgate preservado no resgate (`COR_DESTAQUE_RESGATE`), branco no
 * peão selecionado — e a cena só aplica o resultado no material.
 */

/** Âmbar default do contorno (mesmo tom do antigo destaque comum). */
export const COR_CONTORNO_PADRAO = '#ffe08a'

/** Branco do contorno do peão selecionado (legível sobre qualquer cor). */
export const COR_CONTORNO_PEAO_SELECIONADO = '#ffffff'

/**
 * Expansão em XZ da casca de contorno da peça (mesma altura e centro do
 * corpo — só a silhueta lateral vaza para fora).
 */
export const EXPANSAO_CONTORNO_PECA_XZ = 0.06

/**
 * Escala uniforme das cascas de contorno do peão (uma por segmento, ~1.15–1.2
 * para vazar a silhueta sem descolar do corpo).
 */
export const ESCALA_CONTORNO_PEAO = 1.18

/**
 * Cor do contorno da peça a partir do destaque já derivado pelo chamador
 * (`Celula` passa `COR_DESTAQUE_RESGATE` no resgate, `undefined` no comum).
 */
export function corDoContornoDaPeca(corDestaque?: string): string {
  return corDestaque ?? COR_CONTORNO_PADRAO
}

/**
 * Props do material da casca de contorno: cor chapada, sem tone mapping
 * (fiel à semântica em cena ACES) — o `side={THREE.BackSide}` vive no JSX.
 */
export function propsDoMaterialDeContorno(cor: string): {
  color: string
  toneMapped: false
} {
  return { color: cor, toneMapped: false }
}
