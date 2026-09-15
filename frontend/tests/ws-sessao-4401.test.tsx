// Ciclo de vida da Sessão no cliente WS (issue #410, PR #422 / B3).
//
// O backend fecha conexões WS com o código `4401` quando a Sessão deixa de
// valer (logout, troca, expiração, revogação). Reconectar nesse cenário é
// loop: o upgrade é rejeitado de novo com 4401 e cada tentativa dispara um
// `POST /api/auth/refresh` (storm). Este teste trava o ramo terminal:
//   - canal da Partida: close 4401 não reconecta e notifica `onSessionExpired`;
//   - canal da Sala: idem;
//   - fechamento transitório (1006): a reconexão simples segue valendo.

import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockWebSocket } from './helpers/mockWebSocket'
import { __redefinirRefreshEmVooParaTestes, onSessionExpired } from '../web/src/api/client'
import { useSalaWebSocket } from '../web/src/hooks/useSalaWebSocket'
import {
  CODIGO_SESSAO_ENCERRADA,
  usePartidaWebSocket,
} from '../web/src/hooks/usePartidaWebSocket'

let refreshCalls = 0
const desinscritores: Array<() => void> = []

function assinarExpiracao(listener: () => void): () => void {
  const desinscrever = onSessionExpired(listener)
  desinscritores.push(desinscrever)
  return desinscrever
}

function renderPartida() {
  return renderHook(() =>
    usePartidaWebSocket({
      serverId: 's-1',
      partidaId: 'partida-1',
      onEvento: () => {},
      onAdmissao: () => {},
      onFalhaDeConexao: () => {},
      onPartidaNaoIniciada: () => {},
    }),
  )
}

/** Espera além da janela de reconexão de 1s dos canais. */
function esperarJanelaDeReconexao() {
  return act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1300)
    })
  })
}

beforeEach(() => {
  __redefinirRefreshEmVooParaTestes()
  MockWebSocket.clean()
  MockWebSocket.forceNoAutoOpen = false
  refreshCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/refresh')) {
        refreshCalls += 1
        return new Response(null, { status: 401 })
      }
      return new Response(null, { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  MockWebSocket.clean()
  while (desinscritores.length) desinscritores.pop()!()
})

describe('close 4401 (Sessão encerrada) nos canais WS (issue #410)', () => {
  it('canal da Partida: 4401 é terminal, sem novo socket e com onSessionExpired', async () => {
    const expirada = vi.fn()
    assinarExpiracao(expirada)

    const { unmount } = renderPartida()
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!

    act(() => ws.simulateClose(CODIGO_SESSAO_ENCERRADA, 'SESSAO_ENCERRADA'))

    expect(expirada).toHaveBeenCalledTimes(1)
    // Handler nulificado (encerrado sem reconexão).
    expect(ws.onclose).toBeNull()
    // Sem storm de refresh: o 4401 não passa pelo slide de reconexão.
    expect(refreshCalls).toBe(0)

    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(1)
    unmount()
  })

  it('canal da Sala: 4401 é terminal, sem novo socket e com onSessionExpired', async () => {
    const expirada = vi.fn()
    assinarExpiracao(expirada)

    const { unmount } = renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!

    act(() => ws.simulateClose(CODIGO_SESSAO_ENCERRADA, 'SESSAO_SUBSTITUIDA'))

    expect(expirada).toHaveBeenCalledTimes(1)
    expect(ws.onclose).toBeNull()
    expect(refreshCalls).toBe(0)

    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(1)
    unmount()
  })

  it('Partida: somente o código 4401 é terminal (4409 CONEXAO_SUBSTITUIDA reconecta)', async () => {
    const expirada = vi.fn()
    assinarExpiracao(expirada)

    const { unmount } = renderPartida()
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())

    act(() => MockWebSocket.last()!.simulateClose(4409, 'CONEXAO_SUBSTITUIDA'))

    expect(expirada).not.toHaveBeenCalled()
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    unmount()
  })
})

describe('regressão: fechamento transitório segue reconectando (issue #410)', () => {
  it('canal da Partida reconecta após 1006', async () => {
    const expirada = vi.fn()
    assinarExpiracao(expirada)

    const { unmount } = renderPartida()
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())

    act(() => MockWebSocket.last()!.simulateClose(1006, ''))

    expect(expirada).not.toHaveBeenCalled()
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    unmount()
  })

  it('canal da Sala reconecta após 1006', async () => {
    const expirada = vi.fn()
    assinarExpiracao(expirada)

    const { unmount } = renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())

    act(() => MockWebSocket.last()!.simulateClose(1006, ''))

    expect(expirada).not.toHaveBeenCalled()
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    unmount()
  })
})
