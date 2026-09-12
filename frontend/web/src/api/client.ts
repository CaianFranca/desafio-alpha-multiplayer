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
 * Renova a Sessão via `POST /api/auth/refresh` (slide-session, issue #376).
 *
 * O refresh token vive em cookie HttpOnly (7 dias) e a rotação acontece no
 * servidor; aqui basta o POST com `credentials: 'include'`. O resultado é
 * booleano: `true` renovou (cookies reemitidos), `false` mantém o estado
 * atual — o 401 original decide o resto do fluxo. Falha de rede também vira
 * `false` (melhor esforço, sem jogar).
 *
 * Single-flight: 401s concorrentes compartilham a mesma promessa, então N
 * chamadas paralelas geram um único POST (a rotação invalida o refresh
 * anterior, então rajadas sem dedupe se invalidariam entre si).
 */
let refreshEmVoo: Promise<boolean> | null = null

async function executarRefreshBruto(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    return response.ok
  } catch {
    return false
  }
}

export function renovarSessao(): Promise<boolean> {
  if (refreshEmVoo !== null) return refreshEmVoo
  const voo = executarRefreshBruto().finally(() => {
    if (refreshEmVoo === voo) refreshEmVoo = null
  })
  refreshEmVoo = voo
  return voo
}

/** Reseta o single-flight (uso exclusivo em testes). */
export function __redefinirRefreshEmVooParaTestes(): void {
  refreshEmVoo = null
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
 * Sessão expirada. O retry acontece uma única vez: se a renovação vingar, a
 * requisição original é repetida; se o retry ainda for 401 — ou a renovação
 * falhar — os assinantes são notificados para que o estado volte a Visitante.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { credentials: 'include', ...init })
  if (response.status !== 401) return response
  if (ehRotaDeAuthSemRetry(input)) {
    notificarSessaoExpirada()
    return response
  }
  let renovou: boolean
  try {
    renovou = await renovarSessao()
  } catch {
    renovou = false
  }
  if (!renovou) {
    notificarSessaoExpirada()
    return response
  }
  const repetida = await fetch(input, { credentials: 'include', ...init })
  if (repetida.status === 401) notificarSessaoExpirada()
  return repetida
}
