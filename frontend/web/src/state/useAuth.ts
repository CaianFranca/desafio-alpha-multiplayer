import { useContext } from 'react'
import { AuthContext, type AuthState } from './auth-context'

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
