// Chat da Partida (issue #389): suíte de comportamento externo com snapshot
// mockado injetado via MockWebSocket (mesmos padrões de partida-hud e
// partida-conexao). Cobre os 5 critérios de aceitação da issue:
// (1) apelido na cor do peão + hora HH:MM em mensagem própria, alheia e de
// bot; (2) badge soma não lidas com painel fechado e zera ao abrir, com blip
// coalescido por lote no contrato de volume (ADR-0007); (3) painel aberto
// bloqueia cliques/teclas da cena, ao fechar o controle volta e o jogo segue
// rolando; (4) cooldown local pós-rate-limit com feedback enxuto e envio sem
// conexão fora da fila de pendentes; (5) aria-live/role status e drawer no
// viewport compacto.

// TZ fixa da suíte: a hora HH:MM usa o fuso local do navegador (getHours);
// os ISOs de teste são UTC e o worker deste arquivo roda com TZ=UTC para a
// asserção nunca depender da máquina que executa.
process.env.TZ = 'UTC'

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { registrosDeBlipDoChat } from './helpers/mockAudio'
import { VOLUME_BASE_SOM_DE_BLIP_DO_CHAT } from '../web/src/components/partida/somDeBlipDoChat'
import { VOLUME_PADRAO_DA_CAMADA } from '../web/src/components/partida/volumesDasCamadas'
import { HEX_COR_PEAO } from '../web/src/game/tabuleiro/contrato'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

const JOGADORES_BASE: EstadoDaPartidaSnapshot['jogadores'] = [
  { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
]

function criarSnapshotBase(overrides: Partial<EstadoDaPartidaSnapshot> = {}): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
      ],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: JOGADORES_BASE,
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...overrides,
  } as EstadoDaPartidaSnapshot
}

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

async function partidaDisponivel(): Promise<MockWebSocket> {
  renderPartidaNaRota('/partida?serverId=s&partidaId=p')
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

async function partidaComSnapshot(snapshot: EstadoDaPartidaSnapshot): Promise<MockWebSocket> {
  const ws = await partidaDisponivel()
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))
  await screen.findByTestId('hud-da-partida')
  return ws
}

function mensagemDeChat(jogadorId: string, apelido: string, conteudo: string, enviadoEm: string) {
  return { type: 'MENSAGEM_DE_CHAT_DA_PARTIDA', jogadorId, apelido, conteudo, enviadoEm }
}

let viewportOriginalLargura = 0
let viewportOriginalAltura = 0
function mockViewport(largura: number, altura: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: largura })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: altura })
  window.dispatchEvent(new Event('resize'))
}
function salvarViewport(): void {
  viewportOriginalLargura = window.innerWidth
  viewportOriginalAltura = window.innerHeight
}
function restaurarViewport(): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: viewportOriginalLargura })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: viewportOriginalAltura })
}

afterEach(() => {
  MockWebSocket.clean()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Chat da Partida — mensagem própria, alheia e de bot (issue #389 [1])', () => {
  it('renderiza apelido na cor do peão, avatar e hora HH:MM; própria ganha destaque sem badge', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))

    act(() => {
      // Própria (sessão): não conta como não lida e não dispara blip.
      ws.simulateMessage(mensagemDeChat(MEU_JOGADOR_ID, 'JogadorTeste', 'ola pessoal', '2026-09-14T14:05:00Z'))
      // Alheia humana (Ana) e alheia de bot (Beto): mesmo evento/leiaute.
      ws.simulateMessage(mensagemDeChat('jogador-2', 'Ana', 'bom turno', '2026-09-14T14:06:00Z'))
      ws.simulateMessage(mensagemDeChat('jogador-3', 'Beto', 'vou para o gerador 1', '2026-09-14T14:07:00Z'))
    })

    const mensagens = screen.getAllByTestId('chat-mensagem')
    expect(mensagens).toHaveLength(3)

    // Própria: identidade da sessão + destaque âmbar (sem badge em aberto).
    expect(mensagens[0]).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    expect(mensagens[0]).toHaveAttribute('data-propria', 'true')
    expect(within(mensagens[0]).getByText('JogadorTeste')).toHaveStyle({ color: HEX_COR_PEAO.branco })
    expect(within(mensagens[0]).getByText('14:05')).toBeInTheDocument()

    // Humana e de bot renderizadas igual: apelido na cor do peão do roster.
    expect(mensagens[1]).toHaveAttribute('data-jogador-id', 'jogador-2')
    expect(mensagens[1]).toHaveAttribute('data-propria', 'false')
    expect(within(mensagens[1]).getByText('Ana')).toHaveStyle({ color: HEX_COR_PEAO.vermelho })
    expect(within(mensagens[1]).getByText('AN')).toBeInTheDocument()
    expect(within(mensagens[1]).getByText('14:06')).toBeInTheDocument()

    expect(mensagens[2]).toHaveAttribute('data-jogador-id', 'jogador-3')
    expect(mensagens[2]).toHaveAttribute('data-propria', 'false')
    expect(within(mensagens[2]).getByText('Beto')).toHaveStyle({ color: HEX_COR_PEAO.azul })
    expect(within(mensagens[2]).getByText('BE')).toBeInTheDocument()
    expect(within(mensagens[2]).getByText('14:07')).toBeInTheDocument()

    // Mensagens de terceiros com o painel aberto não viram não lidas.
    expect(screen.queryByTestId('chat-badge')).not.toBeInTheDocument()
  })

  it('id fora do roster cai em branco sem quebrar; destaque âmbar é só sessão local', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))

    act(() => {
      ws.simulateMessage(mensagemDeChat('jogador-fantasma', 'Ghost', 'boo', '2026-09-14T14:08:00Z'))
    })

    const mensagens = screen.getAllByTestId('chat-mensagem')
    expect(mensagens).toHaveLength(1)
    expect(mensagens[0]).toHaveAttribute('data-jogador-id', 'jogador-fantasma')
    expect(mensagens[0]).toHaveAttribute('data-propria', 'false')
    expect(within(mensagens[0]).getByText('Ghost')).toHaveStyle({ color: HEX_COR_PEAO.branco })
  })
})

describe('Chat da Partida — badge e blip (issue #389 [2])', () => {
  it('badge soma as não lidas com o painel fechado, zera ao abrir, e o blip coalesce por lote no contrato de volume', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    // Rajada com o painel fechado: 3 mensagens dentro da janela de 250ms.
    act(() => {
      relogio.mockReturnValue(1_000_000)
      ws.simulateMessage(mensagemDeChat('jogador-2', 'Ana', 'um', '2026-09-14T14:05:00Z'))
    })
    expect(screen.getByTestId('chat-badge')).toHaveTextContent('1')
    expect(screen.getByTestId('chat-badge')).toHaveAttribute('role', 'status')
    act(() => {
      relogio.mockReturnValue(1_000_100)
      ws.simulateMessage(mensagemDeChat('jogador-3', 'Beto', 'dois', '2026-09-14T14:05:01Z'))
      relogio.mockReturnValue(1_000_200)
      ws.simulateMessage(mensagemDeChat('jogador-4', 'Cara', 'tres', '2026-09-14T14:05:02Z'))
    })
    expect(screen.getByTestId('chat-badge')).toHaveTextContent('3')
    // Fora da janela: nova rajada ganha o 2º blip.
    act(() => {
      relogio.mockReturnValue(1_000_400)
      ws.simulateMessage(mensagemDeChat('jogador-2', 'Ana', 'quatro', '2026-09-14T14:05:04Z'))
    })
    expect(screen.getByTestId('chat-badge')).toHaveTextContent('4')

    // Contrato de volume (ADR-0007 + issue #438): ganho = camada de efeitos
    // × VOLUME_BASE (camada padrão 1 sem valor persistido).
    expect(registrosDeBlipDoChat).toHaveLength(2)
    expect(registrosDeBlipDoChat[0]?.ganho).toBe(VOLUME_PADRAO_DA_CAMADA * VOLUME_BASE_SOM_DE_BLIP_DO_CHAT)

    // Abrir zera o badge; fechar e receber nova mensagem reacende com 1.
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.queryByTestId('chat-badge')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('chat-botao'))
    act(() => ws.simulateMessage(mensagemDeChat('jogador-3', 'Beto', 'cinco', '2026-09-14T14:05:05Z')))
    expect(screen.getByTestId('chat-badge')).toHaveTextContent('1')
  })
})

describe('Chat da Partida — block da cena (issue #389 [3])', () => {
  it('com o painel aberto, clique cai no backdrop e teclas não operam a cena; ao fechar o controle volta; o jogo segue rolando', async () => {
    const snapshotComManipulacao = () =>
      criarSnapshotBase({
        tabuleiro: { ...criarSnapshotBase().tabuleiro, pecaEmManipulacaoId: 'peca-em-manipulacao' },
      })
    const ws = await partidaComSnapshot(snapshotComManipulacao())

    // Painel fechado: o teclado opera a cena (R gira a peça em manipulação).
    const antes = ws.sentMessages.length
    fireEvent.keyDown(window, { key: 'r' })
    expect(ws.sentMessages.length).toBe(antes + 1)
    expect(JSON.parse(ws.sentMessages[antes]!)).toMatchObject({ type: 'GIRAR_PECA', pecaId: 'peca-em-manipulacao', sentido: 'horario' })

    // Painel aberto: backdrop cobre a cena e teclas da cena são ignoradas.
    // No integral o backdrop segue modal (z-40, acima do HUD z-30).
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-backdrop')).toHaveAttribute('data-compacto', 'false')
    expect(screen.getByTestId('chat-backdrop').className).toContain('z-40')
    const comAberto = ws.sentMessages.length
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: 'E' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(ws.sentMessages.length).toBe(comAberto)

    // Escape fecha e devolve o controle à cena (antes da virada de turno,
    // que limpa a manipulação no reducer — TURNO_INICIADO zera
    // pecaEmManipulacaoId e o R pós-turno não teria alvo).
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('chat-painel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-backdrop')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'r' })
    expect(ws.sentMessages.length).toBe(comAberto + 1)

    // Click no backdrop também fecha e devolve o controle.
    await userEvent.click(screen.getByTestId('chat-botao'))
    fireEvent.click(screen.getByTestId('chat-backdrop'))
    expect(screen.queryByTestId('chat-painel')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'r' })
    expect(ws.sentMessages.length).toBe(comAberto + 2)

    // O jogo segue rolando: turno alheio atualiza o HUD com o painel aberto.
    await userEvent.click(screen.getByTestId('chat-botao'))
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await waitFor(() =>
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2'),
    )
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
  })

  it('cena fica inert com o painel aberto em andamento; fecha libera, Resultado nunca trava', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())

    // Fechado: cena livre.
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')

    // Aberto em andamento: cena + turnos inert, chat fora do wrapper segue vivo.
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.getByTestId('cena-interativa')).toHaveAttribute('inert')
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()

    // Fechar libera.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('chat-painel')).not.toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')

    // Resultado: mesmo aberto, sem inert (overlay precisa seguir clicável).
    await userEvent.click(screen.getByTestId('chat-botao'))
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
    expect(screen.queryByTestId('chat-backdrop')).not.toBeInTheDocument()
  })
})

describe('Chat da Partida — cooldown local e envio sem conexão (issue #389 [4])', () => {
  it('rate-limit do servidor congela o input com feedback enxuto e reabilita na janela', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))

    const input = screen.getByTestId('chat-input')
    expect(screen.getByTestId('chat-contador')).toHaveTextContent('0/300')
    await userEvent.type(input, 'ola tudo bem')
    expect(screen.getByTestId('chat-contador')).toHaveTextContent('12/300')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    const ultimo = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]!)
    expect(ultimo).toEqual({ type: 'ENVIAR_MENSAGEM_DE_CHAT', jogadorId: MEU_JOGADOR_ID, conteudo: 'ola tudo bem' })

    // Servidor é a autoridade: a recusa LIMITE_DE_MENSAGENS inicia o cooldown.
    vi.useFakeTimers()
    act(() =>
      ws.simulateMessage({ type: 'ERRO_DO_TABULEIRO', codigo: 'LIMITE_DE_MENSAGENS', mensagem: 'aguarde' }),
    )
    expect(screen.getByTestId('chat-input')).toBeDisabled()
    expect(screen.getByTestId('chat-recusa')).toHaveTextContent(/Muitas mensagens em pouco tempo/i)
    const botaoEnviar = screen.getByRole('button', { name: 'Enviar mensagem' })
    expect(botaoEnviar).toBeDisabled()

    // A janela (2s + margem) expira e o input volta a aceitar envio.
    act(() => vi.advanceTimersByTime(2100))
    expect(screen.getByTestId('chat-input')).not.toBeDisabled()
  })

  it('envio sem conexão falha localmente e não entra na fila de pendentes', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    const input = screen.getByTestId('chat-input')
    await userEvent.type(input, 'opa')

    // Queda do canal: `estaConectado()` passa a false (reconexão agendada).
    // fireEvent (não userEvent) sob fake timers — userEvent trava com o
    // relógio mockado.
    vi.useFakeTimers()
    act(() => ws.simulateClose(1005))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))
    expect(screen.getByTestId('chat-recusa')).toHaveTextContent(/Sem conexão com o servidor/i)
    expect(ws.sentMessages.join(' ')).not.toMatch(/ENVIAR_MENSAGEM_DE_CHAT/)

    // Reconexão após 1s: o drain do open NÃO carrega o comando do chat.
    act(() => vi.advanceTimersByTime(1100))
    vi.useRealTimers()
    await waitFor(() => expect(MockWebSocket.last()).not.toBe(ws))
    const novoWs = MockWebSocket.last()!
    expect(novoWs.sentMessages.join(' ')).not.toMatch(/ENVIAR_MENSAGEM_DE_CHAT/)
  })
})

describe('Chat da Partida — acessibilidade e drawer (issue #389 [5])', () => {
  it('mensagens novas e recusas anunciadas via aria-live; badge com role status', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())

    // Mensagem nova com o painel fechado: anúncio sr-only + badge status.
    act(() => ws.simulateMessage(mensagemDeChat('jogador-2', 'Ana', 'salve', '2026-09-14T14:05:00Z')))
    const anuncio = screen.getByTestId('chat-anuncio')
    expect(anuncio).toHaveAttribute('role', 'status')
    expect(anuncio).toHaveAttribute('aria-live', 'polite')
    expect(anuncio).toHaveAttribute('aria-atomic', 'true')
    expect(anuncio).toHaveAttribute('data-jogador-id', 'jogador-2')
    expect(anuncio).toHaveTextContent('Ana: salve')
    expect(screen.getByTestId('chat-badge')).toHaveAttribute('role', 'status')

    // Recusa de chat: feedback enxuto com role status.
    await userEvent.click(screen.getByTestId('chat-botao'))
    act(() => ws.simulateMessage({ type: 'ERRO_DO_TABULEIRO', codigo: 'MENSAGEM_VAZIA', mensagem: 'vazia' }))
    const recusa = screen.getByTestId('chat-recusa')
    expect(recusa).toHaveAttribute('role', 'status')
    expect(recusa).toHaveTextContent(/Escreva uma mensagem antes de enviar/i)
  })

  it('painel vira drawer no viewport compacto sem cobrir o HUD essencial', async () => {
    salvarViewport()
    mockViewport(800, 360)
    try {
      const base = criarSnapshotBase()
      const ws = await partidaComSnapshot(
        criarSnapshotBase({
          tabuleiro: { ...base.tabuleiro, pecaEmManipulacaoId: 'peca-em-manipulacao' },
        }),
      )
      expect(screen.getByTestId('chat-da-partida')).toHaveAttribute('data-compacto', 'true')

      await userEvent.click(screen.getByTestId('chat-botao'))
      expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
      // Drawer: ocupa a faixa entre o sistema sup-dir e o Turno inf-dir.
      expect(screen.getByTestId('chat-da-partida')).toHaveStyle({ display: 'flex' })
      expect(screen.getByTestId('chat-painel').className).toContain('flex-1')

      // Contrato de empilhamento (critério [5], review #401): no compacto o
      // backdrop fica ABAIXO do HUD (z-20 < z-30), acima só da cena (z-auto).
      // jsdom não faz hit-test visual — o teste fixa o contrato (classe +
      // data-*) e o comportamento observável: HUD clicável, cena bloqueada.
      const backdrop = screen.getByTestId('chat-backdrop')
      expect(backdrop).toHaveAttribute('data-compacto', 'true')
      expect(backdrop.className).toContain('z-20')

      // HUD essencial segue clicável com o painel aberto: SAIR abre a
      // confirmação por cima do drawer.
      await userEvent.click(screen.getByTestId('hud-sair'))
      expect(screen.getByTestId('hud-confirmacao-saida')).toBeInTheDocument()
      await userEvent.click(screen.getByTestId('hud-sair-cancelar'))
      expect(screen.queryByTestId('hud-confirmacao-saida')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-painel')).toBeInTheDocument()

      // Cena segue bloqueada no compacto: teclas não operam o jogo.
      const comAberto = ws.sentMessages.length
      fireEvent.keyDown(window, { key: 'r' })
      fireEvent.keyDown(window, { key: 'E' })
      fireEvent.keyDown(window, { key: ' ' })
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(ws.sentMessages.length).toBe(comAberto)

      // Escape fecha e devolve o controle à cena.
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByTestId('chat-painel')).not.toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'r' })
      expect(ws.sentMessages.length).toBe(comAberto + 1)
    } finally {
      restaurarViewport()
    }
  })
})

describe('Chat da Partida — pós-Resultado e histórico (issues #389/#390/#388)', () => {
  it('chat segue vivo após o Resultado: painel montado, recebe humana e de bot', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))

    // Termina a Partida — o painel NÃO desmonta (contrato #390).
    act(() =>
      ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }),
    )
    expect(screen.getByTestId('chat-da-partida')).toBeInTheDocument()
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()

    // Humana + bot de vitória chegam ao feed pós-Resultado.
    act(() => {
      ws.simulateMessage(mensagemDeChat('jogador-2', 'Ana', 'vencemos', '2026-09-14T14:10:00Z'))
      ws.simulateMessage(mensagemDeChat('jogador-3', 'Beto', 'o portão!', '2026-09-14T14:10:05Z'))
    })
    const mensagens = screen.getAllByTestId('chat-mensagem')
    expect(mensagens).toHaveLength(2)
    expect(screen.getByTestId('chat-feed')).toHaveAttribute('role', 'log')
  })

  it('snapshot com historicoDeChat hidrata o feed uma vez, sem duplicar o live', async () => {
    const historico = [
      { type: 'MENSAGEM_DE_CHAT_DA_PARTIDA', jogadorId: 'jogador-2', apelido: 'Ana', conteudo: 'oi', enviadoEm: '2026-09-14T14:00:00Z' },
      { type: 'MENSAGEM_DE_CHAT_DA_PARTIDA', jogadorId: 'jogador-3', apelido: 'Beto', conteudo: 'bora', enviadoEm: '2026-09-14T14:01:00Z' },
    ]
    const ws = await partidaComSnapshot(
      criarSnapshotBase({ historicoDeChat: historico } as Partial<EstadoDaPartidaSnapshot>),
    )
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.getAllByTestId('chat-mensagem')).toHaveLength(2)

    // Live posterior acrescenta, sem replay nem duplicada.
    act(() => ws.simulateMessage(mensagemDeChat('jogador-4', 'Cara', 'cheguei', '2026-09-14T14:02:00Z')))
    expect(screen.getAllByTestId('chat-mensagem')).toHaveLength(3)

    // Segundo snapshot com o mesmo histórico não duplica.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ historicoDeChat: historico } as Partial<EstadoDaPartidaSnapshot>),
      }),
    )
    expect(screen.getAllByTestId('chat-mensagem')).toHaveLength(3)
  })

  it('snapshot sem historicoDeChat (binário anterior ao #388) abre feed vazio', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.getByText('Sem mensagens ainda')).toBeInTheDocument()
  })
})

describe('Chat da Partida — Resultado sem backdrop (bloqueante 3)', () => {
  it('backdrop presente no andamento; PARTIDA_TERMINADA remove o backdrop e libera o overlay, Escape fecha sempre', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-backdrop')).toBeInTheDocument()

    // Termina a Partida com o painel aberto: sem backdrop, overlay alcançável.
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    expect(screen.getByTestId('chat-da-partida')).toBeInTheDocument()
    expect(screen.getByTestId('chat-painel')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-backdrop')).not.toBeInTheDocument()
    expect(screen.getByTestId('overlay-resultado')).toBeInTheDocument()
    expect(screen.getByTestId('voltar-a-sala')).toBeInTheDocument()

    // Escape continua fechando no Resultado (atalho, não bloqueio).
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('chat-painel')).not.toBeInTheDocument()
  })
})

describe('Chat da Partida — validação local e foco (issue #389 ajustes)', () => {
  it('envio vazio e longo falham localmente sem ir ao socket', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    const enviadosAntes = ws.sentMessages.length

    // Rascunho vazio: botão desabilitado, nada vai ao socket.
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled()
    expect(ws.sentMessages.length).toBe(enviadosAntes)

    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'x'.repeat(301) } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))
    expect(screen.getByTestId('chat-recusa')).toHaveTextContent(/longa demais/i)
    expect(ws.sentMessages.length).toBe(enviadosAntes)
  })

  it('abrir move o foco ao input; fechar devolve ao botão', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    const botao = screen.getByTestId('chat-botao')
    await userEvent.click(botao)
    expect(screen.getByTestId('chat-input')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(botao).toHaveFocus()
  })

  it('Tab circula só dentro do painel aberto (trap de foco)', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    // Habilita o enviar para entrar na ordem de tab.
    await userEvent.type(screen.getByTestId('chat-input'), 'oi')
    expect(screen.getByTestId('chat-input')).toHaveFocus()
    // Ordem no DOM: botão do chat, input, botão enviar.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByTestId('chat-botao')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toHaveFocus()
  })
})

describe('Chat da Partida — desistente fora do roster (R1)', () => {
  it('JOGADOR_NAO_NA_PARTIDA sem reenvio pendente vira feedback do painel', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await userEvent.click(screen.getByTestId('chat-botao'))
    act(() =>
      ws.simulateMessage({ type: 'ERRO_DO_TABULEIRO', codigo: 'JOGADOR_NAO_NA_PARTIDA', mensagem: 'fora' }),
    )
    expect(screen.getByTestId('chat-recusa')).toHaveTextContent(/não está conectada à partida/i)
  })
})