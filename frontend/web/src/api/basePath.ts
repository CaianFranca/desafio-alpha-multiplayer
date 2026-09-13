/**
 * Base path do app (subpath, ex.: `/server01/`).
 *
 * O mesmo bundle pode ser servido na raiz (`/`) ou sob um prefixo controlado
 * em build-time por `VITE_BASE_PATH` (ver `frontend/vite.config.ts`). O Vite
 * injeta esse valor em `import.meta.env.BASE_URL`, sempre com barra final
 * (`/`, `/server01/`). Estes helpers centralizam a normalização para que
 * chamadas absolutas (`/api/...`, `/media/...`, `/assets/...`, `/ws/...`)
 * continuem funcionando nos dois cenários.
 *
 * As funções são puras e aceitam o `base` como parâmetro opcional (default no
 * `BASE_URL` do build) — assim dá para testá-las sem depender do ambiente.
 */

/** Base normalizado: sempre com barra inicial E final (`/`, `/server01/`). */
export function baseDoApp(base: string = import.meta.env.BASE_URL ?? '/'): string {
  const comBarraInicial = base.startsWith('/') ? base : `/${base}`
  return comBarraInicial.endsWith('/') ? comBarraInicial : `${comBarraInicial}/`
}

/**
 * Prefixa caminhos absolutos com o base. Caminhos que não começam com `/`
 * (relativos, URLs absolutas como `http://…`) passam intactos. Com base `/`,
 * devolve o próprio caminho — nenhuma mudança para o deploy na raiz.
 */
export function comBase(
  caminho: string,
  base: string = import.meta.env.BASE_URL ?? '/',
): string {
  if (!caminho.startsWith('/')) return caminho
  return `${baseDoApp(base)}${caminho.slice(1)}`
}

/**
 * Base sem barra final para o `basename` do react-router. Com base `/`
 * devolve `''` (nenhum basename), preservando o comportamento atual.
 */
export function baseParaRouter(
  base: string = import.meta.env.BASE_URL ?? '/',
): string {
  return baseDoApp(base).replace(/\/$/, '')
}
