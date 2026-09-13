import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { EncaminhamentoOverlay } from '../web/src/components/sala/EncaminhamentoOverlay'
import { REDIRECT_DELAY_MS } from '../web/src/api/encaminhamento'

afterEach(() => {
  vi.useRealTimers()
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

function stubLocationComAssign(assignSpy: ReturnType<typeof vi.fn>) {
  vi.stubGlobal(
    'location',
    { ...window.location, assign: assignSpy, host: 'localhost:5173', protocol: 'http:' } as unknown as Location,
  )
}

function semNavegacaoVisivel(container: HTMLElement) {
  expect(container.querySelector('[data-testid="alvo-do-redirect"]')).toBeNull()
  expect(container.querySelector('[data-testid="alvo-do-redirect-snapshot"]')).toBeNull()
  expect(container.querySelector('[data-testid="ir-para-partida"]')).toBeNull()
  expect(container.querySelector('[data-testid="ir-para-partida-snapshot"]')).toBeNull()
  expect(container.querySelector('[data-testid="snapshot-encaminhada"]')).toBeNull()
  expect(container.querySelector('a[href*="partidaId="]')).toBeNull()
}

function avancarParaDepoisDoRedirect() {
  act(() => {
    vi.advanceTimersByTime(REDIRECT_DELAY_MS + 100)
  })
}

async function abrirSala(instances: MockWsInstance[]) {
  await screen.findByText('Ana')
  await waitFor(() => expect(instances.length).toBe(1))
  const ws = instances[0]!
  act(() => ws.simulateOpen())
  act(() => ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaAberta() }))
  await screen.findByText('ABCDEF')
  return ws
}

describe('Encaminhamento da Sala para a Partida (#45, #386)', () => {
  it('a preparação exibe a região de carregamento, sem card, texto, botão ou alvo', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()
    const ws = await abrirSala(instances)
    expect(screen.queryByTestId('encaminhamento-overlay')).not.toBeInTheDocument()

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))

    const overlay = await screen.findByTestId('encaminhamento-overlay')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    const carregando = screen.getByTestId('encaminhamento-carregando')
    expect(carregando).toBeInTheDocument()
    expect(carregando).toHaveAttribute('role', 'status')
    expect(screen.getByRole('status', { name: /carregando partida/i })).toBeInTheDocument()
    semNavegacaoVisivel(document.body)
    expect(screen.queryByText(/preparando partida/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/partida disponível/i)).not.toBeInTheDocument()
  })

  it('a disponibilidade mantém a mesma região e dispara o redirect com destino correto', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const assignSpy = vi.fn()
    stubLocationComAssign(assignSpy)

    renderSala()
    const ws = await abrirSala(instances)

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))
    const regiaoAntes = await screen.findByTestId('encaminhamento-carregando')
    expect(regiaoAntes).toBeInTheDocument()

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_DISPONIVEL',
        partidaId: 'partida-123',
        serverId: 'server-abc',
      }),
    )

    const regiaoDepois = await screen.findByTestId('encaminhamento-carregando')
    expect(regiaoDepois).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /carregando partida/i })).toBeInTheDocument()
    semNavegacaoVisivel(document.body)
    expect(screen.queryByText(/partida disponível/i)).not.toBeInTheDocument()

    await waitFor(() => expect(assignSpy).toHaveBeenCalled(), { timeout: 3000 })
    const destino = String(assignSpy.mock.calls[0]?.[0] ?? '')
    expect(destino).toContain('serverId=server-abc')
    expect(destino).toContain('partidaId=partida-123')
  })

  it('a preparação sozinha nunca agenda redirect (sem alvo, sem navegação)', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const assignSpy = vi.fn()
    stubLocationComAssign(assignSpy)

    renderSala()
    const ws = await abrirSala(instances)

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))
    expect(await screen.findByTestId('encaminhamento-carregando')).toBeInTheDocument()

    vi.useFakeTimers()
    avancarParaDepoisDoRedirect()
    expect(assignSpy).not.toHaveBeenCalled()
    semNavegacaoVisivel(document.body)
  })

  it('disponibilidade sem alvo não exibe overlay nem agenda redirect (nível de componente)', async () => {
    vi.useFakeTimers()
    // O wire vigente nunca produz disponivel sem alvo (aplicarEventoDeEncaminhamento
    // sempre anexa o alvo); o caso é fabricado direto no componente, sem mudar o protocolo.
    const assignSpy = vi.fn()
    stubLocationComAssign(assignSpy)

    const { container } = render(
      <EncaminhamentoOverlay
        encaminhamento={{ fase: 'disponivel', alvo: null, codigo: null, motivo: null, mensagem: null }}
        href={null}
        codigoDeSala="ABCDEF"
      />,
    )
    expect(container.querySelector('[data-testid="encaminhamento-overlay"]')).toBeNull()

    avancarParaDepoisDoRedirect()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('recusa tardia cancela o redirect pendente e nunca navega para Partida inexistente', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const assignSpy = vi.fn()
    stubLocationComAssign(assignSpy)

    renderSala()
    const ws = await abrirSala(instances)

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_DISPONIVEL',
        partidaId: 'partida-123',
        serverId: 'server-abc',
      }),
    )
    expect(await screen.findByTestId('encaminhamento-carregando')).toBeInTheDocument()

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_RECUSADA',
        codigo: 'ENCAMINHAMENTO_RECUSADO',
        motivo: 'O servidor de jogo recusou a partida. Tente iniciar novamente.',
      }),
    )

    expect(await screen.findByTestId('aviso-encaminhamento')).toBeInTheDocument()
    expect(screen.queryByTestId('encaminhamento-overlay')).not.toBeInTheDocument()

    vi.useFakeTimers()
    avancarParaDepoisDoRedirect()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('recusa exibe aviso compreensível e a página volta ao estado normal da Sala', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()
    const ws = await abrirSala(instances)

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))
    expect(await screen.findByTestId('encaminhamento-overlay')).toBeInTheDocument()

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
    expect(screen.queryByTestId('encaminhamento-overlay')).not.toBeInTheDocument()
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
    const ws = await abrirSala(instances)

    act(() => ws.simulateMessage({ type: 'PARTIDA_FALHOU', codigo: 'ENCAMINHAMENTO_FALHOU', motivo: '' }))

    const aviso = await screen.findByTestId('aviso-encaminhamento')
    expect(aviso).toHaveTextContent(/falha ao preparar/i)
    expect(aviso.textContent).toMatch(/tente novamente/i)
    expect(screen.queryByTestId('encaminhamento-overlay')).not.toBeInTheDocument()
    expect(await screen.findByText('ABCDEF')).toBeInTheDocument()
  })

  it('quem reconecta a uma Sala encaminhada vê a mesma animação e é redirecionado sozinho, sem card', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const assignSpy = vi.fn()
    stubLocationComAssign(assignSpy)

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

    expect(await screen.findByTestId('encaminhamento-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('encaminhamento-carregando')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /carregando partida/i })).toBeInTheDocument()
    semNavegacaoVisivel(document.body)

    await waitFor(() => expect(assignSpy).toHaveBeenCalled(), { timeout: 3000 })
    const destino = String(assignSpy.mock.calls[0]?.[0] ?? '')
    expect(destino).toContain('server-xyz')
    expect(destino).toContain('partida-999')
  })

  it('o overlay bloqueia a Sala e expõe a região de estado "Carregando partida"', async () => {
    mockAuthMe()
    const { MockWebSocket, instances } = createMockWebSocket()
    vi.stubGlobal('WebSocket', MockWebSocket)

    renderSala()
    const ws = await abrirSala(instances)

    act(() => ws.simulateMessage({ type: 'PARTIDA_PREPARANDO' }))

    const overlay = await screen.findByTestId('encaminhamento-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('status', { name: /carregando partida/i })).toBeInTheDocument()
    // Nome acessível único: só a região de estado anuncia "Carregando partida",
    // sem duplicar o anúncio no container dialog.
    expect(screen.queryByRole('dialog', { name: /carregando partida/i })).toBeNull()
    expect(await screen.findByText('ABCDEF')).toBeInTheDocument()
    semNavegacaoVisivel(document.body)
  })
})
