import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { toquesDeAudio } from './helpers/mockAudio'
import {
  CAMINHO_SOM_DEFESA_ATAQUE,
  CAMINHO_SOM_ESPECTRO,
  CAMINHO_SOM_TREMIDA_ATAQUE,
  CAMINHO_SOM_VULTO,
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_DISPARO_ATAQUE_MS,
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_ESPECTRO,
  VOLUME_BASE_SOM_TREMIDA_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../web/src/game/tabuleiro/animacao'
import type {
  EstadoDaPartidaSnapshot,
  PeaoNoSnapshot,
  PecaPosicionadaNoSnapshot,
} from '@flicker/shared'

// Coreografia do ataque em fila (issue #385): áudio e WebSocket mockados —
// evento com vítimas, sem vítimas e com protegidos disparam o gatilho certo;
// fila de dois e bloqueio da entrada cobertos. Timers fakeados SÓ para o
// driver do ataque (`setTimeout`/`clearTimeout`/`Date`); o lote atômico usa
// `queueMicrotask` (real) e o setup usa timers reais.

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

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
    jogadores: [
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...overrides,
  }
}

const VULTO_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'vulto-1',
  tipo: 'vulto',
  orientacao: 0,
  celula: { linha: 3, coluna: 3 },
}
const RETA_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'reta-1',
  tipo: 'reta',
  orientacao: 0,
  celula: { linha: 3, coluna: 4 },
}
const CURVA_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'curva-1',
  tipo: 'T',
  orientacao: 0,
  celula: { linha: 5, coluna: 5 },
}
const ESPECTRO_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'espectro-1',
  tipo: 'espectro',
  orientacao: 0,
  celula: { linha: 5, coluna: 4 },
}

function snapshotComTabuleiro(
  posicionadas: readonly PecaPosicionadaNoSnapshot[],
  peoes: readonly PeaoNoSnapshot[],
): EstadoDaPartidaSnapshot {
  return criarSnapshotBase({
    tabuleiro: {
      posicionadas: [...posicionadas],
      iniciais: [],
      peoes: [...peoes],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
  })
}

const PEOES_BASE: readonly PeaoNoSnapshot[] = [
  { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
  { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
  { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
  { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
]

/** Sobe a partida com timers reais e devolve o socket com o snapshot aplicado. */
async function partidaComTabuleiro(
  posicionadas: readonly PecaPosicionadaNoSnapshot[],
  peoes: readonly PeaoNoSnapshot[] = PEOES_BASE,
  snapshotOverrides: Partial<EstadoDaPartidaSnapshot> = {},
): Promise<MockWebSocket> {
  renderPartidaNaRota('/partida?serverId=s&partidaId=p')
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: MEU_JOGADOR_ID,
      apelido: 'JogadorTeste',
      partidaId: 'p',
      estado: 'em_andamento',
    }),
  )
  await screen.findByTestId('tabuleiro')
  act(() =>
    ws.simulateMessage({
      type: 'ESTADO_DA_PARTIDA',
      snapshot: { ...snapshotComTabuleiro(posicionadas, peoes), ...snapshotOverrides },
    }),
  )
  await screen.findByTestId('hud-turno-ativo')
  return ws
}

function avatarDoAdversario(jogadorId: string): HTMLElement | undefined {
  return screen
    .getAllByTestId('hud-avatar-adversario')
    .find((el) => el.getAttribute('data-jogador-id') === jogadorId)
}

function ativarTimersDoAtaque(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

function avancar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

afterEach(() => {
  vi.useRealTimers()
  MockWebSocket.clean()
})

describe('ataque em fila — sons próprios e coreografia (issue #385)', () => {
  it('com vítimas: estado aplica na hora, uivo + tremida, tremor/pulo e drena sem marcas', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, CURVA_1])
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [
          {
            pecaId: 'vulto-1',
            tipo: 'vulto',
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['reta-1', 'curva-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ],
      }),
    )

    // Estado aplica na hora (animação só revela): HUD já reflete a penalidade.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '2')
    // Gesto de disparo soa na hora: uivo, nunca o THUD genérico.
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    // Anúncio ao leitor mantido, sem som genérico.
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe(
      'ataque_com_penalidade',
    )
    // Overlay: disparo do monstro + reações (com peão treme, sem peão pula).
    const coreografia = screen.getByTestId('ataque-coreografia')
    expect(coreografia).toHaveAttribute('data-atacante', 'vulto-1')
    expect(coreografia).toHaveAttribute('data-tipo', 'vulto')
    expect(screen.getByTestId('ataque-disparo')).toHaveAttribute('data-peca-id', 'vulto-1')
    const reacaoComPeao = screen
      .getAllByTestId('ataque-reacao')
      .find((el) => el.getAttribute('data-peca-id') === 'reta-1')!
    const reacaoSemPeao = screen
      .getAllByTestId('ataque-reacao')
      .find((el) => el.getAttribute('data-peca-id') === 'curva-1')!
    expect(reacaoComPeao).toHaveAttribute('data-reacao', 'tremor')
    expect(reacaoSemPeao).toHaveAttribute('data-reacao', 'pulo')
    // Onda do Vulto por camadas: reta-1 camada 1, curva-1 camada 4.
    expect(reacaoComPeao).toHaveAttribute('data-camada', '1')
    expect(reacaoSemPeao).toHaveAttribute('data-camada', '4')

    // Chegada ao alvo: tremida (só com atingido).
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[1]).toMatchObject({
      src: CAMINHO_SOM_TREMIDA_ATAQUE,
      volume: VOLUME_BASE_SOM_TREMIDA_ATAQUE,
    })

    // Drenou: overlay some sem marcas, HUD mantém o estado aplicado.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '2')
    expect(toquesDeAudio).toHaveLength(2)
  })

  it('sem vítimas: ataca e soa mesmo assim (só monstro), sem tremida nem defesa', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [], pecasNoAlcance: [] }],
        peoesAtingidos: [],
        protegidos: [],
        estadosAplicados: [],
      }),
    )

    // Só monstro — tremida e defesa só com alvo na chegada.
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeAudio).toHaveLength(1)
  })

  it('com protegidos: escudo + som de defesa, sem tremor nem debilitação', async () => {
    const snapshot = snapshotComTabuleiro([ESPECTRO_1, RETA_1], PEOES_BASE)
    const ws = await partidaComTabuleiro(
      [ESPECTRO_1, RETA_1],
      PEOES_BASE,
      {
        jogadores: snapshot.jogadores.map((j) =>
          j.jogadorId === 'jogador-2' ? { ...j, protegido: true } : j,
        ),
      },
    )
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-protegido')
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [
          {
            pecaId: 'espectro-1',
            tipo: 'espectro',
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['reta-1'],
          },
        ],
        peoesAtingidos: [],
        protegidos: ['jogador-2'],
        estadosAplicados: [],
      }),
    )

    // Trovão no disparo; proteção consumida na hora (sanidade intacta).
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({
      src: CAMINHO_SOM_ESPECTRO,
      volume: VOLUME_BASE_SOM_ESPECTRO,
    })
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-protegido')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    // Só escudo — sem tremor; Espectro reage junto (sem stagger).
    const reacao = screen.getByTestId('ataque-reacao')
    expect(reacao).toHaveAttribute('data-reacao', 'escudo')
    expect(reacao).toHaveStyle({ animationDelay: '0ms' })

    // Chegada: defesa, sem tremida.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[1]).toMatchObject({
      src: CAMINHO_SOM_DEFESA_ATAQUE,
      volume: VOLUME_BASE_SOM_DEFESA_ATAQUE,
    })

    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeAudio).toHaveLength(2)
  })

  it('dois monstros animam em fila na ordem de atacantes (~1,9s)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes)
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [
          {
            pecaId: 'vulto-1',
            tipo: 'vulto',
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['reta-1'],
          },
          {
            pecaId: 'espectro-1',
            tipo: 'espectro',
            peoesNoAlcance: ['peao-azul'],
            pecasNoAlcance: ['curva-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho', 'peao-azul'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
          { jogadorId: 'jogador-3', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
        ],
      }),
    )

    // Primeiro da fila: Vulto.
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(toquesDeAudio.map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO])

    // Chegada do primeiro + passagem da vez: Espectro assume.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'espectro-1')
    expect(toquesDeAudio.map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMIDA_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
    ])

    // Chegada do segundo + dreno total (~1,9s): sem marcas.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeAudio.map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMIDA_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
      CAMINHO_SOM_TREMIDA_ATAQUE,
    ])
  })

  it('entrada do turno espera a fila drenar', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [
          {
            pecaId: 'vulto-1',
            tipo: 'vulto',
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['reta-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ],
      }),
    )
    expect(screen.getByTestId('ataque-coreografia')).toBeInTheDocument()

    // TURNO_INICIADO com a fila ativa é segurado: a vez não entra.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    expect(screen.getByTestId('ataque-coreografia')).toBeInTheDocument()

    // Drenou: a entrada do turno é liberada na ordem.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
  })

  it('payload legado sem pecasNoAlcance ativa o fallback sem quebra', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-vermelho'] }],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ],
      }),
    )

    // Sem onda, sem quebra: estado aplica, monstro soa, fila drena.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '2')
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(screen.queryAllByTestId('ataque-reacao')).toHaveLength(0)

    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[1]).toMatchObject({ src: CAMINHO_SOM_TREMIDA_ATAQUE })

    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
  })
})
