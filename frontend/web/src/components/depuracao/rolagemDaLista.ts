/**
 * Detecção de "está no fundo" da lista do painel de depuração (issue #340).
 *
 * Módulo separado do componente por causa do react-refresh: exportar função
 * não-componente junto de componente dispara only-export-components. Isolada
 * para ser testável — jsdom não faz layout, os testes stubam as propriedades
 * de scroll.
 */

/** Tolerância (~px) para considerar "no fundo" — absorve arredondamento de subpixel. */
const MARGEM_DO_FUNDO = 20

/** O usuário está no fim da lista? Sem elemento (painel não montou) conta como no fundo. */
export function estaNoFundo(elemento: HTMLElement | null): boolean {
  if (elemento === null) return true
  return elemento.scrollTop + elemento.clientHeight >= elemento.scrollHeight - MARGEM_DO_FUNDO
}
