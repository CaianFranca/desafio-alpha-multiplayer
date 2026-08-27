import { apiFetch } from './client'

export interface Jogador {
  id: string
  apelido: string
  email: string
}

export type PlayerResult =
  | { ok: true; jogador: Jogador }
  | { ok: false; reason: 'invalid-session' | 'unknown-failure' }

/** GET /api/auth/me — reidrata o Jogador da Sessão ativa (contrato OpenAPI). */
export async function fetchCurrentPlayer(): Promise<PlayerResult> {
  let response: Response
  try {
    response = await apiFetch('/api/auth/me')
  } catch {
    return { ok: false, reason: 'unknown-failure' }
  }
  if (response.status === 401) return { ok: false, reason: 'invalid-session' }
  if (!response.ok) return { ok: false, reason: 'unknown-failure' }
  try {
    const jogador = (await response.json()) as Jogador
    return { ok: true, jogador }
  } catch {
    return { ok: false, reason: 'unknown-failure' }
  }
}

/** POST /api/auth/logout — melhor esforço: o estado local volta a Visitante independentemente do resultado. */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // melhor esforço
  }
}
