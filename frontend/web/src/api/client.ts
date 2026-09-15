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
 * Estado da sonda de confirmação multi-aba (ressalvas PR #383):
 * - `viva`: `GET /me` respondeu 200 — Sessão viva apesar do 401 de reuso.
 * - `morta`: 401/403 explícito — Sessão morreu de fato, logout legítimo.
 * - `desconhecida`: 5xx, timeout/abort ou rede — nada se sabe; trata como
 *   `transiente` para não dar falso logout sob rede lenta.
 */
export type EstadoSondaSessao = 'viva' | 'morta' | 'desconhecida'

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

/** Single-flight da sonda (declarado cedo para o reset de testes). */
let sondaEmVoo: Promise<EstadoSondaSessao> | null = null

/**
 * Teto do POST /refresh (review PR #383, bloqueante 2): sem timeout, um
 * refresh pendurado seguraria o `await slide` do `onclose` e travaria a
 * reconexão até o timeout do navegador. O aborto cai no `catch` abaixo e
 * vira `transiente` — nunca declara logout por conta própria.
 */
export const TEMPO_LIMITE_REFRESH_MS = 8000

/** Teto da sonda de confirmação multi-aba (não pode pendurar o `invalida`). */
export const TEMPO_LIMITE_SONDA_SESSAO_MS = 5000

/**
 * Timeout abortável (follow-up PR #383, F3): expira o `sinal` após `ms` via
 * `AbortSignal.timeout` quando disponível, senão via `AbortController` +
 * `setTimeout` manual — nunca retorna `undefined` em silêncio deixando o
 * fetch sem teto. O chamador deve invocar `limpar` em `finally` para
 * liberar o timer e não deixar timeout órfão.
 */
export function criarTimeoutAbortavel(ms: number): { sinal: AbortSignal | undefined; limpar: () => void } {
  try {
    if (typeof AbortSignal.timeout === 'function') return { sinal: AbortSignal.timeout(ms), limpar: () => {} }
  } catch {
    // cai no fallback abaixo
  }
  try {
    const controlador = new AbortController()
    const timer = setTimeout(() => {
      try {
        controlador.abort()
      } catch {
        // melhor esforço
      }
    }, ms)
    // Evita segurar o loop em Node/testes quando o fetch assenta antes.
    const t = timer as unknown as { unref?: () => void }
    if (typeof t.unref === 'function') {
      try {
        t.unref()
      } catch {
        // melhor esforço
      }
    }
    return {
      sinal: controlador.signal,
      limpar: () => clearTimeout(timer),
    }
  } catch {
    return { sinal: undefined, limpar: () => {} }
  }
}

async function executarRefreshBruto(): Promise<ResultadoRefresh> {
  const { sinal, limpar } = criarTimeoutAbortavel(TEMPO_LIMITE_REFRESH_MS)
  try {
    // Subpath (VITE_BASE_PATH): o refresh acompanha o prefixo do app.
    const response = await fetch(comBase('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      signal: sinal,
    })
    if (response.ok) return 'renovada'
    return response.status === 401 ? 'invalida' : 'transiente'
  } catch {
    return 'transiente'
  } finally {
    limpar()
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
  sondaEmVoo = null
}

/**
 * Calibragem do slide proativo (issue #376, follow-up PR #383 F2): o
 * intervalo deriva do TTL do access token, mas com teto resiliente de 1
 * min — `VITE_SESSION_ACCESS_TTL_SECONDS` é espelho de build de
 * `SESSION_ACCESS_TTL_SECONDS` e dessincroniza se o backend baixar o TTL
 * sem rebuild. Deslizar a cada 60s cobre TTLs >= ~2min; TTLs menores são
 * operacionalmente inválidos e, de todo modo, o `apiFetch` com
 * 401 → refresh → retry continua sendo o dono da correção. Cadeia
 * `lerTtl → calcular` preservada para futura fonte server-driven (F2-B).
 * Fonte atual: env do build, com fallback de 900s.
 */
export const TTL_ACESSO_PADRAO_SEGUNDOS = 900
/** Teto resiliente do intervalo: desliza pelo menos a cada 1 min (anti-dessync, F2). */
export const INTERVALO_SLIDE_MAXIMO_MS = 60 * 1000
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
 * Intervalo do slide em ms: `TTL − margem`, limitado ao piso/teto
 * resiliente (F2). Com o teto de 1 min, qualquer TTL >= ~6min resulta em
 * 60s — o env do build vira apenas override reservado para o futuro
 * server-driven, sem poder descalibrar o slide para além de 60s.
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

/**
 * Notifica os assinantes de que a Sessão deixou de valer (logout, troca,
 * expiração ou revogação) — o `AuthProvider` volta o app a Visitante. Público
 * para reuso pelos canais WS (issue #410, PR #422): o fechamento `4401` é
 * terminal e não pode virar loop de reconexão + storm de refresh.
 */
export function notificarSessaoExpirada(): void {
  for (const listener of sessionExpiredListeners) listener()
}

/** Single-flight da sonda: 401s concorrentes no mesmo `invalida` dividem um `GET /me`. */
async function executarSondaBruta(): Promise<EstadoSondaSessao> {
  const { sinal, limpar } = criarTimeoutAbortavel(TEMPO_LIMITE_SONDA_SESSAO_MS)
  try {
    const resposta = await fetch(comBase('/api/auth/me'), {
      credentials: 'include',
      signal: sinal,
    })
    if (resposta.status === 200) return 'viva'
    if (resposta.status === 401 || resposta.status === 403) return 'morta'
    return 'desconhecida'
  } catch {
    return 'desconhecida'
  } finally {
    limpar()
  }
}

/**
 * Confirmação multi-aba (review PR #383, bloqueante 1): o single-flight do
 * refresh é por aba, então duas abas renovando quase juntas fazem a segunda
 * receber 401 de reuso (rotação em `sessoes.ts`) com a Sessão viva e cookies
 * já renovados pela outra aba. Fetch cru de propósito — nunca `apiFetch`,
 * senão o 401 da sonda reentraria no refresh em loop. Dedupe concorrente via
 * `sondaEmVoo` (ressalva 1): N `invalida` simultâneos geram um único `GET /me`.
 */
export function confirmarSessaoViva(): Promise<EstadoSondaSessao> {
  if (sondaEmVoo !== null) return sondaEmVoo
  const voo = executarSondaBruta().finally(() => {
    if (sondaEmVoo === voo) sondaEmVoo = null
  })
  sondaEmVoo = voo
  return voo
}

/**
 * Fetch compartilhado das chamadas de API: inclui o cookie de sessão e, em
 * 401, tenta uma renovação (slide-session, issue #376) antes de declarar a
 * Sessão expirada. O retry acontece uma única vez e só após `renovada`; em
 * `transiente` (rede/5xx no refresh ou no retry) o 401 original é devolvido
 * sem notificar — a Sessão pode estar viva. Antes de declarar `invalida`,
 * um `GET /me` cru confirma que a Sessão morreu de fato (race multi-aba:
 * 401 de reuso com cookies já renovados pela outra aba vira `transiente`;
 * sonda `desconhecida` — 5xx/timeout/rede — também vira `transiente` para
 * não dar falso logout sob rede lenta). Só `morta` confirmada e retry
 * ainda-401 notificam os assinantes para voltar a Visitante.
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
    // Ressalva 2: só `morta` (401/403 explícito) mantém o `invalida` legítimo.
    // `viva` (200) e `desconhecida` (5xx/timeout/rede) viram `transiente`.
    let estado: EstadoSondaSessao
    try {
      estado = await confirmarSessaoViva()
    } catch {
      estado = 'desconhecida'
    }
    if (estado !== 'morta') return anexarResultadoRefresh(response, 'transiente')
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
