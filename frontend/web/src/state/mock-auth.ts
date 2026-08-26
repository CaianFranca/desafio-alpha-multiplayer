import type { AuthState } from './auth-context'

/** Subtipo autenticado da união AuthState. */
export type AuthenticatedState = Extract<AuthState, { status: 'authenticated' }>

/**
 * Fixture única do jogador mock, usada pela implementação mock de
 * autenticação (atrás da dupla trava `__MOCK_AUTH__` + `VITE_AUTH_MOCK`)
 * e pelos testes que injetam o estado autenticado.
 */
export const mockAuthenticatedState: AuthenticatedState = {
  status: 'authenticated',
  jogador: {
    id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
    apelido: 'JogadorTeste',
    email: 'jogador.teste@exemplo.com',
  },
}
