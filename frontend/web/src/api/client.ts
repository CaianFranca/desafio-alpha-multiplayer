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
 * Fetch compartilhado das chamadas de API: inclui o cookie de sessão e,
 * quando o servidor responde 401 (sessão expirada ou revogada), notifica os
 * assinantes para que o estado de autenticação volte a Visitante.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Subpath (VITE_BASE_PATH): strings relativas (`/api/...`) ganham o base do
  // build; `Request`/`URL` e URLs absolutas passam intactas (comBase só mexe
  // no que começa com `/`).
  const alvo = typeof input === 'string' ? comBase(input) : input
  const response = await fetch(alvo, { credentials: 'include', ...init })
  if (response.status === 401) {
    for (const listener of sessionExpiredListeners) listener()
  }
  return response
}
