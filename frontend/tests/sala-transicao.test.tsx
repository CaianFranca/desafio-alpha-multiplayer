import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const jogador = {
  id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
  apelido: 'Ana',
  email: 'ana@exemplo.com',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockAuthMe() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) return jsonResponse(jogador)
      return new Response(null, { status: 404 })
    }),
  )
}

type MockWsInstance = {
  url: string
  onopen: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onclose: ((e: CloseEvent) => void) | null
  onerror: ((e: Event) => void) | null
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  simulateMessage: (data: unknown) => void
  simulateOpen: () => void
}

function createMockWebSocket() {
  const instances: MockWsInstance[] = []

  class MockWebSocket {
    url: string
    onopen: ((e: Event) => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    onclose: ((e: CloseEvent) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    send = vi.fn()
    close = vi.fn()

    constructor(url: string) {
      this.url = url
      const self = this as unknown as MockWsInstance
      self.simulateMessage = (data: unknown) => {
        if (self.onmessage) {
          self.onmessage({ data: JSON.stringify(data) } as MessageEvent)
        }
      }
      self.simulateOpen = () => {
        if (self.onopen) self.onopen(new Event('open'))
      }
      instances.push(self)
    }
  }

  return { MockWebSocket: MockWebSocket as unknown as typeof WebSocket, instances }
}

function salaAberta(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    id: 'sala-1',
    codigoDeSala: 'ABCDEF',
    estado: 'aberta' as const,
    anfitriaoId: 'membro-1',
    membros: [
      { id: 'membro-1', jogadorId: jogador.id, apelido: 'Ana', ordemDeEntrada: 1, presenca: 'conectado' as const, prontidao: true },
      { id: 'membro-2', jogadorId: 'jog-2', apelido: 'Beto', ordemDeEntrada: 2, presenca: 'conectado' as const, prontidao: true },
      { id: 'membro-3', jogadorId: 'jog-3', apelido: 'Caio', ordemDeEntrada: 3, presenca: 'conectado' as const, prontidao: true },
      { id: 'membro-4', jogadorId: 'jog-4', apelido: 'Dani', ordemDeEntrada: 4, presenca: 'conectado' as const, prontidao: true },
    ],
    convite: { codigoDeSala: 'ABCDEF', link: 'http://localhost:3001/convite/ABCDEF' },
    ...overrides,
  }
  return base
}

function renderSala(codigo = 'ABCDEF') {
  const router = createMemoryRouter(routes, { initialEntries: [`/salas/${codigo}`] })
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('Transição da Sala para a Partida (#45)', () => {
  it('o estado de preparação é visível para todos os Membros', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()

    await screen.findByText('Ana')
    await waitFor(() => expect(instances.length).toBe(1))
    const ws = instances[0]!
    act(() => ws.simulateOpen())
    act(() =>
      ws.simulateMessage({
        type: 'SALA_ATUALIZADA',
        sala: salaAberta(),
      }),
    )

    expect(await screen.findByText('ABCDEF')).toBeInTheDocument()
    expect(screen.queryByTestId('transicao-overlay')).not.toBeInTheDocument()

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))

    expect(await screen.findByTestId('transicao-overlay')).toBeInTheDocument()
    expect(screen.getByText(/preparando partida/i)).toBeInTheDocument()
  })

  it('a disponibilidade leva ao redirect com o alvo correto', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const assignSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy, host: 'localhost:5173', protocol: 'http:' } as unknown as Location)

    renderSala()

    await screen.findByText('Ana')
    await waitFor(() => expect(instances.length).toBe(1))
    const ws = instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaAberta() }))
    await screen.findByText('ABCDEF')

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_DISPONIVEL',
        partidaId: 'partida-123',
        serverId: 'server-abc',
      }),
    )

    const overlay = await screen.findByTestId('transicao-overlay')
    expect(overlay).toBeInTheDocument()
    expect(within(overlay).getByRole('heading', { name: /partida disponível/i })).toBeInTheDocument()
    const alvo = within(overlay).getByTestId('alvo-do-redirect')
    expect(alvo.textContent).toContain('server-abc')
    expect(alvo.textContent).toContain('partida-123')
    expect(alvo.textContent).toContain('/ws/game/')

    const link = within(overlay).getByTestId('ir-para-partida') as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('serverId=server-abc')
    expect(link.getAttribute('href')).toContain('partidaId=partida-123')
    expect(alvo.textContent).toContain('partida-id=partida-123')

    await waitFor(() => expect(assignSpy).toHaveBeenCalled(), { timeout: 3000 })
    expect(assignSpy.mock.calls[0][0]).toContain('server-abc')
  })

  it('recusa exibe aviso compreensível e a página volta ao estado normal da Sala', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()

    await screen.findByText('Ana')
    await waitFor(() => expect(instances.length).toBe(1))
    const ws = instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaAberta() }))
    await screen.findByText('ABCDEF')

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))
    expect(await screen.findByTestId('transicao-overlay')).toBeInTheDocument()

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_RECUSADA',
        codigo: 'ENCAMINHAMENTO_RECUSADO',
        motivo: 'O servidor de jogo recusou a partida. Tente iniciar novamente.',
      }),
    )

    const aviso = await screen.findByTestId('aviso-encaminhamento')
    expect(aviso).toHaveTextContent(/partida recusada/i)
    expect(aviso).toHaveTextContent(/servidor de jogo recusou/i)
    expect(screen.queryByTestId('transicao-overlay')).not.toBeInTheDocument()
    expect(await screen.findByText('ABCDEF')).toBeInTheDocument()
    expect(screen.getByText('Beto')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('fechar-aviso'))
    expect(screen.queryByTestId('aviso-encaminhamento')).not.toBeInTheDocument()
  })

  it('falha exibe aviso compreensível e a página volta ao estado normal da Sala', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()

    await screen.findByText('Ana')
    await waitFor(() => expect(instances.length).toBe(1))
    const ws = instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaAberta() }))
    await screen.findByText('ABCDEF')

    act(() => ws.simulateMessage({ type: 'PARTIDA_FALHOU', codigo: 'ENCAMINHAMENTO_FALHOU', motivo: '' }))

    const aviso = await screen.findByTestId('aviso-encaminhamento')
    expect(aviso).toHaveTextContent(/falha ao preparar/i)
    expect(aviso.textContent).toMatch(/tente novamente/i)
    expect(screen.queryByTestId('transicao-overlay')).not.toBeInTheDocument()
    expect(await screen.findByText('ABCDEF')).toBeInTheDocument()
  })

  it('quem reconecta a uma Sala encaminhada vê o alvo do redirect', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()

    await screen.findByText('Ana')
    await waitFor(() => expect(instances.length).toBe(1))
    const ws = instances[0]!
    act(() => ws.simulateOpen())

    const encaminhada = salaAberta({
      estado: 'encaminhada',
      encaminhamento: { partidaId: 'partida-999', serverId: 'server-xyz' },
    })

    act(() =>
      ws.simulateMessage({
        type: 'SALA_ATUALIZADA',
        sala: encaminhada,
      }),
    )

    expect(await screen.findByTestId('transicao-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('alvo-do-redirect')).toHaveTextContent('server-xyz')
    expect(screen.getByTestId('alvo-do-redirect')).toHaveTextContent('partida-999')

    expect(screen.getByTestId('snapshot-encaminhada')).toBeInTheDocument()
    expect(screen.getByTestId('alvo-do-redirect-snapshot')).toHaveTextContent('server-xyz')
    const link = screen.getByTestId('ir-para-partida-snapshot') as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('server-xyz')
  })
})
