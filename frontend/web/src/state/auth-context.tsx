import { createContext } from 'react'

export type AuthState =
  | { status: 'visitante' }
  | { status: 'autenticado'; jogador: { apelido: string } }

export const visitorState: AuthState = { status: 'visitante' }

export const AuthContext = createContext<AuthState>(visitorState)
