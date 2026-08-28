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
 * Fetch compartilhado das chamadas de API: inclui o cookie de sessão e,
 * quando o servidor responde 401 (sessão expirada ou revogada), notifica os
 * assinantes para que o estado de autenticação volte a Visitante.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { credentials: 'include', ...init })
  if (response.status === 401) {
    for (const listener of sessionExpiredListeners) listener()
  }
  return response
}
