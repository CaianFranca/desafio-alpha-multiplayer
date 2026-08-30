import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'

function renderPartidaNaRota(entry: string) {
  const router = createMemoryRouter(
    [{ path: '/partida', element: <PartidaPage /> }],
    { initialEntries: [entry] },
  )
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
      jogadorId: 'jogador-1',
      apelido: 'Ana',
      partidaId: 'partida-1',
    }),
  )
  await screen.findByTestId('tabuleiro')
  return ws
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida conectada ao game-server (issue #85)', () => {
  it('sem alvo (URL sem serverId/partidaId) mostra tela de falha', () => {
    renderPartidaNaRota('/partida')
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('admissão aceita leva de carregando para disponível (cena montada)', async () => {
    renderPartidaNaRota('/partida?serverId=server-1&partidaId=partida-1')
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()

    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: 'jogador-1',
        apelido: 'Ana',
        partidaId: 'partida-1',
      }),
    )

    expect(await screen.findByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('evento de posicionamento atualiza o espelho DOM sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    expect(screen.getAllByTestId('reserva-peca')).toHaveLength(22)
    expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(0)

    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )

    expect(await screen.findAllByTestId('peca-posicionada')).toHaveLength(1)
    expect(screen.getAllByTestId('reserva-peca')).toHaveLength(21)
  })

  it('rotação via botão DOM envia GIRAR_PECA para a peça em manipulação ao WS', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Posiciona inicial-1 → abre janela de manipulação.
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )
    await screen.findByTestId('peca-posicionada')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('girar-horario'))

    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'GIRAR_PECA',
        pecaId: 'inicial-1',
        sentido: 'horario',
      })
    })
  })

  it('ERRO_DO_TABULEIRO produz flash vermelho distinto do branco', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Aprovação → flash branco.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    const branco = await screen.findByTestId('flash-overlay')
    expect(branco.getAttribute('data-cor')).toBe('branco')

    // Branco expira sozinho (320ms).
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    // Rejeição → flash vermelho distinto.
    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PECA_NAO_RECEBIDA',
        mensagem: 'Peças de caminho só entram pelo Recebimento.',
      }),
    )
    const vermelho = await screen.findByTestId('flash-overlay')
    expect(vermelho.getAttribute('data-cor')).toBe('vermelho')
    expect(vermelho.getAttribute('data-motivo')).toBe('rejeicao_do_servico')
  })
})
