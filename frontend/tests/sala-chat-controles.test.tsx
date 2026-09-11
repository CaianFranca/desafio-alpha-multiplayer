import { render, renderHook, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { useSalaWebSocket } from '../web/src/hooks/useSalaWebSocket'
import { MockWebSocket } from './helpers/mockWebSocket'

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
  ehBot?: boolean
}> = {}) {
  return {
    id: overrides.id ?? `membro-${(overrides.ordemDeEntrada ?? 0) + 1}`,
    jogadorId: overrides.jogadorId ?? `jogador-${(overrides.ordemDeEntrada ?? 0) + 1}`,
    apelido: overrides.apelido ?? `Jogador${(overrides.ordemDeEntrada ?? 0) + 1}`,
    ordemDeEntrada: overrides.ordemDeEntrada ?? 0,
    presenca: (overrides.presenca ?? 'conectado') as 'conectado' | 'em_reconexao',
    prontidao: overrides.prontidao ?? false,
    ...(overrides.ehBot === true ? { ehBot: true as const } : {}),
  }
}

function criarSala(overrides: Partial<{
  codigoDeSala: string
  estado: 'aberta' | 'encaminhada' | 'encerrada' | 'expirada'
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
    estado: (overrides.estado ?? 'aberta') as 'aberta' | 'encaminhada' | 'encerrada' | 'expirada',
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

  it('chat não renderiza sem sala (tela de criar/entrar)', async () => {
    renderWithRouter(['/salas/criar'])

    // Sem SALA_ATUALIZADA, nenhuma sala existe: sem seção de chat na tela
    await waitFor(() => expect(screen.getByText(/crie uma sala ou entre/i)).toBeInTheDocument())
    expect(screen.queryByLabelText('Chat do Lobby')).not.toBeInTheDocument()
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

  it('MEMBRO_EXPULSO de bot não entra na lista de bloqueados (humano sim)', async () => {
    const zanetti = criarMembro({ id: 'm2', jogadorId: 'j-zanetti', apelido: 'Zanetti', ordemDeEntrada: 1 })
    const bot = criarMembro({ id: 'm3', jogadorId: 'j-bot', apelido: 'Irmã do Turno', ordemDeEntrada: 2, ehBot: true })
    const ws = await montarLobbyComoAnfitriao([criarEu(), zanetti, bot])

    // Humano expulso: entra na lista.
    const salaSemZanetti = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarEu(), bot], anfitriaoId: 'm-eu' })
    ws.simulateMessage({ type: 'MEMBRO_EXPULSO', membroId: 'm2', jogadorId: 'j-zanetti', sala: salaSemZanetti })
    const secaoBloqueados = await screen.findByLabelText('Jogadores bloqueados')
    expect(within(secaoBloqueados).getByText('Zanetti')).toBeInTheDocument()

    // Bot removido: o aviso chega, mas a lista não ganha entrada.
    const salaSemBot = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarEu()], anfitriaoId: 'm-eu' })
    ws.simulateMessage({ type: 'MEMBRO_EXPULSO', membroId: 'm3', jogadorId: 'j-bot', ehBot: true, sala: salaSemBot })
    await screen.findByText(/irmã do turno foi expulso/i)
    expect(within(secaoBloqueados).queryByText('Irmã do Turno')).not.toBeInTheDocument()
    expect(within(secaoBloqueados).getAllByRole('listitem')).toHaveLength(1)
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

  it('Iniciar Partida habilitado com 3 Membros conectados e prontos', async () => {
    const user = userEvent.setup()
    const ws = await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: true }),
    ])

    const botao = screen.getByRole('button', { name: /iniciar partida/i })
    expect(botao).toBeEnabled()
    await user.click(botao)
    expect(JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)).toEqual({ type: 'INICIAR_PARTIDA' })
  })

  it('Iniciar Partida habilitado com 2 Membros conectados e prontos', async () => {
    const user = userEvent.setup()
    const ws = await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
    ])

    const botao = screen.getByRole('button', { name: /iniciar partida/i })
    expect(botao).toBeEnabled()
    await user.click(botao)
    expect(JSON.parse(ws.sentMessages[ws.sentMessages.length - 1] as string)).toEqual({ type: 'INICIAR_PARTIDA' })
  })

  it('Iniciar Partida desabilitado com apenas 1 Membro', async () => {
    await montarLobbyComoAnfitriao([criarEu()])

    expect(screen.getByRole('button', { name: /iniciar partida/i })).toBeDisabled()
  })

  it('Iniciar Partida desabilitado com 3 Membros mas um não pronto', async () => {
    await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: false }),
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

  it('Iniciar Partida desabilitado com 3 Membros mas um em reconexão', async () => {
    await montarLobbyComoAnfitriao([
      criarEu(),
      criarMembro({ id: 'm2', jogadorId: 'j2', apelido: 'Beto', ordemDeEntrada: 1, prontidao: true }),
      criarMembro({ id: 'm3', jogadorId: 'j3', apelido: 'Carla', ordemDeEntrada: 2, prontidao: true, presenca: 'em_reconexao' }),
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

  // --- Encerramento e expiração ---

  it('SALA_ATUALIZADA encerrada volta ao estado criar/entrar: sem chat, sem prontidão, com aviso', async () => {
    const ws = await montarLobbyComoAnfitriao()
    expect(screen.getByRole('button', { name: /alternar prontidão/i })).toBeInTheDocument()

    const salaEncerrada = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [],
      anfitriaoId: 'm-eu',
      estado: 'encerrada',
    })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncerrada })

    // Sala deixa de existir para o jogador: controles e chat somem, tela volta a Criar Sala
    expect(await screen.findByRole('button', { name: /criar sala/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /alternar prontidão/i })).not.toBeInTheDocument()
    // O "Sair da Sala" do Header persiste; o do corpo da página (contexto de sala) some
    const main = document.querySelector('main')!
    expect(within(main).queryByRole('button', { name: /^sair da sala$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Chat do Lobby')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /encerrar sala/i })).not.toBeInTheDocument()
    // Aviso explica o porquê
    expect(await screen.findByText(/a sala foi encerrada/i)).toBeInTheDocument()
  })

  it('SALA_ATUALIZADA expirada também volta ao estado criar/entrar', async () => {
    const ws = await montarLobbyComoAnfitriao()

    const salaExpirada = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [],
      anfitriaoId: 'm-eu',
      estado: 'expirada',
    })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaExpirada })

    expect(await screen.findByRole('button', { name: /criar sala/i })).toBeInTheDocument()
    expect(await screen.findByText(/a sala expirou/i)).toBeInTheDocument()
  })

  it('SALA_ATUALIZADA encaminhada mantém a sala (não volta ao criar/entrar)', async () => {
    const ws = await montarLobbyComoAnfitriao()

    const salaEncaminhada = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [criarEu()],
      anfitriaoId: 'm-eu',
      estado: 'encaminhada',
    })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncaminhada })

    expect(await screen.findByText(/sala encaminhada para a partida/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alternar prontidão/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Chat do Lobby')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  // --- Aviso de encaminhada ---

  it('SALA_ATUALIZADA com estado encaminhada gera aviso no AvisosDoLobby, sem duplicar e sem entrar no chat', async () => {
    const ws = await montarLobbyComoAnfitriao()
    const salaEncaminhada = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [criarEu()],
      anfitriaoId: 'm-eu',
      estado: 'encaminhada',
    })

    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncaminhada })
    expect(await screen.findByText(/sala encaminhada para a partida/i)).toBeInTheDocument()

    // O feed do chat exibe somente mensagens de jogadores — aviso não vira linha [SISTEMA]
    const feed = screen.getByLabelText('Histórico do chat')
    expect(within(feed).queryByText(/sala encaminhada para a partida/i)).not.toBeInTheDocument()

    // Reenvio do mesmo estado não duplica o aviso (salaAnterior já estava encaminhada)
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaEncaminhada })
    await waitFor(() => expect(screen.getAllByText(/sala encaminhada para a partida/i)).toHaveLength(1))
  })

  // --- Guardas de envio do hook (defesa além do maxLength da UI) ---

  it('enviarMensagemDeChat recusa vazio, só-espaços e acima de 500 caracteres', async () => {
    const { result } = renderHook(() => useSalaWebSocket('j-1'))
    await waitFor(() => expect(MockWebSocket.last()!.readyState).toBe(MockWebSocket.OPEN))
    const ws = MockWebSocket.last()!

    result.current.enviarMensagemDeChat('')
    result.current.enviarMensagemDeChat('   ')
    result.current.enviarMensagemDeChat('x'.repeat(501))
    expect(ws.sentMessages).toHaveLength(0)

    result.current.enviarMensagemDeChat('Olá grupo')
    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0] as string)).toEqual({
      type: 'ENVIAR_MENSAGEM_DE_CHAT',
      conteudo: 'Olá grupo',
    })
  })

  // --- Reconciliação da lista de bloqueados ---

  it('bloqueado re-admitido na sala (retorno_autorizado -> SALA_ATUALIZADA) sai da lista de bloqueados', async () => {
    const zanetti = criarMembro({ id: 'm2', jogadorId: 'j-zanetti', apelido: 'Zanetti', ordemDeEntrada: 1 })
    const ws = await montarLobbyComoAnfitriao([criarEu(), zanetti])

    // Expulsão observada: Zanetti entra na lista local
    const salaAposExpulsao = criarSala({ codigoDeSala: 'A3K9M2', membros: [criarEu()], anfitriaoId: 'm-eu' })
    ws.simulateMessage({ type: 'MEMBRO_EXPULSO', membroId: 'm2', jogadorId: 'j-zanetti', sala: salaAposExpulsao })
    const secaoBloqueados = await screen.findByLabelText('Jogadores bloqueados')
    expect(within(secaoBloqueados).getByText('Zanetti')).toBeInTheDocument()

    // Retorno autorizado após DESBLOQUEAR: o servidor emite só SALA_ATUALIZADA
    // (sem MEMBRO_ENTROU). A lista local deve reconciliar com a sala recebida.
    const salaComRetorno = criarSala({
      codigoDeSala: 'A3K9M2',
      membros: [criarEu(), zanetti],
      anfitriaoId: 'm-eu',
    })
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: salaComRetorno })

    await waitFor(() => expect(screen.queryByLabelText('Jogadores bloqueados')).not.toBeInTheDocument())
  })
})
