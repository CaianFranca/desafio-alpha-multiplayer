import { z } from 'zod'
import { apiFetch } from './client'

export interface Jogador {
  id: string
  apelido: string
  email: string
}

export type PlayerResult =
  | { ok: true; jogador: Jogador }
  | { ok: false; reason: 'invalid-session' | 'unknown-failure' }

export interface Credenciais {
  email: string
  senha: string
}

export type CredenciaisPayload = Credenciais

export type CadastroPayload = { apelido: string } & Credenciais

/** @deprecated use CredenciaisPayload */
export type LoginPayload = CredenciaisPayload

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

/** @deprecated import from utils/validacaoCredenciais */
export { isValidEmail } from '../utils/validacaoCredenciais'

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

const authErrorSchema = z.object({
  erros: z.array(
    z.object({
      campo: z.enum(['apelido', 'email', 'senha']).optional(),
      mensagem: z.string(),
    }),
  ),
})

function parseAuthErrors(body: unknown): { fieldErrors: AuthFieldErrors; generalError?: string } {
  const parsed = authErrorSchema.safeParse(body)
  if (parsed.success) {
    const fieldErrors: AuthFieldErrors = {}
    let generalError: string | undefined
    for (const item of parsed.data.erros) {
      if (item.campo === 'apelido' || item.campo === 'email' || item.campo === 'senha') {
        if (!fieldErrors[item.campo]) fieldErrors[item.campo] = item.mensagem
      } else if (item.mensagem) {
        if (!generalError) generalError = item.mensagem
      }
    }
    if (Object.keys(fieldErrors).length > 0 || generalError) return { fieldErrors, generalError }
    return { fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.' }
  }
  if (body !== null && typeof body === 'object' && 'erros' in body) {
    const raw = (body as AuthErrorResponse).erros
    if (Array.isArray(raw)) {
      const fieldErrors: AuthFieldErrors = {}
      let generalError: string | undefined
      for (const item of raw as AuthErrorItem[]) {
        if (item.campo === 'apelido' || item.campo === 'email' || item.campo === 'senha') {
          if (!fieldErrors[item.campo]) fieldErrors[item.campo] = item.mensagem
        } else if (item.mensagem) {
          if (!generalError) generalError = item.mensagem
        }
      }
      if (Object.keys(fieldErrors).length > 0 || generalError) return { fieldErrors, generalError }
    }
  }
  return { fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.' }
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function rawAuthPost(
  path: '/api/auth/register' | '/api/auth/login',
  payload: CadastroPayload | CredenciaisPayload,
): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return null
  }
}

async function authRequest(
  path: '/api/auth/register' | '/api/auth/login',
  payload: CadastroPayload | CredenciaisPayload,
): Promise<AuthActionResult> {
  const response = await rawAuthPost(path, payload)
  if (!response) {
    return { ok: false, fieldErrors: {}, generalError: 'Erro de conexão. Tente novamente.', status: 0 }
  }
  if (response.ok) {
    const jogador = await parseJsonSafe<Jogador>(response)
    if (jogador) return { ok: true, jogador }
    return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
  }
  const body = await parseJsonSafe<unknown>(response)
  if (body !== null) {
    const parsed = parseAuthErrors(body)
    return { ok: false, ...parsed, status: response.status }
  }
  return { ok: false, fieldErrors: {}, generalError: 'Erro inesperado. Tente novamente.', status: response.status }
}

/** POST /api/auth/register — usa fetch bruto para não disparar onSessionExpired em 401/409. */
export async function register(payload: CadastroPayload): Promise<AuthActionResult> {
  return authRequest('/api/auth/register', payload)
}

/** POST /api/auth/login — usa fetch bruto para não disparar onSessionExpired em 401. */
export async function entrarComCredenciais(payload: CredenciaisPayload): Promise<AuthActionResult> {
  return authRequest('/api/auth/login', payload)
}

/** @deprecated use entrarComCredenciais */
export const login = entrarComCredenciais
