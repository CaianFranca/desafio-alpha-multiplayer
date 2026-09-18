import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { enviarLote } from './helpers/partida-ws'

// Brilho do botão de ação do turno (#437, parte de #435 "botões por fase e
// animação condicionada"): comportamento externo via wire — TURNO_INICIADO +
// PEAO_PERMANECEU levam à fase "permanecer" com o peão próprio resolvido.
const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

function renderPartidaNaRota(entry: string) {
  const router = createMemoryRouter([{ path: '/partida', element: <PartidaPage /> }], {
    initialEntries: [entry],
  })
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

async function partidaDisponivel(entry: string) {
  renderPartidaNaRota(entry)
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: MEU_JOGADOR_ID,
      apelido: 'JogadorTeste',
      partidaId: 'partida-1',
      estado: 'em_andamento',
    }),
  )
  await screen.findByTestId('tabuleiro')
  return ws
}

function mockReducedMotion(matches: boolean) {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('brilho do botão de ação do turno (#437)', () => {
  it('botão acionável exibe brilho animado (data-animado true + animate-pulse)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')
    await enviarLote(ws, { type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_PERMANECEU', peaoId: 'peao-branco', pecaId: 'inicial-1' })
    })

    const botao = await screen.findByTestId('botao-permanecer')
    expect(botao).not.toBeDisabled()
    const brilho = screen.getByTestId('brilho-botao-turno')
    expect(brilho).toHaveAttribute('data-animado', 'true')
    expect(brilho.className).toContain('animate-pulse')
  })

  it('sem peão próprio o brilho fica estático (data-animado false, sem pulse, opacity-60)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')
    await enviarLote(ws, { type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })

    const botao = await screen.findByTestId('botao-permanecer')
    expect(botao).toBeDisabled()
    const brilho = screen.getByTestId('brilho-botao-turno')
    expect(brilho).toHaveAttribute('data-animado', 'false')
    expect(brilho.className).not.toContain('animate-pulse')
    expect(brilho.className).toContain('opacity-60')
  })

  it('com prefers-reduced-motion o brilho fica estático mesmo com botão acionável', async () => {
    const restaurar = mockReducedMotion(true)
    try {
      const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')
      await enviarLote(ws, { type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })
      act(() => {
        ws.simulateMessage({ type: 'PEAO_PERMANECEU', peaoId: 'peao-branco', pecaId: 'inicial-1' })
      })

      const botao = await screen.findByTestId('botao-permanecer')
      expect(botao).not.toBeDisabled()
      const brilho = screen.getByTestId('brilho-botao-turno')
      expect(brilho).toHaveAttribute('data-animado', 'false')
      expect(brilho.className).not.toContain('animate-pulse')
    } finally {
      restaurar()
    }
  })
})
