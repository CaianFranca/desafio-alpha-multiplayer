import { comBase } from './basePath'

type SessionExpiredListener = () => void

const sessionExpiredListeners = new Set<SessionExpiredListener>()

/** Assina a expiração de sessão; retorna a função de unsubscribe. */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener)
  return () => {
    sessionExpiredListeners.delete(listener)
  }
}

/**
 * Resultado detalhado da renovação (slide-session, issue #376).
 *
 * - `renovada`: o servidor reemitiu os cookies — a Sessão segue viva.
 * - `invalida`: o refresh foi rejeitado com 401 (expirado, revogado ou
 *   reuso pós-rotação) — a Sessão morreu e o logout é legítimo.
 * - `transiente`: rede fora ou 5xx — nada se sabe sobre a Sessão, então
 *   ninguém declara logout por conta própria; o 401 original é devolvido
 *   sem notificar e o chamador trata como falha desconhecida.
 */
export type ResultadoRefresh = 'renovada' | 'invalida' | 'transiente'

/**
 * Renova a Sessão via `POST /api/auth/refresh` (slide-session, issue #376).
 *
 * O refresh token vive em cookie HttpOnly (7 dias) e a rotação acontece no
 * servidor; aqui basta o POST com `credentials: 'include'`.
 *
 * Single-flight: 401s concorrentes compartilham a mesma promessa, então N
 * chamadas paralelas geram um único POST (a rotação invalida o refresh
 * anterior, então rajadas sem dedupe se invalidariam entre si).
 */
let refreshEmVoo: Promise<ResultadoRefresh> | null = null

async function executarRefreshBruto(): Promise<ResultadoRefresh> {
  try {
    // Subpath (VITE_BASE_PATH): o refresh acompanha o prefixo do app.
    const response = await fetch(comBase('/api/auth/refresh'), { method: 'POST', credentials: 'include' })
    if (response.ok) return 'renovada'
    return response.status === 401 ? 'invalida' : 'transiente'
  } catch {
    return 'transiente'
  }
}

export function renovarSessaoDetalhada(): Promise<ResultadoRefresh> {
  if (refreshEmVoo !== null) return refreshEmVoo
  const voo = executarRefreshBruto().finally(() => {
    if (refreshEmVoo === voo) refreshEmVoo = null
  })
  refreshEmVoo = voo
  return voo
}

/**
 * Versão booleana da renovação (slide proativo, retries manuais): `true`
 * só quando renovou de fato. Nunca rejeita — qualquer falha vira `false`.
 */
export function renovarSessao(): Promise<boolean> {
  return renovarSessaoDetalhada().then((resultado) => resultado === 'renovada')
}

/**
 * Resultado do refresh anexado à resposta 401 que o originou (slide-session,
 * issue #376, review PR #383): escopo por request — cada `Response`
 * devolvida carrega o próprio resultado, sem mutável global compartilhado
 * entre chamadas concorrentes ou sequenciais distintas.
 */
const RESULTADO_REFRESH = Symbol('resultadoRefresh')

/** Lê o resultado do refresh anexado a uma resposta do `apiFetch`. */
export function lerResultadoRefresh(resposta: Response): ResultadoRefresh | undefined {
  return (resposta as unknown as Record<symbol, ResultadoRefresh | undefined>)[RESULTADO_REFRESH]
}

function anexarResultadoRefresh(resposta: Response, resultado: ResultadoRefresh): Response {
  ;(resposta as unknown as Record<symbol, ResultadoRefresh>)[RESULTADO_REFRESH] = resultado
  return resposta
}

/** Reseta o single-flight (uso exclusivo em testes). */
export function __redefinirRefreshEmVooParaTestes(): void {
  refreshEmVoo = null
}

/**
 * Calibragem do slide proativo (issue #376): o intervalo deriva do TTL do
 * access token para sobreviver a mudanças em `SESSION_ACCESS_TTL_SECONDS`.
 * Fonte: `VITE_SESSION_ACCESS_TTL_SECONDS` do build (espelho manual da env
 * do servidor), com fallback de 900s.
 */
export const TTL_ACESSO_PADRAO_SEGUNDOS = 900
/** Teto do intervalo: desliza pelo menos a cada 10 min. */
export const INTERVALO_SLIDE_MAXIMO_MS = 10 * 60 * 1000
/** Piso do intervalo: evita rajadas de refresh com TTLs curtos. */
export const INTERVALO_SLIDE_MINIMO_MS = 60 * 1000
/** Margem antes da expiração: o slide renova 5 min antes do TTL. */
export const MARGEM_SLIDE_SESSAO_MS = 5 * 60 * 1000

/** Lê o TTL do access token do build, com fallback seguro. */
export function lerTtlDeAcessoSegundos(): number {
  const bruto = import.meta.env.VITE_SESSION_ACCESS_TTL_SECONDS
  const parsed = Number(bruto)
  if (bruto !== undefined && Number.isInteger(parsed) && parsed > 0) return parsed
  return TTL_ACESSO_PADRAO_SEGUNDOS
}

/**
 * Intervalo do slide em ms: `TTL − margem`, limitado ao piso/teto. TTL 900
 * → 600s; TTL 300 → 60s (piso); TTL 3600 → 600s (teto).
 */
export function calcularIntervaloSlide(ttlSegundos: number): number {
  const alvo = (ttlSegundos - MARGEM_SLIDE_SESSAO_MS / 1000) * 1000
  return Math.min(INTERVALO_SLIDE_MAXIMO_MS, Math.max(INTERVALO_SLIDE_MINIMO_MS, alvo))
}

/**
 * Rotas de autenticação que nunca disparam renovação: o 401 delas é resposta
 * de negócio (Credenciais inválidas, refresh inválido) e o retry entraria em
 * loop ou mascararia o erro.
 */
function ehRotaDeAuthSemRetry(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  return (
    url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/refresh')
  )
}

function notificarSessaoExpirada(): void {
  for (const listener of sessionExpiredListeners) listener()
}

/**
 * Fetch compartilhado das chamadas de API: inclui o cookie de sessão e, em
 * 401, tenta uma renovação (slide-session, issue #376) antes de declarar a
 * Sessão expirada. O retry acontece uma única vez e só após `renovada`; em
 * `transiente` (rede/5xx no refresh ou no retry) o 401 original é devolvido
 * sem notificar — a Sessão pode estar viva. Só `invalida` e retry ainda-401
 * notificam os assinantes para voltar a Visitante.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Subpath (VITE_BASE_PATH): strings relativas (`/api/...`) ganham o base do
  // build; `Request`/`URL` e URLs absolutas passam intactas (comBase só mexe
  // no que começa com `/`).
  const alvo = typeof input === 'string' ? comBase(input) : input
  const response = await fetch(alvo, { credentials: 'include', ...init })
  if (response.status !== 401) return response
  if (ehRotaDeAuthSemRetry(input)) {
    notificarSessaoExpirada()
    return response
  }
  let resultado: ResultadoRefresh
  try {
    resultado = await renovarSessaoDetalhada()
  } catch {
    resultado = 'transiente'
  }
  if (resultado === 'invalida') {
    notificarSessaoExpirada()
    return response
  }
  if (resultado === 'transiente') {
    return anexarResultadoRefresh(response, resultado)
  }
  let repetida: Response
  try {
    repetida = await fetch(alvo, { credentials: 'include', ...init })
  } catch {
    // Rede caiu entre o refresh e o retry: mesma postura transitória.
    return anexarResultadoRefresh(response, 'transiente')
  }
  if (repetida.status === 401) notificarSessaoExpirada()
  return repetida
}
