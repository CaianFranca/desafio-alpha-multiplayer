import { createContext } from 'react'
import type { Jogador } from '../api/auth'

export type AuthState =
  | { status: 'loading' }
  | { status: 'visitor' }
  | { status: 'authenticated'; jogador: Jogador }

export const visitorState: AuthState = { status: 'visitor' }

export interface AuthContextValue {
  authState: AuthState
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  authState: visitorState,
  logout: async () => {},
})
