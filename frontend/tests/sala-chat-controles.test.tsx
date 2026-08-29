import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'

// --- Mock WebSocket global (padrão de tests/sala.test.tsx) ---
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static forceNoAutoOpen = false
  url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    if (MockWebSocket.forceNoAutoOpen) {
      this.readyState = MockWebSocket.CONNECTING
    } else {
      this.readyState = MockWebSocket.OPEN
      queueMicrotask(() => this.onopen?.(new Event('open')))
    }
    MockWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
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
  estado: 'aberta' | 'encaminhada'
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
    estado: (overrides.estado ?? 'aberta') as 'aberta' | 'encaminhada',
    anfitriaoId,
    membros,
    convite: { codigoDeSala: codigo, link: overrides.conviteLink ?? `http://localhost/sala/${codigo}` },
  }
}

const EU_ID = mockAuthenticatedState.jogador.id

// Membro local autenticado, pronto e conectado por padrão (Anfitrião nos cenários de controles)
function criarEu(overrides: Partial<{ prontidao: boolean; presenca: 'conectado' | 'em_reconexao' }> = {}) {
  return criarMembro({
    id: 'm-eu',
    jogadorId: EU_ID,
    apelido: 'JogadorTeste',
    ordemDeEntrada: 0,
    prontidao: overrides.prontidao ?? true,
    presenca: overrides.presenca ?? 'conectado',
  })
}

// Monta a página com sala já aberta. Por padrão o Anfitrião é o primeiro
// membro da lista; passe anfitriaoId explícito quando precisar de outro.
async function montarLobby(
  membros: ReturnType<typeof criarMembro>[] = [criarEu()],
  overrides: Partial<{ codigoDeSala: string; estado: 'aberta' | 'encaminhada'; anfitriaoId: string }> = {},
) {
  renderWithRouter(['/salas/criar'])
  const ws = MockWebSocket.last()!
  const sala = criarSala({
    codigoDeSala: 'A3K9M2',
    membros,
    anfitriaoId: overrides.anfitriaoId ?? membros[0].id,
    estado: overrides.estado,
  })
  ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala })
  await screen.findByText('A3K9M2')
  return ws
}

const montarLobbyComoAnfitriao = (membros: ReturnType<typeof criarMembro>[] = [criarEu()]) =>
  montarLobby(membros, { anfitriaoId: 'm-eu' })

describe('lobby - chat e controles do Anfitrião', () => {
  beforeEach(() => {
    MockWebSocket.clean()
    MockWebSocket.forceNoAutoOpen = false
    vi.restoreAllMocks()
  })

  // --- Chat ---

  it('envia ENVIAR_MENSAGEM_DE_CHAT com o conteúdo digitado', async () => {
    const user = userEvent.setup()
    const ws = await montarLobbyComoAnfitriao()

    const input = screen.getByPlaceholderText('ENVIAR MENSAGEM...')
    await user.type(input, 'Olá grupo')
    await user.click(screen.getByRole('button', { name: /enviar mensagem/i }))

    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'ENVIAR_MENSAGEM_DE_CHAT', conteudo: 'Olá grupo' })
  })

  it('mensagem recebida via MENSAGEM_DE_CHAT aparece no feed com apelido e conteúdo', async () => {
    const ws = await montarLobbyComoAnfitriao()

    ws.simulateMessage({
      type: 'MENSAGEM_DE_CHAT',
      membroId: 'm2',
      apelido: 'Zanetti',
      conteudo: 'Internet tá ruim...',
      enviadoEm: new Date().toISOString(),
    })

    const feed = screen.getByLabelText('Histórico do chat')
    expect(await within(feed).findByText(/zanetti: internet tá ruim/i)).toBeInTheDocument()
  })

  it('campo de mensagem respeita o limite de 500 caracteres', async () => {
    const user = userEvent.setup()
    await montarLobbyComoAnfitriao()

    const input = screen.getByPlaceholderText('ENVIAR MENSAGEM...') as HTMLInputElement
    expect(input).toHaveAttribute('maxlength', '500')

    await user.type(input, 'a'.repeat(510))
    expect(input.value.length).toBe(500)
  })

  it('botão de envio desabilitado com campo vazio ou só espaços', async () => {
    const user = userEvent.setup()
    await montarLobbyComoAnfitriao()

    const botaoEnviar = screen.getByRole('button', { name: /enviar mensagem/i })
    expect(botaoEnviar).toBeDisabled()

    const input = screen.getByPlaceholderText('ENVIAR MENSAGEM...')
    await user.type(input, '   ')
    expect(botaoEnviar).toBeDisabled()
  })

  it('histórico recebido ao entrar (replay) aparece no feed em ordem', async () => {
    const ws = await montarLobbyComoAnfitriao()

    const base = Date.parse('2026-01-01T10:00:00.000Z')
    const replay = [
      { apelido: 'Ana', conteudo: 'oi', offset: 0 },
      { apelido: 'Beto', conteudo: 'bora', offset: 1000 },
      { apelido: 'Carla', conteudo: 'prontos?', offset: 2000 },
    ]
    replay.forEach((r, i) => {
      ws.simulateMessage({
        type: 'MENSAGEM_DE_CHAT',
        membroId: `m${i + 2}`,
        apelido: r.apelido,
        conteudo: r.conteudo,
        enviadoEm: new Date(base + r.offset).toISOString(),
      })
    })

    const feed = screen.getByLabelText('Histórico do chat')
    await within(feed).findByText(/ana: oi/i)
    expect(feed.textContent).toMatch(/ana: oi[\s\S]*beto: bora[\s\S]*carla: prontos\?/i)
  })

  // --- Visibilidade dos controles ---

  it('não-Anfitrião não vê Expulsar, Encerrar Sala nem Iniciar Partida', async () => {
    const host = criarMembro({ id: 'm1', jogadorId: 'j-host', apelido: 'Host', ordemDeEntrada: 0 })
    const eu = criarEu()
    await montarLobby([host, eu])

    expect(screen.queryByRole('button', { name: /expulsar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /encerrar sala/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /iniciar partida/i })).not.toBeInTheDocument()
  })

  it('Anfitrião vê Encerrar Sala e Iniciar Partida', async () => {
    await montarLobbyComoAnfitriao()

    expect(screen.getByRole('button', { name: /encerrar sala/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeInTheDocument()
  })

  // --- Expulsar ---

  it('Anfitrião expulsa outro Membro e o comando traz o membroId alvo', async () => {
    const user = userEvent.setup()
    const outro = criarMembro({ id: 'm2', jogadorId: 'j-outro', apelido: 'Zanetti', ordemDeEntrada: 1 })
    const ws = await montarLobbyComoAnfitriao([criarEu(), outro])

    const botoesExpulsar = screen.getAllByRole('button', { name: /expulsar/i })
    expect(botoesExpulsar).toHaveLength(1)
    await user.click(botoesExpulsar[0] as HTMLElement)

    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'EXPULSAR_MEMBRO', membroId: 'm2' })
  })

  it('não há botão Expulsar no próprio Anfitrião', async () => {
    await montarLobbyComoAnfitriao([criarEu()])

    expect(screen.queryByRole('button', { name: /expulsar/i })).not.toBeInTheDocument()
  })

  // --- Desbloquear ---

  it('MEMBRO_EXPULSO cria entrada na lista de bloqueados e Desbloquear envia o jogadorId', async () => {
    const user = userEvent.setup()
    const zanetti = criarMembro({ id: 'm2', jogadorId: 'j-zanetti', apelido: 'Zanetti', ordemDeEntrada: 1 })
    const ws = await montarLobbyComoAnfitriao([criarEu(), zanetti])

    // Expulsão observada: a sala do evento já vem sem o membro; o apelido
    // vem da sala anterior à observação do evento.
    const salaAposExpulsao = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarEu()], anfitriaoId: 'm-eu' })
    ws.simulateMessage({ type: 'MEMBRO_EXPULSO', membroId: 'm2', jogadorId: 'j-zanetti', sala: salaAposExpulsao })

    const secaoBloqueados = await screen.findByLabelText('Jogadores bloqueados')
    expect(within(secaoBloqueados).getByText('Zanetti')).toBeInTheDocument()

    await user.click(within(secaoBloqueados).getByRole('button', { name: /desbloquear/i }))
    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'DESBLOQUEAR_JOGADOR', jogadorId: 'j-zanetti' })
  })

  it('lista de bloqueados fica oculta quando vazia', async () => {
    await montarLobbyComoAnfitriao()

    expect(screen.queryByLabelText('Jogadores bloqueados')).not.toBeInTheDocument()
  })

  // --- Encerrar ---

  it('Encerrar Sala com confirmação envia ENCERRAR_SALA', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const ws = await montarLobbyComoAnfitriao()

    await user.click(screen.getByRole('button', { name: /encerrar sala/i }))

    expect(confirmSpy).toHaveBeenCalled()
    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'ENCERRAR_SALA' })
  })

  it('Encerrar Sala sem confirmação não envia comando', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const ws = await montarLobbyComoAnfitriao()

    await user.click(screen.getByRole('button', { name: /encerrar sala/i }))

    const enviouEncerrar = ws.sentMessages.some((m) => JSON.parse(m as string).type === 'ENCERRAR_SALA')
    expect(enviouEncerrar).toBe(false)
  })

  // --- Iniciar ---

  it('Iniciar Partida desabilitado com apenas 3 Membros', async () => {
    await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: true }),
    ])

    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeDisabled()
  })

  it('Iniciar Partida desabilitado com 4 Membros mas um em reconexão', async () => {
    await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: true }),
      criarMembro({ id: 'm4', jogadorId: 'j4', apelido: 'Diogo', ordemDeEntrada: 3, prontidao: true, presenca: 'em_reconexao' }),
    ])

    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeDisabled()
  })

  it('Iniciar Partida desabilitado com 4 Membros mas um não pronto', async () => {
    await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: false }),
      criarMembro({ id: 'm4', jogadorId: 'j4', apelido: 'Diogo', ordemDeEntrada: 3, prontidao: true }),
    ])

    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeDisabled()
  })

  it('Iniciar Partida habilitado com 4 Membros conectados e prontos e envia INICIAR_PARTIDA', async () => {
    const user = userEvent.setup()
    const ws = await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: true }),
      criarMembro({ id: 'm4', jogadorId: 'j4', apelido: 'Diogo', ordemDeEntrada: 3, prontidao: true }),
    ])

    const botaoIniciar = screen.getByRole('button', { name: /iniciar partida/i })
    expect(botaoIniciar).toBeEnabled()
    await user.click(botaoIniciar)

    const envio = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)
    expect(envio).toEqual({ type: 'INICIAR_PARTIDA' })
  })

  // --- Aviso de encaminhada ---

  it('SALA_ATUALIZADA com estado encaminhada gera linha [SISTEMA] no feed do chat, sem duplicar', async () => {
    const ws = await montarLobbyComoAnfitriao()
    const salaEncaminhada = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [criarEu()],
      anfitriaoId: 'm-eu',
      estado: 'encaminhada',
    })

    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncaminhada })
    const feed = screen.getByLabelText('Histórico do chat')
    await within(feed).findByText(/sala encaminhada para a partida/i)

    // Reenvio do mesmo estado não duplica o aviso (salaAnterior já estava encaminhada)
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncaminhada })
    await waitFor(() => expect(within(feed).getAllByText(/sala encaminhada para a partida/i)).toHaveLength(1))
  })
})
