import { createContext } from 'react'
import type { Jogador } from '../api/auth'

export type AuthState =
  | { status: 'carregando' }
  | { status: 'visitante' }
  | { status: 'autenticado'; jogador: Jogador }

export const carregandoState: AuthState = { status: 'carregando' }
export const visitorState: AuthState = { status: 'visitante' }

export interface AuthContextValue {
  estado: AuthState
  sair: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  estado: visitorState,
  sair: async () => {},
})
