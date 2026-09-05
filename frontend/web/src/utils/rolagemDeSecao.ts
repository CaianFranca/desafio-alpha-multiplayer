/**
 * Rola a página até o topo da seção ficar a 20% da altura da viewport.
 * Diferente de `scrollIntoView({ block: 'start' })` — que encosta a seção
 * no topo, sob o header sticky — aqui há uma margem de respiro acima.
 */
export function rolarSecaoParaCentro(id: string, behavior: ScrollBehavior) {
  const secao = document.getElementById(id)
  if (!secao) return
  const topoAbsoluto = secao.getBoundingClientRect().top + window.scrollY
  const alvo = Math.max(0, topoAbsoluto - window.innerHeight * 0.2)
  window.scrollTo({ top: alvo, behavior })
}
