// Tutorial da Partida (issue #434): suíte de comportamento externo com
// snapshot mockado injetado via MockWebSocket (mesmos padrões de
// partida-chat, partida-hud e partida-modo-paisagem). Cobre as 15 histórias:
// (1/15) auto-abertura uma vez por aba; (2) navegação do carrossel;
// (3-8) slides com mídia e cobertura dos tópicos; (9) fechar minimiza;
// (10) reabertura pelo HUD; (11/12) block da cena + gate de teclado;
// (13) diálogo anunciado e região viva; (14) modo compacto.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { CHAVE_SESSAO_TUTORIAL_DA_PARTIDA } from '../web/src/components/partida/conteudoDoTutorialDaPartida'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

const JOGADORES_BASE: EstadoDaPartidaSnapshot['jogadores'] = [
  { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
]

const TITULOS_ESPERADOS = [
  'Posicione Peças de Caminho',
  'Mova seu Peão',
  'Peças Especiais: Gerador e Sala do Diretor',
  'Peças Especiais: Sala Médica e Portão de Saída',
  'Monstro: O Vulto',
  'Monstro: O Espectro',
  'Objetivo: vença ou perca em equipe',
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

/** Nova aba: sem a flag de sessão, a primeira Partida auto-abre o Tutorial. */
function simularNovaAba(): void {
  window.sessionStorage.removeItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA)
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

async function abrirTutorialPeloHud(): Promise<void> {
  await userEvent.click(screen.getByTestId('hud-tutorial'))
  await screen.findByTestId('tutorial-dialogo')
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

describe('Tutorial da Partida — auto-abertura uma vez por aba (issues #434 [1][15])', () => {
  it('abre sozinho na primeira Partida em andamento da aba e marca a sessão', async () => {
    simularNovaAba()
    await partidaComSnapshot(criarSnapshotBase())

    const dialogo = await screen.findByTestId('tutorial-dialogo')
    expect(dialogo).toHaveAttribute('role', 'dialog')
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(dialogo).toHaveAttribute('aria-label', 'Tutorial da Partida')
    expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[0]!)
    // Carrossel dentro do teto autorizado (5 da spec, até 10): 7 slides.
    const slide = screen.getByTestId('tutorial-slide')
    const total = Number(slide.getAttribute('data-total'))
    expect(total).toBeGreaterThanOrEqual(5)
    expect(total).toBeLessThanOrEqual(10)
    expect(slide).toHaveAttribute('data-indice', '0')
    expect(window.sessionStorage.getItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA)).not.toBeNull()
  })

  it('nunca abre no carregamento (antes da admissão)', async () => {
    simularNovaAba()
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-tutorial')).not.toBeInTheDocument()
  })

  it('segunda Partida na mesma aba já começa minimizada no botão do HUD', async () => {
    // Aba já atendida (default do setup): sem diálogo, com botão entre
    // volume e sair.
    await partidaComSnapshot(criarSnapshotBase())
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()

    const botao = screen.getByTestId('hud-tutorial')
    expect(botao).toHaveAttribute('aria-label', 'Abrir tutorial')
    const controles = screen.getByTestId('hud-controles-partida')
    const ordem = [...controles.querySelectorAll('[data-testid]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    expect(ordem).toEqual(['hud-cronometro', 'hud-volume', 'hud-tutorial', 'hud-sair'])
  })
})

describe('Tutorial da Partida — carrossel com mídia (issues #434 [2][3][4][5][6][7][8])', () => {
  it('navega pelos 7 slides com setas, indicadores e Próximo; cada slide tem mídia com alt', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    await abrirTutorialPeloHud()

    expect(screen.getAllByTestId('tutorial-indicador')).toHaveLength(TITULOS_ESPERADOS.length)

    for (let i = 0; i < TITULOS_ESPERADOS.length; i++) {
      expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[i]!)
      const slide = screen.getByTestId('tutorial-slide')
      expect(slide).toHaveAttribute('data-indice', String(i))
      const midias = within(slide).getAllByTestId('tutorial-midia')
      expect(midias.length).toBeGreaterThanOrEqual(1)
      for (const midia of midias) {
        expect(midia.getAttribute('src')).toContain('/media/tutorial/')
        expect(midia.getAttribute('alt')?.trim().length).toBeGreaterThan(0)
      }
      // Região viva anuncia a troca (história 13).
      expect(slide).toHaveAttribute('aria-live', 'polite')
      expect(screen.getByTestId('tutorial-anuncio')).toHaveTextContent(
        `Slide ${i + 1} de ${TITULOS_ESPERADOS.length}`,
      )
      if (i < TITULOS_ESPERADOS.length - 1) {
        await userEvent.click(screen.getByTestId('tutorial-proximo'))
      }
    }

    // No último slide o Próximo vira saída; voltar e indicador funcionam.
    expect(screen.getByTestId('tutorial-proximo')).toHaveTextContent(/Começar a jogar/i)
    await userEvent.click(screen.getByTestId('tutorial-anterior'))
    expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[TITULOS_ESPERADOS.length - 2]!)
    await userEvent.click(screen.getByTestId('tutorial-proxima'))
    expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[TITULOS_ESPERADOS.length - 1]!)
    const indicadores = screen.getAllByTestId('tutorial-indicador')
    await userEvent.click(indicadores[0]!)
    expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[0]!)
  })
})

describe('Tutorial da Partida — minimizar e reabrir (issues #434 [9][10])', () => {
  it('X minimiza para o HUD e o botão reabre a qualquer momento', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    await abrirTutorialPeloHud()

    await userEvent.click(screen.getByTestId('tutorial-fechar'))
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tutorial-backdrop')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-tutorial')).toBeInTheDocument()

    await abrirTutorialPeloHud()
    expect(screen.getByTestId('tutorial-dialogo')).toBeInTheDocument()
  })

  it('clique no backdrop e Escape também minimizam', async () => {
    await partidaComSnapshot(criarSnapshotBase())
    await abrirTutorialPeloHud()

    fireEvent.click(screen.getByTestId('tutorial-backdrop'))
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()

    await abrirTutorialPeloHud()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-tutorial')).toBeInTheDocument()
  })
})

describe('Tutorial da Partida — block da cena (issues #434 [11][12])', () => {
  it('aberto, backdrop cobre a cena e teclas não operam o jogo; ao fechar o controle volta; o jogo segue rolando', async () => {
    const snapshotComManipulacao = () =>
      criarSnapshotBase({
        tabuleiro: { ...criarSnapshotBase().tabuleiro, pecaEmManipulacaoId: 'peca-em-manipulacao' },
      })
    const ws = await partidaComSnapshot(snapshotComManipulacao())

    // Fechado: o teclado opera a cena (R gira a peça em manipulação).
    const antes = ws.sentMessages.length
    fireEvent.keyDown(window, { key: 'r' })
    expect(ws.sentMessages.length).toBe(antes + 1)
    expect(JSON.parse(ws.sentMessages[antes]!)).toMatchObject({ type: 'GIRAR_PECA', pecaId: 'peca-em-manipulacao', sentido: 'horario' })

    // Aberto em andamento: backdrop modal + cena inert, teclas ignoradas.
    await abrirTutorialPeloHud()
    expect(screen.getByTestId('tutorial-backdrop')).toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).toHaveAttribute('inert')
    const comAberto = ws.sentMessages.length
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: 'E' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(ws.sentMessages.length).toBe(comAberto)

    // Escape minimiza e devolve o controle à cena.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
    fireEvent.keyDown(window, { key: 'r' })
    expect(ws.sentMessages.length).toBe(comAberto + 1)

    // O jogo segue rolando: turno alheio atualiza o HUD com o modal aberto.
    await abrirTutorialPeloHud()
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await waitFor(() =>
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2'),
    )
    expect(screen.getByTestId('tutorial-dialogo')).toBeInTheDocument()
  })
})

describe('Tutorial da Partida — Resultado sem backdrop (issue #434, bloqueante 3)', () => {
  it('PARTIDA_TERMINADA remove o backdrop e libera o overlay, Escape minimiza sempre', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    await abrirTutorialPeloHud()
    expect(screen.getByTestId('tutorial-backdrop')).toBeInTheDocument()

    // Termina a Partida com o modal aberto: sem backdrop, overlay alcançável.
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    expect(screen.getByTestId('tutorial-dialogo')).toBeInTheDocument()
    expect(screen.queryByTestId('tutorial-backdrop')).not.toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
    expect(screen.getByTestId('overlay-resultado')).toBeInTheDocument()
    expect(screen.getByTestId('voltar-a-sala')).toBeInTheDocument()

    // Escape continua minimizando no Resultado (atalho, não bloqueio).
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
  })
})

describe('Tutorial da Partida — modo compacto (issue #434 [14])', () => {
  it('modal utilizável no viewport paisagem-celular sem cobrir o HUD essencial', async () => {
    salvarViewport()
    mockViewport(800, 360)
    try {
      const base = criarSnapshotBase()
      const ws = await partidaComSnapshot(
        criarSnapshotBase({
          tabuleiro: { ...base.tabuleiro, pecaEmManipulacaoId: 'peca-em-manipulacao' },
        }),
      )
      expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('data-modo-compacto', 'true')

      await abrirTutorialPeloHud()
      expect(screen.getByTestId('tutorial-da-partida')).toHaveAttribute('data-compacto', 'true')
      expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[0]!)
      await userEvent.click(screen.getByTestId('tutorial-proximo'))
      expect(screen.getByTestId('tutorial-titulo')).toHaveTextContent(TITULOS_ESPERADOS[1]!)

      // HUD essencial segue clicável com o modal aberto: SAIR abre a
      // confirmação por cima do modal.
      await userEvent.click(screen.getByTestId('hud-sair'))
      expect(screen.getByTestId('hud-confirmacao-saida')).toBeInTheDocument()
      await userEvent.click(screen.getByTestId('hud-sair-cancelar'))
      expect(screen.queryByTestId('hud-confirmacao-saida')).not.toBeInTheDocument()
      expect(screen.getByTestId('tutorial-dialogo')).toBeInTheDocument()

      // Cena segue bloqueada no compacto: teclas não operam o jogo.
      const comAberto = ws.sentMessages.length
      fireEvent.keyDown(window, { key: 'r' })
      expect(ws.sentMessages.length).toBe(comAberto)
    } finally {
      restaurarViewport()
    }
  })
})
