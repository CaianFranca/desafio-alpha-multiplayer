import { createContext } from 'react'
import type { AuthActionResult, CadastroPayload, Jogador, LoginPayload } from '../api/auth'

export type AuthState =
  | { status: 'loading' }
  | { status: 'visitor' }
  | { status: 'authenticated'; jogador: Jogador }

export const visitorState: AuthState = { status: 'visitor' }

export interface AuthContextValue {
  authState: AuthState
  logout: () => Promise<void>
  register: (payload: CadastroPayload) => Promise<AuthActionResult>
  login: (payload: LoginPayload) => Promise<AuthActionResult>
}

export const AuthContext = createContext<AuthContextValue>({
  authState: visitorState,
  logout: async () => {},
  register: async () => ({ ok: false, fieldErrors: {}, status: 0 }),
  login: async () => ({ ok: false, fieldErrors: {}, status: 0 }),
})
