import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { HudDaPartida } from '../web/src/components/partida/HudDaPartida'
import type { PercepcaoDeJogador } from '../web/src/game/tabuleiro/reducao'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

// HUD base da Partida sem Proteção (issue #226, spec pai #224): suíte de
// comportamento externo com snapshot mockado injetado via MockWebSocket —
// sem partida real. Cobre os 9 critérios de aceitação da issue.
//
// Breakpoint mínimo suportado: 768px (tablet) — documentado na
// implementação (`HudDaPartida.tsx`): em desktop/notebook/tablet o HUD só
// reduz a escala (`scale-90` → `scale-100` em `lg`), sem reorganizar as 6
// regiões nem ocultar conteúdo.

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

const JOGADORES_BASE: EstadoDaPartidaSnapshot['jogadores'] = [
  { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
  { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
  { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
  { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
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

function renderViaApp(entry: string, authState: AuthState = mockAuthenticatedState) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] })
  return render(
    <AuthProvider initialState={authState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

function mockSalaContext(codigo: string | null): UseSalaWebSocketReturn {
  const sala = codigo
    ? ({
        id: 'sala-1',
        codigoDeSala: codigo,
        estado: 'aberta' as const,
        anfitriaoId: 'm1',
        membros: [],
        convite: { codigoDeSala: codigo, link: `http://localhost/sala/${codigo}` },
      } as unknown as UseSalaWebSocketReturn['sala'])
    : null
  return {
    sala,
    avisos: [],
    mensagensDeChat: [],
    jogadoresBloqueados: [],
    conectado: true,
    erro: null,
    encaminhamento: { fase: 'ocioso', alvo: null, codigo: null, motivo: null, mensagem: null },
    limparAvisoDeEncaminhamento: () => {},
    enviar: () => {},
    criarSala: () => {},
    entrarNaSala: () => {},
    alternarProntidao: () => {},
    sairDaSala: () => {},
    enviarMensagemDeChat: () => {},
    expulsarMembro: () => {},
    desbloquearJogador: () => {},
    encerrarSala: () => {},
    iniciarPartida: () => {},
    expulso: false,
    descartarExpulsao: () => {},
  }
}

function renderPartidaParaSaida(codigoSala: string | null) {
  const mockCtx = mockSalaContext(codigoSala)
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/sala/:codigoDeSala', element: <div data-testid="sala-pagina">sala</div> },
      { path: '/salas/criar', element: <div data-testid="criar-pagina">criar</div> },
    ],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <SalaWebSocketContext.Provider value={mockCtx as unknown as UseSalaWebSocketReturn}>
        <RouterProvider router={router} />
      </SalaWebSocketContext.Provider>
    </AuthProvider>,
  )
}

async function partidaDisponivel() {
  // Render direto da PartidaPage (sem o App): o SalaWebSocketProvider do App
  // abriria um socket extra de sala e o `MockWebSocket.last()` deixaria de
  // ser o canal da partida. O contexto de sala mockado isola o teste no
  // canal da partida — mesmo padrão de partida-resultado.test.tsx.
  renderPartidaParaSaida(null)
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

async function partidaComSnapshot(snapshot: EstadoDaPartidaSnapshot) {
  const ws = await partidaDisponivel()
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))
  await screen.findByTestId('hud-da-partida')
  return ws
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

afterEach(() => {
  MockWebSocket.clean()
  vi.useRealTimers()
})

describe('HUD da Partida — tela cheia sem cabeçalho (#226 [1])', () => {
  it('rota /partida não renderiza o header do site; PartidaPage ocupa 100vh/100vw', () => {
    renderViaApp('/partida')
    expect(document.querySelector('.site-header')).toBeNull()
    expect(document.querySelector('header.site-header')).toBeNull()
    const raiz = screen.getByTestId('ambiente-de-jogo').parentElement!
    expect(raiz).toHaveClass('h-screen')
    expect(raiz).toHaveClass('w-screen')
    expect(raiz).toHaveClass('overflow-hidden')
  })

  it('rotas fora da partida mantêm o header', () => {
    renderViaApp('/', visitorState)
    expect(document.querySelector('.site-header')).not.toBeNull()
  })
})

describe('HUD da Partida — 6 regiões do modelo real (#226 [2])', () => {
  it('sem snapshot o HUD fica oculto (sem dados inventados)', async () => {
    await partidaDisponivel()
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-conquistas')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-turno')).not.toBeInTheDocument()
  })

  it('com snapshot as 6 regiões renderizam: adversários, título, controles, local, conquistas e turno', async () => {
    await partidaComSnapshot(criarSnapshotBase())

    // sup-esq: os 3 outros jogadores em avatares circulares.
    const avatares = screen.getAllByTestId('hud-avatar-adversario')
    expect(avatares).toHaveLength(3)
    expect(avatares.map((el) => el.getAttribute('data-jogador-id'))).toEqual([
      'jogador-2',
      'jogador-3',
      'jogador-4',
    ])
    // sup-centro: título.
    expect(screen.getByTestId('hud-titulo')).toHaveTextContent(/flicker of sanity/i)
    // sup-dir: cronômetro + volume visual + SAIR.
    expect(screen.getByTestId('hud-cronometro')).toBeInTheDocument()
    expect(screen.getByTestId('hud-volume')).toBeInTheDocument()
    expect(screen.getByTestId('hud-sair')).toBeInTheDocument()
    // inf-esq: jogador local (autenticado).
    expect(screen.getByTestId('hud-jogador-local')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    // inf-centro: 3 conquistas de gerador + 1 de cartão.
    expect(screen.getAllByTestId('hud-conquista-gerador')).toHaveLength(3)
    expect(screen.getByTestId('hud-conquista-cartao')).toBeInTheDocument()
    // inf-dir: turno com ativo + 3 próximos.
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    expect(screen.getAllByTestId('hud-turno-proximo')).toHaveLength(3)
    // Vez do jogador local (snapshot base): anel da vez visível.
    expect(screen.getByTestId('hud-anel-da-vez')).toBeInTheDocument()
  })
})

describe('HUD da Partida — Sanidade e estados (#226 [3])', () => {
  it('barra local 0–3 reflete o modelo; bordas dos adversários e cards alternam ativo/apagado', async () => {
    await partidaComSnapshot(
      criarSnapshotBase({
        jogadores: [
          { ...JOGADORES_BASE[0], sanidade: 1, emBaixaIluminacao: true, amedrontado: false },
          { ...JOGADORES_BASE[1], sanidade: 0, emBaixaIluminacao: false, amedrontado: true },
          { ...JOGADORES_BASE[2], sanidade: 2, emBaixaIluminacao: false, amedrontado: false },
          { ...JOGADORES_BASE[3], sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
        ],
        jogadorAtivoId: 'jogador-2',
      }),
    )

    // Barra local: sanidade 1 → 1 segmento preenchido de 3.
    expect(screen.getByTestId('hud-sanidade')).toHaveAttribute('data-sanidade', '1')
    expect(
      screen.getAllByTestId('hud-sanidade-segmento').filter((el) => el.getAttribute('data-preenchido') === 'true'),
    ).toHaveLength(1)
    // Cards locais: Baixa Iluminação ativa, Amedrontado apagado.
    expect(screen.getByTestId('hud-card-baixa-iluminacao')).toHaveAttribute('data-ativo', 'true')
    expect(screen.getByTestId('hud-card-baixa-iluminacao')).toHaveAttribute(
      'aria-label',
      'Baixa Iluminação ativa',
    )
    expect(screen.getByTestId('hud-card-amedrontado')).toHaveAttribute('data-ativo', 'false')
    expect(screen.getByTestId('hud-card-amedrontado')).toHaveAttribute('aria-label', 'Amedrontado inativo')
    // Leitura visual de ativo/apagado: mesma largura máxima, borda e fundo próprios.
    const cardBaixa = screen.getByTestId('hud-card-baixa-iluminacao')
    const cardAmedrontado = screen.getByTestId('hud-card-amedrontado')
    for (const card of [cardBaixa, cardAmedrontado]) {
      expect(card).toHaveClass('w-24')
      expect(card).toHaveClass('max-w-[6rem]')
    }
    expect(cardBaixa).toHaveClass('border-amber-400/70')
    expect(cardBaixa).toHaveClass('bg-amber-400/10')
    expect(cardAmedrontado).toHaveClass('border-zinc-700/60')
    expect(cardAmedrontado).toHaveClass('bg-zinc-950/70')
    // Adversários: Ana zerada e amedrontada, Beto com 2.
    const avatarAna = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-2')!
    expect(avatarAna).toHaveAttribute('data-sanidade', '0')
    expect(avatarAna).toHaveAttribute('data-amedrontado', 'true')
    expect(avatarAna).toHaveAttribute('data-ativo', 'true')
    const avatarBeto = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-3')!
    expect(avatarBeto).toHaveAttribute('data-sanidade', '2')
    expect(avatarBeto).not.toHaveAttribute('data-amedrontado')
  })

  it('anel circular de cada adversário tem 3 arcos; acesos == Sanidade e reagem ao dano', async () => {
    const ws = await partidaDisponivel()
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          jogadores: [
            JOGADORES_BASE[0],
            { ...JOGADORES_BASE[1], sanidade: 2 },
            { ...JOGADORES_BASE[2], sanidade: 3 },
            { ...JOGADORES_BASE[3], sanidade: 0 },
          ],
        }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    const aneis = screen.getAllByTestId('hud-anel-sanidade')
    expect(aneis).toHaveLength(3)
    for (const anel of aneis) {
      const segmentos = screen
        .getAllByTestId('hud-anel-sanidade-segmento')
        .filter((el) => el.getAttribute('data-jogador-id') === anel.getAttribute('data-jogador-id'))
      expect(segmentos).toHaveLength(3)
      const acesos = segmentos.filter((el) => el.getAttribute('data-preenchido') === 'true')
      expect(acesos).toHaveLength(Number(anel.getAttribute('data-sanidade')))
    }

    // Ana sofre dano (2 → 0): o anel apaga os 3 arcos.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          jogadores: [
            JOGADORES_BASE[0],
            { ...JOGADORES_BASE[1], sanidade: 0, amedrontado: true },
            JOGADORES_BASE[2],
            JOGADORES_BASE[3],
          ],
        }),
      }),
    )
    await waitFor(() => {
      const anel = screen
        .getAllByTestId('hud-anel-sanidade')
        .find((el) => el.getAttribute('data-jogador-id') === 'jogador-2')!
      expect(anel).toHaveAttribute('data-sanidade', '0')
    })
    const anelAna = screen
      .getAllByTestId('hud-anel-sanidade')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-2')!
    expect(anelAna).toHaveAttribute('data-sanidade', '0')
    expect(
      screen
        .getAllByTestId('hud-anel-sanidade-segmento')
        .filter(
          (el) =>
            el.getAttribute('data-jogador-id') === 'jogador-2' &&
            el.getAttribute('data-preenchido') === 'true',
        ),
    ).toHaveLength(0)
  })
})

describe('HUD da Partida — Turno em ordem fixa de entrada (#226 [4])', () => {
  it('slots fixos na ordem de entrada; só o anel da vez transita', async () => {
    const ws = await partidaDisponivel()
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ jogadorAtivoId: 'jogador-3' }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    const ordemDosSlots = () =>
      within(screen.getByTestId('hud-turno'))
        .getAllByRole('img')
        .map((el) => el.getAttribute('data-jogador-id'))
    // Slots fixos 1→2→3→4; anel no Beto.
    expect(ordemDosSlots()).toEqual([MEU_JOGADOR_ID, 'jogador-2', 'jogador-3', 'jogador-4'])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-3')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('aria-label', 'Vez de Beto')

    // A vez passa para o Cara: ninguém muda de lugar, só o anel transita.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ jogadorAtivoId: 'jogador-4' }),
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-4'),
    )
    expect(ordemDosSlots()).toEqual([MEU_JOGADOR_ID, 'jogador-2', 'jogador-3', 'jogador-4'])
    expect(screen.getByTestId('hud-turno-anel-da-vez').parentElement).toContainElement(
      screen.getByTestId('hud-turno-ativo'),
    )
  })
})

describe('HUD da Partida — conquistas redondas (#226 [5])', () => {
  it('4 conquistas apagadas por padrão; cada gerador acende 1; cartão acende quando obtido', async () => {
    const ws = await partidaDisponivel()
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    await screen.findByTestId('hud-da-partida')
    expect(
      screen.getAllByTestId('hud-conquista-gerador').filter((el) => el.getAttribute('data-acesa') === 'true'),
    ).toHaveLength(0)
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'false')

    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          geradoresLigados: ['gerador-1', 'gerador-2'],
          cartaoDeAcessoObtido: true,
        }),
      }),
    )
    await waitFor(() =>
      expect(
        screen.getAllByTestId('hud-conquista-gerador').filter((el) => el.getAttribute('data-acesa') === 'true'),
      ).toHaveLength(2),
    )
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'true')
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('aria-label', 'Cartão de Acesso obtido')
  })
})

describe('HUD da Partida — cronômetro, SAIR e resultado (#226 [6])', () => {
  const JOGADORES_HUD: Record<string, PercepcaoDeJogador> = {
    [MEU_JOGADOR_ID]: { apelido: 'JogadorTeste', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 1 },
    ['jogador-2']: { apelido: 'Ana', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 2 },
  }

  function renderHudUnitario(props: { emAndamento: boolean; emResultado: boolean }) {
    return render(
      <HudDaPartida
        jogadorPorId={JOGADORES_HUD}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento={props.emAndamento}
        emResultado={props.emResultado}
        onSair={() => {}}
      />,
    )
  }

  it('cronômetro conta MM:SS em andamento e congela no resultado', () => {
    vi.useFakeTimers()
    const { rerender } = renderHudUnitario({ emAndamento: true, emResultado: false })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('00:00')

    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    expect(screen.getByTestId('hud-cronometro')).toHaveAttribute('data-segundos', '65')

    rerender(
      <HudDaPartida
        jogadorPorId={JOGADORES_HUD}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado
        onSair={() => {}}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    vi.useRealTimers()
  })

  it('retoma ao sair e voltar na mesma aba (paliativo sessionStorage por partidaId)', () => {
    window.sessionStorage.clear()
    vi.useFakeTimers()
    const base = {
      jogadorPorId: JOGADORES_HUD,
      jogadorAtivoId: MEU_JOGADOR_ID,
      jogadorLocalId: MEU_JOGADOR_ID,
      geradoresLigados: [] as string[],
      cartaoDeAcessoObtido: false,
      onSair: () => {},
    }
    const { unmount } = render(<HudDaPartida {...base} partidaId="partida-timer-a" emAndamento emResultado={false} />)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')

    // Sair desmonta; voltar remonta a mesma partida e retoma.
    unmount()
    render(<HudDaPartida {...base} partidaId="partida-timer-a" emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:15')
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('avatar exibe foto quando há URL e iniciais como fallback', () => {
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={JOGADORES_HUD}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{ [MEU_JOGADOR_ID]: 'https://exemplo.test/eu.png' }}
        onSair={() => {}}
      />,
    )
    const retrato = screen.getByRole('img', { name: 'Retrato de JogadorTeste, com a vez' })
    expect(retrato.querySelector('img')).toHaveAttribute('src', 'https://exemplo.test/eu.png')
    expect(retrato).not.toHaveTextContent('JO')
    // Adversário sem URL mantém as iniciais.
    expect(screen.getAllByTestId('hud-avatar-adversario')[0]).toHaveTextContent('AN')
    unmount()
  })

  it('retrato local é redondo e o anel da vez pisca só no turno do jogador', () => {
    const base = {
      jogadorPorId: JOGADORES_HUD,
      jogadorAtivoId: MEU_JOGADOR_ID,
      jogadorLocalId: MEU_JOGADOR_ID,
      geradoresLigados: [] as string[],
      cartaoDeAcessoObtido: false,
      onSair: () => {},
    }
    const { unmount } = render(
      <HudDaPartida {...base} emAndamento emResultado={false} />,
    )
    expect(screen.getByTestId('hud-anel-da-vez')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Retrato de JogadorTeste, com a vez' })).toHaveClass(
      'rounded-full',
    )
    unmount()

    // Vez do adversário: sem anel, sem menção à vez.
    render(
      <HudDaPartida
        {...base}
        jogadorAtivoId="jogador-2"
        emAndamento
        emResultado={false}
      />,
    )
    expect(screen.queryByTestId('hud-anel-da-vez')).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Retrato de JogadorTeste' }),
    ).toBeInTheDocument()
  })

  it('partida distinta recomeça do zero', () => {
    window.sessionStorage.clear()
    vi.useFakeTimers()
    const base = {
      jogadorPorId: JOGADORES_HUD,
      jogadorAtivoId: MEU_JOGADOR_ID,
      jogadorLocalId: MEU_JOGADOR_ID,
      geradoresLigados: [] as string[],
      cartaoDeAcessoObtido: false,
      onSair: () => {},
    }
    const { unmount } = render(<HudDaPartida {...base} partidaId="partida-timer-b" emAndamento emResultado={false} />)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    unmount()

    render(<HudDaPartida {...base} partidaId="partida-timer-c" emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('00:00')
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('SAIR pede confirmação; confirmar volta à sala e encerra o WS', async () => {
    renderPartidaParaSaida('A3K9M2')
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
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    await screen.findByTestId('hud-da-partida')

    const user = userEvent.setup()
    // Sem confirmação, sem saída.
    await user.click(screen.getByTestId('hud-sair'))
    expect(screen.getByTestId('hud-confirmacao-saida')).toBeInTheDocument()
    await user.click(screen.getByTestId('hud-sair-cancelar'))
    expect(screen.queryByTestId('hud-confirmacao-saida')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-da-partida')).toBeInTheDocument()

    // Confirmar devolve à sala de origem e encerra o WS da partida.
    await user.click(screen.getByTestId('hud-sair'))
    const wsInst = MockWebSocket.last()!
    await user.click(screen.getByTestId('hud-sair-confirmar'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
    expect(wsInst.onclose).toBeNull()
  })

  it('overlay de resultado fica legível acima do HUD', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))

    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveTextContent('Vitória!')
    expect(overlay.className).toMatch(/z-40/)
    expect(screen.getByTestId('hud-da-partida').className).toMatch(/z-30/)
    // Timer congelado segue visível sob o overlay.
    expect(screen.getByTestId('hud-cronometro').textContent).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('HUD da Partida — sem provisórios, sem Proteção, com rótulos (#226 [7])', () => {
  it('chips antigos removidos; nenhum card de Proteção; vocabulário Baixa Iluminação', async () => {
    await partidaComSnapshot(criarSnapshotBase())

    for (const testid of [
      'indicador-rodada',
      'contagem-caixa',
      'chip-jogador-ativo',
      'chip-sanidade',
      'chip-baixa-iluminacao',
      'chip-amedrontado',
      'indicadores-sanidade',
      'indicador-sanidade-jogador',
      'chip-geradores-ligados',
      'chip-cartao-de-acesso',
    ]) {
      expect(screen.queryByTestId(testid)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/proteção/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/baixa visão/i)).not.toBeInTheDocument()
    expect(screen.getByText(/baixa iluminação/i)).toBeInTheDocument()
  })

  it('regiões e cards expõem rótulos acessíveis', async () => {
    await partidaComSnapshot(criarSnapshotBase())

    expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('aria-label', 'HUD da Partida')
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', expect.stringMatching(/^Tempo de partida:/))
    expect(screen.getByTestId('hud-volume')).toHaveAttribute('aria-label', 'Volume')
    expect(screen.queryByRole('button', { name: /volume/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-sanidade')).toHaveAttribute('aria-label', 'Sanidade 3 de 3')
    expect(screen.getByTestId('hud-turno')).toHaveAttribute('aria-label', 'Turno')
    expect(screen.getByTestId('hud-conquistas')).toHaveAttribute('aria-label', 'Conquistas')
    expect(screen.getByTestId('hud-outros-jogadores')).toHaveAttribute('aria-label', 'Outros jogadores')
  })
})

describe('HUD da Partida — responsividade até tablet (#226 [9])', () => {
  it.each([
    ['tablet (768px)', 768],
    ['notebook (1024px)', 1024],
    ['desktop (1280px)', 1280],
  ])('em %s as 6 regiões seguem presentes sem reorganizar nem ocultar', async (_label, width) => {
    setViewport(width)
    await partidaComSnapshot(criarSnapshotBase())

    expect(screen.getByTestId('hud-outros-jogadores')).toBeInTheDocument()
    expect(screen.getByTestId('hud-titulo')).toBeInTheDocument()
    expect(screen.getByTestId('hud-controles-partida')).toBeInTheDocument()
    expect(screen.getByTestId('hud-jogador-local')).toBeInTheDocument()
    expect(screen.getByTestId('hud-conquistas')).toBeInTheDocument()
    expect(screen.getByTestId('hud-turno')).toBeInTheDocument()
  })
})
