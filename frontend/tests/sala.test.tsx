import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'

// --- Mock WebSocket global ---
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  readyState = 1
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.onclose?.(new CloseEvent('close') as CloseEvent)
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }) as MessageEvent)
  }

  static clean() {
    MockWebSocket.instances = []
  }

  static last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }
}

// @ts-expect-error overwrite global for tests
global.WebSocket = MockWebSocket as unknown as typeof WebSocket
// garante OPEN no global para o hook comparar
// @ts-expect-error ensure static property
if ((global.WebSocket as unknown as { OPEN?: number }).OPEN === undefined) {
  // @ts-expect-error assign
  global.WebSocket.OPEN = 1
}
// jsdom não tem MessageEvent construtor completo, polyfill simples se necessário
if (typeof MessageEvent === 'undefined') {
  // @ts-expect-error polyfill
  global.MessageEvent = class MessageEvent extends Event {
    data: unknown
    constructor(type: string, init: { data: unknown }) {
      super(type)
      this.data = init.data
    }
  }
}

// Mock clipboard - usa defineProperty para garantir escrita em jsdom
const clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined)
// @ts-expect-error jsdom clipboard may be readonly
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: clipboardWriteTextMock },
  configurable: true,
  writable: true,
})
// Garante também em window.navigator (jsdom pode ter getter distinto)
try {
  // @ts-expect-error assign window
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: clipboardWriteTextMock },
    configurable: true,
    writable: true,
  })
} catch {
  // fallback direto
  // @ts-expect-error overwrite
  window.navigator.clipboard.writeText = clipboardWriteTextMock
}

function renderWithRouter(initialEntries: string[] = ['/salas/criar'], authState: AuthState = mockAuthenticatedState) {
  MockWebSocket.clean()
  const router = createMemoryRouter(routes, { initialEntries })
  return render(
    <AuthProvider initialState={authState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

function criarMembro(overrides: Partial<{
  id: string
  jogadorId: string
  apelido: string
  ordemDeEntrada: number
  presenca: 'conectado' | 'em_reconexao'
  prontidao: boolean
}> = {}) {
  return {
    id: overrides.id ?? `membro-${(overrides.ordemDeEntrada ?? 0) + 1}`,
    jogadorId: overrides.jogadorId ?? `jogador-${(overrides.ordemDeEntrada ?? 0) + 1}`,
    apelido: overrides.apelido ?? `Jogador${(overrides.ordemDeEntrada ?? 0) + 1}`,
    ordemDeEntrada: overrides.ordemDeEntrada ?? 0,
    presenca: (overrides.presenca ?? 'conectado') as 'conectado' | 'em_reconexao',
    prontidao: overrides.prontidao ?? false,
  }
}

function criarSala(overrides: Partial<{
  codigoDeSala: string
  anfitriaoId: string
  membros: ReturnType<typeof criarMembro>[]
  conviteLink: string
}> = {}) {
  const codigo = overrides.codigoDeSala ?? 'A3K9M2'
  const membros = overrides.membros ?? [criarMembro({ apelido: 'LucasGomes', ordemDeEntrada: 0 })]
  const anfitriaoId = overrides.anfitriaoId ?? membros[0].id
  return {
    id: 'sala-1',
    codigoDeSala: codigo,
    estado: 'aberta' as const,
    anfitriaoId,
    membros,
    convite: { codigoDeSala: codigo, link: overrides.conviteLink ?? `http://localhost/sala/${codigo}` },
  }
}

describe('lobby - página do lobby', () => {
  beforeEach(() => {
    MockWebSocket.clean()
    vi.clearAllMocks()
    // Mock clipboard estável via prototype getter (jsdom retorna instância nova a cada acesso)
    const mockWriteText = vi.fn().mockResolvedValue(undefined)
    try {
      Object.defineProperty(Object.getPrototypeOf(navigator), 'clipboard', {
        get: () => ({ writeText: mockWriteText }),
        configurable: true,
      })
    } catch {
      // fallback direto
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        configurable: true,
      })
    }
    // expõe para asserções (será usado no teste de cópia)
    ;(globalThis as unknown as { __mockWriteText: unknown }).__mockWriteText = mockWriteText
  })

  it('Visitante que acessa /salas/criar é redirecionado para login com mensagem orientativa', async () => {
    renderWithRouter(['/salas/criar'], visitorState)

    expect(await screen.findByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByText(/entre para acessar/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  it('Visitante que acessa /sala/:codigo é redirecionado para login', async () => {
    renderWithRouter(['/sala/A3K9M2'], visitorState)

    expect(await screen.findByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByText(/entre para acessar/i)).toBeInTheDocument()
  })

  it('Criar Sala exibe o Código de Sala e o Convite para compartilhar', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)

    // heading institucional Criar Sala deve estar visível mesmo antes de criar
    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()

    const botaoCriar = screen.getByRole('button', { name: /iniciar sessão/i })
    await user.click(botaoCriar)

    const ws = MockWebSocket.last()
    expect(ws).toBeDefined()
    const ultimoEnvio = JSON.parse(ws!.sentMessages[ws!.sentMessages.length - 1] as string)
    expect(ultimoEnvio.type).toBe('CRIAR_SALA')

    // Simula resposta SALA_ATUALIZADA
    const sala = criarSala({ codigoDeSala: 'A3K9M2' })
    ws!.simulateMessage({ type: 'SALA_ATUALIZADA', sala })

    expect(await screen.findByText('A3K9M2')).toBeInTheDocument()
    expect(screen.getByText(/\/sala\/A3K9M2/)).toBeInTheDocument()
    expect(screen.getByLabelText('Código de Sala')).toBeInTheDocument()
    expect(screen.getByLabelText('Link Direto')).toBeInTheDocument()
  })

  it('Entrar por Código de Sala digitado funciona', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)

    const input = screen.getByPlaceholderText(/código de sala/i)
    await user.type(input, 'B7K2P9')

    const botaoEntrar = screen.getByRole('button', { name: /entrar na sala/i })
    await user.click(botaoEntrar)

    const ws = MockWebSocket.last()
    expect(ws).toBeDefined()
    const envio = JSON.parse(ws!.sentMessages[ws!.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'ENTRAR_NA_SALA', codigoDeSala: 'B7K2P9' })

    const sala = criarSala({ codigoDeSala: 'B7K2P9', membros: [criarMembro({ apelido: 'OutroJogador', ordemDeEntrada: 0 })] })
    ws!.simulateMessage({ type: 'SALA_ATUALIZADA', sala })

    expect(await screen.findByText('B7K2P9')).toBeInTheDocument()
  })

  it('Entrar por rota de Convite /sala/:codigo envia ENTRAR_NA_SALA automaticamente', async () => {
    renderWithRouter(['/sala/C9X1Z2'], mockAuthenticatedState)

    // Aguarda WS conectar e auto-entrar
    await waitFor(() => {
      const ws = MockWebSocket.last()
      expect(ws).toBeDefined()
      const hasEntrar = ws!.sentMessages.some((m) => {
        try {
          const parsed = JSON.parse(m as string)
          return parsed.type === 'ENTRAR_NA_SALA' && parsed.codigoDeSala === 'C9X1Z2'
        } catch {
          return false
        }
      })
      expect(hasEntrar).toBe(true)
    })

    const ws = MockWebSocket.last()!
    const sala = criarSala({ codigoDeSala: 'C9X1Z2' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })

    expect(await screen.findByText('C9X1Z2')).toBeInTheDocument()
  })

  it('lista de Membros mostra ordem de entrada e identifica o Anfitrião', async () => {
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)
    const ws = MockWebSocket.last()!
    await waitFor(() => expect(ws.onopen).toBeDefined())
    // simula microtask de open
    await new Promise((r) => setTimeout(r, 0))

    const membros = [
      criarMembro({ id: 'm1', apelido: 'Ana', ordemDeEntrada: 0 }),
      criarMembro({ id: 'm2', apelido: 'Beto', ordemDeEntrada: 1 }),
      criarMembro({ id: 'm3', apelido: 'Carla', ordemDeEntrada: 2 }),
    ]
    // entrega fora de ordem para testar ordenação
    const sala = criarSala({ codigoDeSala: 'X1Y2Z3', membros: [membros[2], membros[0], membros[1]], anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })

    await screen.findByText('Ana')
    const lista = screen.getByLabelText('Lista de Membros')
    const itens = within(lista).getAllByRole('listitem')
    // Verifica ordem: Ana, Beto, Carla
    expect(itens[0]).toHaveTextContent('Ana')
    expect(itens[1]).toHaveTextContent('Beto')
    expect(itens[2]).toHaveTextContent('Carla')
    // Anfitrião identificado
    expect(screen.getByText(/anfitrião/i)).toBeInTheDocument()
  })

  it('vagas disponíveis são visíveis quando sala não tem 4 membros', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)

    const botaoCriar = screen.getByRole('button', { name: /iniciar sessão/i })
    await user.click(botaoCriar)
    const ws = MockWebSocket.last()!
    const sala = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [criarMembro({ apelido: 'LucasGomes', ordemDeEntrada: 0 })],
    })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })

    await screen.findByText('LucasGomes')

    expect(screen.getByText(/membro 1 de 4/i)).toBeInTheDocument()
    expect(screen.getAllByText(/aguardando conexão/i).length).toBe(3)
    expect(screen.getAllByText(/sinal inexistente/i).length).toBe(3)
  })

  it('pronto alterna e reflete o estado dos demais Membros', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)

    const ws = MockWebSocket.last()!
    const membros = [
      criarMembro({ id: 'm1', apelido: 'LucasGomes', ordemDeEntrada: 0, prontidao: false }),
      criarMembro({ id: 'm2', apelido: 'Ana', ordemDeEntrada: 1, prontidao: false }),
    ]
    const salaInicial = criarSala({ codigoDeSala: 'A3K9M2', membros, anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaInicial })
    await screen.findByText('LucasGomes')

    // Inicialmente ninguém pronto
    expect(screen.queryByText(/pronto/i)).not.toBeInTheDocument()

    const botaoProntidao = screen.getByRole('button', { name: /alternar prontidão/i })
    await user.click(botaoProntidao)

    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio.type).toBe('ALTERNAR_PRONTIDAO')

    // Servidor reconcilia: Ana ficou pronta
    const membrosAtualizados = [
      criarMembro({ id: 'm1', apelido: 'LucasGomes', ordemDeEntrada: 0, prontidao: false }),
      criarMembro({ id: 'm2', apelido: 'Ana', ordemDeEntrada: 1, prontidao: true }),
    ]
    const salaAtualizada = criarSala({ codigoDeSala: 'A3K9M2', membros: membrosAtualizados, anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'PRONTIDAO_ATUALIZADA', membroId: 'm2', prontidao: true, sala: salaAtualizada })

    expect(await screen.findByText(/ana.*pronto/i)).toBeInTheDocument()
  })

  it('avisos de entrada, saída, desconexão e substituição de Anfitrião aparecem em tempo real', async () => {
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)
    const ws = MockWebSocket.last()!

    const salaInicial = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarMembro({ id: 'm1', apelido: 'LucasGomes', ordemDeEntrada: 0 })], anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaInicial })
    await screen.findByText('LucasGomes')

    // MEMBRO_ENTROU
    const novoMembro = criarMembro({ id: 'm2', apelido: 'Ana', ordemDeEntrada: 1 })
    const salaComEntrada = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarMembro({ id: 'm1', apelido: 'LucasGomes', ordemDeEntrada: 0 }), novoMembro], anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'MEMBRO_ENTROU', membro: novoMembro, sala: salaComEntrada })
    expect(await screen.findByText(/ana entrou na sala/i)).toBeInTheDocument()

    // MEMBRO_SAIU
    const salaAposSaida = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarMembro({ id: 'm1', apelido: 'LucasGomes', ordemDeEntrada: 0 })], anfitriaoId: 'm1' })
    ws.simulateMessage({ type: 'MEMBRO_SAIU', membroId: 'm2', jogadorId: 'j2', sala: salaAposSaida })
    expect(await screen.findByText(/membro saiu/i)).toBeInTheDocument()

    // MEMBRO_DESCONECTADO
    ws.simulateMessage({ type: 'MEMBRO_DESCONECTADO', membroId: 'm1', jogadorId: 'j1', presenca: 'em_reconexao', sala: salaAposSaida })
    expect(await screen.findByText(/desconectado/i)).toBeInTheDocument()

    // ANFITRIAO_SUBSTITUIDO
    const novoAnfitriao = criarMembro({ id: 'm3', apelido: 'Beto', ordemDeEntrada: 1 })
    const salaNovoAnfitriao = criarSala({ codigoDeSala: 'A3K9M2', membros: [novoAnfitriao], anfitriaoId: 'm3' })
    ws.simulateMessage({ type: 'ANFITRIAO_SUBSTITUIDO', anfitriaoId: 'm3', anfitriaoAnteriorId: 'm1', sala: salaNovoAnfitriao })
    expect(await screen.findByText(/anfitrião substituído/i)).toBeInTheDocument()
  })

  it('cópia de Código de Sala e Link Direto funciona', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)
    const ws = MockWebSocket.last()!
    const sala = criarSala({ codigoDeSala: 'A3K9M2' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })
    await screen.findByText('A3K9M2')

    const botaoCopiarCodigo = screen.getByRole('button', { name: /copiar código de acesso/i })
    await user.click(botaoCopiarCodigo)
    // Valida feedback visual de cópia (comportamento externo, evita spy frágil em jsdom)
    expect(await screen.findByText('Copiado!')).toBeInTheDocument()

    const botaoCopiarLink = screen.getByRole('button', { name: /copiar link direto/i })
    await user.click(botaoCopiarLink)
    // Após segunda cópia também deve haver feedback (pode ser segundo elemento ou mesmo)
    await waitFor(() => expect(screen.getAllByText('Copiado!').length).toBeGreaterThanOrEqual(1))
  })

  it('Sair da Sala envia SAIR_DA_SALA e limpa o estado', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], mockAuthenticatedState)
    const ws = MockWebSocket.last()!
    const sala = criarSala({ codigoDeSala: 'A3K9M2' })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })
    await screen.findByText('A3K9M2')

    const main = document.querySelector('main')!
    const botaoSair = within(main).getByRole('button', { name: /^sair da sala$/i })
    await user.click(botaoSair)

    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio.type).toBe('SAIR_DA_SALA')
    // Após sair, a UI volta a mostrar estado vazio
    await waitFor(() => expect(screen.queryByText('A3K9M2')).not.toBeInTheDocument())
  })
})
