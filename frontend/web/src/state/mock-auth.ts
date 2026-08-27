import type { AuthState } from './auth-context'

/** Subtipo autenticado da união AuthState. */
export type EstadoAutenticado = Extract<AuthState, { status: 'autenticado' }>

/**
 * Fixture única do jogador mock, usada pela implementação mock de
 * autenticação (atrás da dupla trava `__MOCK_AUTH__` + `VITE_AUTH_MOCK`)
 * e pelos testes que injetam o estado autenticado.
 */
export const estadoAutenticadoMock: EstadoAutenticado = {
  status: 'autenticado',
  jogador: { apelido: 'JogadorTeste' },
}
