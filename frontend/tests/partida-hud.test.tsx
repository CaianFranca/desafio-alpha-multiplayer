import { cleanup, render, screen, waitFor, act, within, fireEvent } from '@testing-library/react'
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
    marcarSaidaPropria: () => {},
  }
}

function renderPartidaParaSaida(codigoSala: string | null) {
  const mockCtx = mockSalaContext(codigoSala)
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/', element: <div data-testid="principal-pagina">principal</div> },
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
    const raiz = screen.getByTestId('conteudo-jogo').parentElement!
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

describe('HUD da Partida — Turno em fila circular a partir do ativo (#226 [4])', () => {
  it('fila circular: os slots giram iniciando no Jogador Ativo, na ordem de entrada', async () => {
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
    // A leitura começa no ativo (Beto) e segue a ordem de entrada com wrap.
    expect(ordemDosSlots()).toEqual(['jogador-3', 'jogador-4', MEU_JOGADOR_ID, 'jogador-2'])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-3')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('aria-label', 'Vez de Beto')

    // A vez passa para o Cara: a fila rotaciona para abrir nele.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ jogadorAtivoId: 'jogador-4' }),
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-4'),
    )
    expect(ordemDosSlots()).toEqual(['jogador-4', MEU_JOGADOR_ID, 'jogador-2', 'jogador-3'])
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
    // Inativos translúcidos.
    for (const slot of [
      ...screen.getAllByTestId('hud-conquista-gerador'),
      screen.getByTestId('hud-conquista-cartao'),
    ]) {
      expect(slot).toHaveClass('opacity-40')
    }

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
    // Conquistas soltas: rótulo compartilhado, brilho de aceso e inativo translúcido.
    expect(screen.getByTestId('hud-conquistas')).toHaveTextContent('Geradores')
    expect(screen.getByTestId('hud-conquistas')).toHaveTextContent('Cartão')
    expect(screen.queryByTestId('hud-conquistas')).not.toHaveTextContent('Fuga')
    expect(
      screen.getAllByTestId('hud-conquista-gerador')[0],
    ).toHaveClass('border-amber-300')
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveClass('border-emerald-300')
  })

  it('gerador duplicado no array não acende conquista em dobro (dedupe de IDs)', async () => {
    const ws = await partidaDisponivel()
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ geradoresLigados: ['gerador-1', 'gerador-1'] }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    await waitFor(() =>
      expect(
        screen.getAllByTestId('hud-conquista-gerador').filter((el) => el.getAttribute('data-acesa') === 'true'),
      ).toHaveLength(1),
    )
  })
})

describe('HUD da Partida — cronômetro, SAIR e resultado (#226 [6])', () => {
  const JOGADORES_HUD: Record<string, PercepcaoDeJogador> = {
    [MEU_JOGADOR_ID]: { apelido: 'JogadorTeste', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 1, protegido: false },
    ['jogador-2']: { apelido: 'Ana', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 2, protegido: false },
  }

  function propsBase(iniciadaEm: number | null = null) {
    return {
      jogadorPorId: JOGADORES_HUD,
      jogadorAtivoId: MEU_JOGADOR_ID,
      jogadorLocalId: MEU_JOGADOR_ID,
      geradoresLigados: [] as string[],
      cartaoDeAcessoObtido: false,
      iniciadaEm,
      onSair: () => {},
    }
  }

  // Marco fixo do servidor (epoch ms) para os testes com fake timers (#259).
  const T0 = new Date('2026-09-11T12:00:00.000Z').getTime()

  it('cronômetro conta a partir do marco do servidor (não do mount local)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('00:00')

    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    expect(screen.getByTestId('hud-cronometro')).toHaveAttribute('data-segundos', '65')
    vi.useRealTimers()
  })

  it('a partir de 1h o cronômetro passa a exibir H:MM:SS', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('00:00')

    act(() => {
      vi.advanceTimersByTime(3_600_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('1:00:00')
    expect(screen.getByTestId('hud-cronometro')).toHaveAttribute('data-segundos', '3600')
    vi.useRealTimers()
  })

  it('retoma ao remontar com o mesmo marco (sair e voltar/recarregar)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const { unmount } = render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')

    // Sair desmonta; voltar remonta a MESMA Partida (mesmo marco) e retoma.
    unmount()
    render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:15')
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

  it('foto do avatar aparece nos 3 pontos (retrato local, adversários, fila de turno) — issue #404', () => {
    const jogadores: Record<string, PercepcaoDeJogador> = {
      [MEU_JOGADOR_ID]: { apelido: 'JogadorTeste', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 1, protegido: false },
      ['jogador-2']: { apelido: 'Ana', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 2, protegido: false },
    }
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={jogadores}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{ [MEU_JOGADOR_ID]: 'https://exemplo.test/eu.png', ['jogador-2']: 'https://exemplo.test/ana.png' }}
        onSair={() => {}}
      />,
    )
    // Retrato local.
    expect(
      screen.getByRole('img', { name: 'Retrato de JogadorTeste, com a vez' }).querySelector('img'),
    ).toHaveAttribute('src', 'https://exemplo.test/eu.png')
    // Adversários (sup-esq).
    expect(screen.getByTestId('hud-avatar-adversario').querySelector('img')).toHaveAttribute(
      'src',
      'https://exemplo.test/ana.png',
    )
    // Fila de turno (inf-dir): ativo + próximo com foto.
    expect(screen.getByTestId('hud-turno-ativo').querySelector('img')).toHaveAttribute(
      'src',
      'https://exemplo.test/eu.png',
    )
    expect(screen.getByTestId('hud-turno-proximo').querySelector('img')).toHaveAttribute(
      'src',
      'https://exemplo.test/ana.png',
    )
    unmount()
  })

  it('erro de carregamento da foto volta às iniciais na cor do peão (issue #404)', () => {
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={JOGADORES_HUD}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{ [MEU_JOGADOR_ID]: 'https://exemplo.test/quebrada.png' }}
        onSair={() => {}}
      />,
    )
    const retrato = screen.getByRole('img', { name: 'Retrato de JogadorTeste, com a vez' })
    const img = retrato.querySelector('img')!
    expect(img).toHaveAttribute('src', 'https://exemplo.test/quebrada.png')
    fireEvent.error(img)
    expect(retrato.querySelector('img')).toBeNull()
    expect(retrato).toHaveTextContent('JO')
    unmount()
  })

  it('ordem canônica com 4 jogadores: cada foto segue a cor do peão (issue #404)', () => {
    const jogadores: Record<string, PercepcaoDeJogador> = {
      ['j1']: { apelido: 'Um', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 1, protegido: false },
      ['j2']: { apelido: 'Dois', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 2, protegido: false },
      ['j3']: { apelido: 'Tres', cor: 'azul', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 3, protegido: false },
      ['j4']: { apelido: 'Quatro', cor: 'amarelo', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 4, protegido: false },
    }
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={jogadores}
        jogadorAtivoId="j1"
        jogadorLocalId="j1"
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{
          ['j1']: '/base/assets/avatars/diretor.png',
          ['j2']: '/base/assets/avatars/enfermeira.png',
          ['j3']: '/base/assets/avatars/janitor.png',
          ['j4']: '/base/assets/avatars/paciente.png',
        }}
        onSair={() => {}}
      />,
    )
    // Retrato local = Diretor; adversários seguem a ordem de entrada.
    expect(
      screen.getByRole('img', { name: 'Retrato de Um, com a vez' }).querySelector('img'),
    ).toHaveAttribute('src', '/base/assets/avatars/diretor.png')
    const adversarios = screen.getAllByTestId('hud-avatar-adversario')
    expect(adversarios).toHaveLength(3)
    expect(adversarios[0].querySelector('img')).toHaveAttribute('src', '/base/assets/avatars/enfermeira.png')
    expect(adversarios[1].querySelector('img')).toHaveAttribute('src', '/base/assets/avatars/janitor.png')
    expect(adversarios[2].querySelector('img')).toHaveAttribute('src', '/base/assets/avatars/paciente.png')
    // Fila de turno começa no ativo e segue a ordem de entrada com wrap.
    const fila = [screen.getByTestId('hud-turno-ativo'), ...screen.getAllByTestId('hud-turno-proximo')]
    expect(fila.map((el) => el.querySelector('img')?.getAttribute('src'))).toEqual([
      '/base/assets/avatars/diretor.png',
      '/base/assets/avatars/enfermeira.png',
      '/base/assets/avatars/janitor.png',
      '/base/assets/avatars/paciente.png',
    ])
    unmount()
  })

  it('com 2 e 3 jogadores só os slots presentes têm foto (issue #404)', () => {
    const dois: Record<string, PercepcaoDeJogador> = {
      ['j1']: { apelido: 'Um', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 1, protegido: false },
      ['j2']: { apelido: 'Dois', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 2, protegido: false },
    }
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={dois}
        jogadorAtivoId="j1"
        jogadorLocalId="j1"
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{
          ['j1']: '/base/assets/avatars/diretor.png',
          ['j2']: '/base/assets/avatars/enfermeira.png',
        }}
        onSair={() => {}}
      />,
    )
    expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(1)
    expect(
      screen.getAllByTestId('hud-avatar-adversario')[0].querySelector('img'),
    ).toHaveAttribute('src', '/base/assets/avatars/enfermeira.png')
    expect(
      screen.getByRole('img', { name: 'Retrato de Um, com a vez' }).querySelector('img'),
    ).toHaveAttribute('src', '/base/assets/avatars/diretor.png')
    unmount()

    const tres: Record<string, PercepcaoDeJogador> = {
      ...dois,
      ['j3']: { apelido: 'Tres', cor: 'azul', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, ordem: 3, protegido: false },
    }
    render(
      <HudDaPartida
        jogadorPorId={tres}
        jogadorAtivoId="j1"
        jogadorLocalId="j1"
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{
          ['j1']: '/base/assets/avatars/diretor.png',
          ['j2']: '/base/assets/avatars/enfermeira.png',
          ['j3']: '/base/assets/avatars/janitor.png',
        }}
        onSair={() => {}}
      />,
    )
    expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(2)
    expect(
      screen.getAllByTestId('hud-avatar-adversario')[1].querySelector('img'),
    ).toHaveAttribute('src', '/base/assets/avatars/janitor.png')
  })

  it('Baixa Iluminação/Amedrontado não trocam a foto (issue #404)', () => {
    const jogadores: Record<string, PercepcaoDeJogador> = {
      [MEU_JOGADOR_ID]: { apelido: 'JogadorTeste', cor: 'branco', sanidade: 2, emBaixaIluminacao: true, amedrontado: true, ordem: 1, protegido: false },
      ['jogador-2']: { apelido: 'Ana', cor: 'vermelho', sanidade: 1, emBaixaIluminacao: true, amedrontado: true, ordem: 2, protegido: false },
    }
    const { unmount } = render(
      <HudDaPartida
        jogadorPorId={jogadores}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        imagemPorJogador={{ [MEU_JOGADOR_ID]: 'https://exemplo.test/eu.png', ['jogador-2']: 'https://exemplo.test/ana.png' }}
        onSair={() => {}}
      />,
    )
    expect(
      screen.getByRole('img', { name: 'Retrato de JogadorTeste, com a vez' }).querySelector('img'),
    ).toHaveAttribute('src', 'https://exemplo.test/eu.png')
    expect(screen.getByTestId('hud-avatar-adversario').querySelector('img')).toHaveAttribute(
      'src',
      'https://exemplo.test/ana.png',
    )
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

  it('resultado congela o tempo do marco e não reinicia', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const { rerender } = render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')

    rerender(<HudDaPartida {...propsBase(T0)} emAndamento emResultado />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    vi.useRealTimers()
  })

  it('marcos distintos mostram tempos distintos e nada vai para sessionStorage', () => {
    window.sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(T0 + 65_000)
    const { unmount } = render(<HudDaPartida {...propsBase(T0)} emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('01:05')
    unmount()

    // Partida iniciada 30s depois: marco distinto, tempo distinto.
    render(<HudDaPartida {...propsBase(T0 + 30_000)} emAndamento emResultado={false} />)
    expect(screen.getByTestId('hud-cronometro')).toHaveTextContent('00:35')
    expect(window.sessionStorage.length).toBe(0)
    vi.useRealTimers()
  })

  it('snapshot em andamento injeta o marco; dois clientes com o mesmo marco mostram o mesmo MM:SS', async () => {
    // Meio do segundo para os dois renders caírem no mesmo MM:SS (#259).
    const marco = Date.now() - 65_500
    await partidaComSnapshot(criarSnapshotBase({ iniciadaEm: marco }))
    const textoA = screen.getByTestId('hud-cronometro').textContent
    expect(textoA).toBe('01:05')
    cleanup()

    // Segundo cliente/aba com o mesmo marco do servidor: mesmo MM:SS.
    await partidaComSnapshot(criarSnapshotBase({ iniciadaEm: marco }))
    expect(screen.getByTestId('hud-cronometro').textContent).toBe(textoA)
  })

  it('PARTIDA_INICIADA injeta o marco quando a admissão chegou preparada', async () => {
    const marco = Date.now() - 65_500
    renderPartidaParaSaida(null)
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: MEU_JOGADOR_ID,
        apelido: 'JogadorTeste',
        partidaId: 'partida-1',
        estado: 'preparada',
      }),
    )
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ estado: 'preparada', iniciadaEm: null }),
      }),
    )
    // Snapshot preparada ainda não promove a tela — sem HUD/cronômetro.
    expect(screen.queryByTestId('hud-cronometro')).not.toBeInTheDocument()

    act(() =>
      ws.simulateMessage({ type: 'PARTIDA_INICIADA', partidaId: 'partida-1', iniciadaEm: marco }),
    )
    expect(await screen.findByTestId('hud-cronometro')).toHaveTextContent('01:05')
  })

  it('SAIR pede confirmação de desistência; confirmar desiste e vai à principal com login', async () => {
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
    expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/peão será removido/i)
    expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/equipe continua sem você/i)
    await user.click(screen.getByTestId('hud-sair-cancelar'))
    expect(screen.queryByTestId('hud-confirmacao-saida')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-da-partida')).toBeInTheDocument()
    expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)

    // Confirmar envia DESISTIR_DA_PARTIDA, encerra o WS e vai à principal.
    await user.click(screen.getByTestId('hud-sair'))
    const wsInst = MockWebSocket.last()!
    await user.click(screen.getByTestId('hud-sair-confirmar'))
    expect(wsInst.sentMessages.map((m) => JSON.parse(m))).toContainEqual(
      expect.objectContaining({ type: 'DESISTIR_DA_PARTIDA', jogadorId: MEU_JOGADOR_ID }),
    )
    expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
    expect(wsInst.onclose).toBeNull()
  })

  it('B1: SAIR na tela de resultado não marca desistência nem envia DESISTIR', async () => {
    window.sessionStorage.removeItem('partida-desistiu:p')
    try {
      const ws = await partidaComSnapshot(criarSnapshotBase())
      act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
      await screen.findByTestId('overlay-resultado')

      const user = userEvent.setup()
      await user.click(screen.getByTestId('hud-sair'))
      expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/Sair da partida\?/i)
      expect(screen.getByTestId('hud-confirmacao-saida')).not.toHaveTextContent(/peão será removido/i)
      await user.click(screen.getByTestId('hud-sair-confirmar'))

      const wsInst = MockWebSocket.last()!
      expect(wsInst.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
      expect(window.sessionStorage.getItem('partida-desistiu:p')).toBeNull()
      expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
    } finally {
      window.sessionStorage.removeItem('partida-desistiu:p')
    }
  })

  it('F4: desistência 2→1 anuncia o fim por desistência no SR', async () => {
    const ws = await partidaComSnapshot(
      criarSnapshotBase({ jogadores: JOGADORES_BASE.slice(0, 2) }),
    )
    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
      }),
    )
    await screen.findByTestId('aviso-desistencia')
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Ana desistiu/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(/Ana desistiu/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(
      /Partida terminada em derrota por desistência/i,
    )
  })

  it('F4-silencio: DESISTENCIA pré-snapshot projeta sem toast/SR (sem inventar dados)', async () => {
    const ws = await partidaDisponivel()
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
      }),
    )
    // Silêncio intencional: sem roster não há apelido/ordem/restantes verdadeiros.
    expect(screen.queryByTestId('aviso-desistencia')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent('')
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    // Snapshot seguinte reconcilia e o HUD volta a montar.
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    await screen.findByTestId('hud-da-partida')
  })

  it('desistência alheia projeta remoção, avisa e anuncia SR; derrota-quando-sobra-1 com retorno', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(3)

    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-4',
        peaoId: 'peao-amarelo',
      }),
    )

    // Projeção: peão do desistente sai da ordem (3→2 adversários visíveis).
    await waitFor(() =>
      expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(2),
    )
    // Aviso visível + anúncio SR com desistência e nova ordem.
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Cara desistiu/i)
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Nova ordem/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(/Cara desistiu/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(/Nova ordem/i)
    // Repetição idempotente não quebra.
    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-4',
        peaoId: 'peao-amarelo',
      }),
    )
    expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(2)

    // Derrota-quando-sobra-1: motivo desistencia no overlay.
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'derrota', motivo: 'desistencia' }))
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-motivo', 'desistencia')
    expect(overlay).toHaveTextContent(/Restou só você/i)
  })

  it('R2: SAIR com socket CONNECTING aguarda o OPEN e entrega o DESISTIR', async () => {
    MockWebSocket.forceNoAutoOpen = true
    try {
      renderPartidaParaSaida('A3K9M2')
      await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
      const ws = MockWebSocket.last()!
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING)
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
      await user.click(screen.getByTestId('hud-sair'))
      await user.click(screen.getByTestId('hud-sair-confirmar'))
      // Enfileirado, não enviado — e ainda sem navegar.
      expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
      expect(screen.queryByTestId('principal-pagina')).not.toBeInTheDocument()

      // O open drena a fila (entrega) e só então desconecta e navega.
      act(() => ws.simulateOpen())
      expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
      expect(ws.sentMessages.map((m) => JSON.parse(m))).toContainEqual(
        expect.objectContaining({ type: 'DESISTIR_DA_PARTIDA', jogadorId: MEU_JOGADOR_ID }),
      )
      expect(ws.onclose).toBeNull()
    } finally {
      MockWebSocket.forceNoAutoOpen = false
    }
  })

  it('R4: aviso de desistência permanece visível no resultado 2→1', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-4',
        peaoId: 'peao-amarelo',
      }),
    )
    await screen.findByTestId('aviso-desistencia')
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'derrota', motivo: 'desistencia' }))
    await screen.findByTestId('overlay-resultado')
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Cara desistiu/i)
  })

  it('SR N>2: desistência 4→3 anuncia ordem exata sem frase de fim', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    act(() =>
      ws.simulateMessage({
        type: 'DESISTENCIA_REGISTRADA',
        jogadorId: 'jogador-4',
        peaoId: 'peao-amarelo',
      }),
    )
    await screen.findByTestId('aviso-desistencia')
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Cara desistiu/i)
    expect(screen.getByTestId('aviso-desistencia')).toHaveTextContent(/Nova ordem/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(/Cara desistiu/i)
    expect(screen.getByTestId('anuncio-desistencia')).toHaveTextContent(/3 jogadores restantes/i)
    expect(screen.getByTestId('anuncio-desistencia')).not.toHaveTextContent(
      /Partida terminada em derrota/i,
    )
  })

  it('R2: sem OPEN, confirmar entra em saindo sem navegar; no open, envia e navega', async () => {
    MockWebSocket.forceNoAutoOpen = true
    try {
      window.localStorage.removeItem('partida-desistir-pendente:p')
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
      await user.click(screen.getByTestId('hud-sair'))
      await user.click(screen.getByTestId('hud-sair-confirmar'))
      // Enfileirado: sem navegar, modal em "saindo" com retry visível e
      // pendência gravada — nada enviado ainda.
      expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
      expect(screen.queryByTestId('principal-pagina')).not.toBeInTheDocument()
      expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/Enviando sua desistência/i)
      expect(screen.getByTestId('hud-sair-mesmo-assim')).toBeInTheDocument()
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBe(MEU_JOGADOR_ID)
      // O open drena a fila (DESISTIR enviado) e só então navega.
      act(() => ws.simulateOpen())
      await waitFor(() =>
        expect(
          ws.sentMessages.map((m) => JSON.parse(m)).filter((c) => c.type === 'DESISTIR_DA_PARTIDA'),
        ).toHaveLength(1),
      )
      expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBeNull()
    } finally {
      MockWebSocket.forceNoAutoOpen = false
      window.localStorage.removeItem('partida-desistir-pendente:p')
    }
  }, 15000)

  it('R2: Sair mesmo assim navega com pendente; ao voltar, reenvia no open', async () => {
    MockWebSocket.forceNoAutoOpen = true
    try {
      window.localStorage.removeItem('partida-desistir-pendente:p')
      window.sessionStorage.removeItem('partida-desistiu:p')
      const { unmount } = renderPartidaParaSaida('A3K9M2')
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
      await user.click(screen.getByTestId('hud-sair'))
      await user.click(screen.getByTestId('hud-sair-confirmar'))
      await user.click(screen.getByTestId('hud-sair-mesmo-assim'))
      // Navegou sem entregar; a pendência persiste para a próxima visita.
      expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
      expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBe(MEU_JOGADOR_ID)
      unmount()
      MockWebSocket.clean()

      // Volta à URL: no primeiro open, o reenvio automático entrega.
      renderPartidaParaSaida('A3K9M2')
      await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
      const ws2 = MockWebSocket.last()!
      act(() => ws2.simulateOpen())
      await waitFor(() =>
        expect(
          ws2.sentMessages.map((m) => JSON.parse(m)).filter((c) => c.type === 'DESISTIR_DA_PARTIDA'),
        ).toHaveLength(1),
      )
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBeNull()
    } finally {
      MockWebSocket.forceNoAutoOpen = false
      window.localStorage.removeItem('partida-desistir-pendente:p')
      window.sessionStorage.removeItem('partida-desistiu:p')
    }
  }, 15000)

  it('R2: reenvio já processado pelo servidor é silencioso (sem recusa)', async () => {
    MockWebSocket.forceNoAutoOpen = true
    try {
      window.localStorage.setItem('partida-desistir-pendente:p', MEU_JOGADOR_ID)
      window.sessionStorage.removeItem('partida-desistiu:p')
      renderPartidaParaSaida('A3K9M2')
      await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
      const ws = MockWebSocket.last()!
      act(() => ws.simulateOpen())
      await waitFor(() =>
        expect(
          ws.sentMessages.map((m) => JSON.parse(m)).filter((c) => c.type === 'DESISTIR_DA_PARTIDA'),
        ).toHaveLength(1),
      )
      // Servidor já tinha processado: recusa correlacionada limpa sem som/SR.
      act(() =>
        ws.simulateMessage({
          type: 'ERRO_DO_TABULEIRO',
          codigo: 'JOGADOR_NAO_NA_PARTIDA',
          mensagem: 'Jogador não está na partida.',
        }),
      )
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBeNull()
      expect(screen.getByTestId('anuncio-de-recusa')).toBeEmptyDOMElement()
    } finally {
      MockWebSocket.forceNoAutoOpen = false
      window.localStorage.removeItem('partida-desistir-pendente:p')
    }
  }, 15000)

  it('R2: cancelar no saindo aborta a espera e permite confirmar de novo', async () => {
    MockWebSocket.forceNoAutoOpen = true
    try {
      window.localStorage.removeItem('partida-desistir-pendente:p')
      window.sessionStorage.removeItem('partida-desistiu:p')
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
      await user.click(screen.getByTestId('hud-sair'))
      await user.click(screen.getByTestId('hud-sair-confirmar'))
      expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/Enviando sua desistência/i)
      // Cancela: volta à partida, purga a fila e apaga a pendência.
      await user.click(screen.getByTestId('hud-sair-cancelar'))
      expect(screen.queryByTestId('principal-pagina')).not.toBeInTheDocument()
      expect(screen.getByTestId('hud-confirmacao-saida')).toHaveTextContent(/Desistir da partida/i)
      expect(window.localStorage.getItem('partida-desistir-pendente:p')).toBeNull()
      // O open tardio não envia nem navega (espera invalidada).
      act(() => ws.simulateOpen())
      expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
      expect(screen.queryByTestId('principal-pagina')).not.toBeInTheDocument()
      // Nova confirmação funciona (socket já OPEN: envia e navega).
      await user.click(screen.getByTestId('hud-sair-confirmar'))
      await waitFor(() =>
        expect(
          ws.sentMessages.map((m) => JSON.parse(m)).filter((c) => c.type === 'DESISTIR_DA_PARTIDA'),
        ).toHaveLength(1),
      )
      expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
      expect(window.sessionStorage.getItem('partida-desistiu:p')).toBe('1')
    } finally {
      MockWebSocket.forceNoAutoOpen = false
      window.localStorage.removeItem('partida-desistir-pendente:p')
      window.sessionStorage.removeItem('partida-desistiu:p')
    }
  }, 15000)

  it('anti-duplo: confirmar desabilita e envia um único DESISTIR', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    expect(ws.sentMessages.join(' ')).not.toMatch(/DESISTIR_DA_PARTIDA/)
    const wsInst = MockWebSocket.last()!
    const user = userEvent.setup()
    await user.click(screen.getByTestId('hud-sair'))
    const confirmar = screen.getByTestId('hud-sair-confirmar')
    await user.click(confirmar)
    // Trava local: segundo clique é no-op mesmo antes do navigate assíncrono.
    await user.click(confirmar).catch(() => undefined)
    const desistencias = wsInst.sentMessages
      .map((m) => JSON.parse(m))
      .filter((c) => c.type === 'DESISTIR_DA_PARTIDA')
    expect(desistencias).toHaveLength(1)
    expect(await screen.findByTestId('principal-pagina')).toBeInTheDocument()
  })

  it('desistente que volta à URL vê falha terminal sem retry nem voltar-à-sala', async () => {
    window.sessionStorage.setItem('partida-desistiu:p', '1')
    try {
      renderPartidaParaSaida(null)
      await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
      act(() => {
        MockWebSocket.last()!.onerror!(new Event('error'))
      })
      expect(await screen.findByTestId('overlay-falha')).toBeInTheDocument()
      expect(screen.getByTestId('partida-desistencia-sem-retorno')).toHaveTextContent(/não pode reassistir/i)
      expect(screen.queryByTestId('partida-tentar-novamente')).not.toBeInTheDocument()
      expect(screen.queryByTestId('voltar-a-sala')).not.toBeInTheDocument()
    } finally {
      window.sessionStorage.removeItem('partida-desistiu:p')
    }
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

describe('HUD da Partida — sem provisórios, com rótulos (#226 [7], #225)', () => {
  it('chips antigos removidos; vocabulário Baixa Iluminação e card de Proteção presente', async () => {
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
    expect(screen.queryByText(/baixa visão/i)).not.toBeInTheDocument()
    expect(screen.getByText(/baixa iluminação/i)).toBeInTheDocument()
    expect(screen.getByTestId('hud-card-protecao')).toBeInTheDocument()
    expect(screen.getByText(/proteção/i)).toBeInTheDocument()
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

describe('HUD da Partida — Proteção no HUD (#225)', () => {
  it('card local alterna apagado/aceso conforme flag protegido com paridade visual e acessível', async () => {
    const ws = await partidaDisponivel()
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          jogadores: [
            { ...JOGADORES_BASE[0], protegido: false },
            JOGADORES_BASE[1],
            JOGADORES_BASE[2],
            JOGADORES_BASE[3],
          ],
        }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    const card = screen.getByTestId('hud-card-protecao')
    expect(card).toHaveAttribute('data-ativo', 'false')
    expect(card).toHaveAttribute('aria-label', 'Proteção inativa')
    expect(card).toHaveClass('w-24')
    expect(card).toHaveClass('max-w-[6rem]')
    expect(card).toHaveClass('border-zinc-700/60')
    expect(card).toHaveClass('bg-zinc-950/70')

    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          jogadores: [
            { ...JOGADORES_BASE[0], protegido: true },
            JOGADORES_BASE[1],
            JOGADORES_BASE[2],
            JOGADORES_BASE[3],
          ],
        }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'true'))
    const cardAtivo = screen.getByTestId('hud-card-protecao')
    expect(cardAtivo).toHaveAttribute('aria-label', 'Proteção ativa')
    expect(cardAtivo).toHaveClass('w-24')
    expect(cardAtivo).toHaveClass('max-w-[6rem]')
    expect(cardAtivo).toHaveClass('border-cyan-400/70')
    expect(cardAtivo).toHaveClass('bg-cyan-400/10')
    expect(cardAtivo).toHaveClass('transition-all')
  })

  it('ícone de Proteção aparece nos avatares dos companheiros protegidos com rótulo acessível', async () => {
    await partidaComSnapshot(
      criarSnapshotBase({
        jogadores: [
          JOGADORES_BASE[0],
          { ...JOGADORES_BASE[1], protegido: true },
          { ...JOGADORES_BASE[2], protegido: false },
          { ...JOGADORES_BASE[3], protegido: true },
        ],
      }),
    )

    const icones = screen.getAllByTestId('hud-estado-protecao')
    expect(icones).toHaveLength(2)
    expect(icones[0]).toHaveAttribute('title', 'Proteção')

    const avatarAna = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-2')!
    expect(avatarAna).toHaveAttribute('data-protegido', 'true')
    expect(avatarAna.getAttribute('aria-label')).toMatch(/protegido/i)
    expect(screen.getByRole('img', { name: /Ana.*protegido/i })).toBeInTheDocument()

    const avatarBeto = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-3')!
    expect(avatarBeto).not.toHaveAttribute('data-protegido')
    expect(avatarBeto.getAttribute('aria-label')).not.toMatch(/protegido/i)

    const avatarCara = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-4')!
    expect(avatarCara).toHaveAttribute('data-protegido', 'true')
  })

  it('degrada graciosamente quando snapshot antigo não traz protegido (sem quebrar, apagado)', async () => {
    const ws = await partidaDisponivel()
    const base = criarSnapshotBase()
    const bruto = {
      ...base,
      jogadores: base.jogadores.map((j) => {
        const { protegido: _, ...resto } = j as typeof j & { protegido?: boolean }
        void _
        return resto
      }),
    } as unknown as EstadoDaPartidaSnapshot
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: bruto }))
    await screen.findByTestId('hud-da-partida')

    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'false')
    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('aria-label', 'Proteção inativa')
    expect(screen.queryByTestId('hud-estado-protecao')).not.toBeInTheDocument()
  })

  it('delta POSICAO_CONFIRMADA atualiza Proteção ao vivo sem recarregar', async () => {
    const ws = await partidaComSnapshot(criarSnapshotBase())
    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'false')

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
        protegido: true,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'true'))
    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('aria-label', 'Proteção ativa')

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'inicial-2',
        protegido: false,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'false'))
  })

  it('delta ATAQUE_RESOLVIDO consome Proteção dos protegidos listados (na chegada do slot)', async () => {
    const ws = await partidaComSnapshot(
      criarSnapshotBase({
        jogadores: [
          { ...JOGADORES_BASE[0], protegido: true },
          { ...JOGADORES_BASE[1], protegido: true },
          JOGADORES_BASE[2],
          JOGADORES_BASE[3],
        ],
      }),
    )
    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'true')
    expect(screen.getAllByTestId('hud-estado-protecao')).toHaveLength(1)

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco', 'peao-vermelho'] }],
        peoesAtingidos: [],
        protegidos: [MEU_JOGADOR_ID, 'jogador-2'],
        estadosAplicados: [],
      }),
    )
    // Nada consome na hora: a fatia do slot aplica na chegada (~1,25s).
    expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'true')
    await waitFor(() => expect(screen.getByTestId('hud-card-protecao')).toHaveAttribute('data-ativo', 'false'), { timeout: 3000 })
    expect(screen.queryByTestId('hud-estado-protecao')).not.toBeInTheDocument()
    const avatarAna = screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === 'jogador-2')!
    expect(avatarAna).not.toHaveAttribute('data-protegido')
    expect(avatarAna.getAttribute('aria-label')).not.toMatch(/protegido/i)
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
