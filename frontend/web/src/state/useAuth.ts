import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context'

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
