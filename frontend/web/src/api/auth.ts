import { apiFetch } from './client'

export interface Jogador {
  id: string
  apelido: string
  email: string
}

export type PlayerResult =
  | { ok: true; jogador: Jogador }
  | { ok: false; reason: 'invalid-session' | 'unknown-failure' }

export interface CadastroPayload {
  apelido: string
  email: string
  senha: string
}

export interface LoginPayload {
  email: string
  senha: string
}

export type AuthField = 'apelido' | 'email' | 'senha'

export interface AuthErrorItem {
  campo?: AuthField
  mensagem: string
}

export interface AuthErrorResponse {
  erros: AuthErrorItem[]
}

export type AuthFieldErrors = Partial<Record<AuthField, string>>

export type AuthActionResult =
  | { ok: true; jogador: Jogador }
  | { ok: false; fieldErrors: AuthFieldErrors; generalError?: string; status: number }

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

function parseAuthErrors(body: unknown): { fieldErrors: AuthFieldErrors; generalError?: string } {
  if (body !== null && typeof body === 'object' && 'erros' in body) {
    const raw = (body as AuthErrorResponse).erros
    if (Array.isArray(raw)) {
      const fieldErrors: AuthFieldErrors = {}
      let generalError: string | undefined
      for (const item of raw as AuthErrorItem[]) {
        if (item.campo === 'apelido' || item.campo === 'email' || item.campo === 'senha') {
          // mantém o primeiro erro por campo
          if (!fieldErrors[item.campo]) fieldErrors[item.campo] = item.mensagem
        } else if (item.mensagem) {
          // erro genérico (sem campo) — ex: Credenciais inválidas.
          if (!generalError) generalError = item.mensagem
        }
      }
      return { fieldErrors, generalError }
    }
  }
  return { fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.' }
}

/** POST /api/auth/register — usa fetch bruto para não disparar onSessionExpired em 401/409. */
export async function register(payload: CadastroPayload): Promise<AuthActionResult> {
  let response: Response
  try {
    response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, fieldErrors: {}, generalError: 'Erro de conexão. Tente novamente.', status: 0 }
  }
  if (response.ok) {
    try {
      const jogador = (await response.json()) as Jogador
      return { ok: true, jogador }
    } catch {
      return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
    }
  }
  try {
    const body = (await response.json()) as unknown
    const parsed = parseAuthErrors(body)
    return { ok: false, ...parsed, status: response.status }
  } catch {
    return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
  }
}

/** POST /api/auth/login — usa fetch bruto para não disparar onSessionExpired em 401. */
export async function login(payload: LoginPayload): Promise<AuthActionResult> {
  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, fieldErrors: {}, generalError: 'Erro de conexão. Tente novamente.', status: 0 }
  }
  if (response.ok) {
    try {
      const jogador = (await response.json()) as Jogador
      return { ok: true, jogador }
    } catch {
      return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
    }
  }
  try {
    const body = (await response.json()) as unknown
    const parsed = parseAuthErrors(body)
    return { ok: false, ...parsed, status: response.status }
  } catch {
    return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
  }
}
