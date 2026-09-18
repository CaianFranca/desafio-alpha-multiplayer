import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { toquesDeEfeito } from './helpers/mockAudio'
import {
  CAMINHO_SOM_DEFESA_ATAQUE,
  CAMINHO_SOM_ESPECTRO,
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  CAMINHO_SOM_TREMOR_ATAQUE,
  CAMINHO_SOM_VULTO,
  DURACAO_ATAQUE_POR_ATACANTE_MS,
  DURACAO_BASE_ATAQUE_MS,
  DURACAO_DISPARO_ATAQUE_MS,
  DURACAO_JANELA_GATILHO_MS,
  DURACAO_TELEGRAPH_ATAQUE_MS,
  VOLUME_BASE_SOM_DEFESA_ATAQUE,
  VOLUME_BASE_SOM_ESPECTRO,
  VOLUME_BASE_SOM_TREMOR_ATAQUE,
  VOLUME_BASE_SOM_VULTO,
} from '../web/src/game/tabuleiro/animacao'
import {
  coreografarAtaque,
  duracaoDaFilaDeAtaque,
  type PecaReagindoNoAtaque,
} from '../web/src/game/tabuleiro/ataque'
import type {
  EstadoDaPartidaSnapshot,
  PeaoNoSnapshot,
  PecaPosicionadaNoSnapshot,
} from '@flicker/shared'

// Coreografia do ataque em fila (issue #385 + follow-up do telegraph — fila na
// ordem de atacantes do wire, sem reordenação):
// áudio e WebSocket mockados — cada atacante abre com 1s de telegraph
// silencioso (contorno vermelho na própria peça, 3D + espelho DOM) e só
// depois dispara som + animação; a fatia de estado do slot aplica na chegada
// (~250ms após o disparo) — Espectro revela sanidade/Amedrontado, Vulto
// revela Baixa Iluminação; a fila nunca sobrepõe um slot ao seguinte.
// Timers fakeados SÓ para o driver do
// ataque (`setTimeout`/`clearTimeout`/`Date`); o lote atômico usa
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

function pecaNoEspelho(pecaId: string): HTMLElement {
  return screen
    .getAllByTestId('peca-posicionada')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)!
}

function temPecaNoEspelho(pecaId: string): boolean {
  return screen
    .getAllByTestId('peca-posicionada')
    .some((el) => el.getAttribute('data-peca-id') === pecaId)
}

function celulasIluminadasNoEspelho(): string[] {
  return screen
    .getAllByTestId('tabuleiro-celula')
    .filter((el) => el.getAttribute('data-iluminada') === 'true')
    .map((el) => `${el.getAttribute('data-linha')}:${el.getAttribute('data-coluna')}`)
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
  it('com vítimas: telegraph silencioso, depois uivo + Baixa na chegada, tremor/pulo e drena sem marcas', async () => {
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )

    // Estado NÃO aplica na hora (follow-up da ordem): a fatia do slot só
    // aplica na chegada — HUD segue intacto, sem anúncio ainda.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')
    // Telegraph silencioso de 1s: nenhum som, etiqueta de telegraph, sem
    // disparo nem reações — a consequência ainda não revela.
    expect(toquesDeEfeito()).toHaveLength(0)
    const telegraph = screen.getByTestId('ataque-coreografia')
    expect(telegraph).toHaveAttribute('data-atacante', 'vulto-1')
    expect(telegraph).toHaveAttribute('data-estagio', 'telegraph')
    expect(screen.getByTestId('ataque-telegraph')).toHaveAttribute('data-peca-id', 'vulto-1')
    expect(screen.queryByTestId('ataque-disparo')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('ataque-reacao')).toHaveLength(0)
    // Marca do telegraph no espelho DOM: só na peça do atacante.
    expect(pecaNoEspelho('vulto-1')).toHaveAttribute('data-telegraph', 'true')
    expect(pecaNoEspelho('reta-1')).not.toHaveAttribute('data-telegraph')
    // Sem reação no 3D/espelho durante o telegraph (só no disparo).
    expect(pecaNoEspelho('reta-1')).not.toHaveAttribute('data-reacao')
    expect(pecaNoEspelho('curva-1')).not.toHaveAttribute('data-reacao')

    // Fim do pulso: gesto de disparo soa (uivo, nunca o THUD genérico) — a
    // fatia ainda não aplicou (chegada é ~250ms depois).
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    // Overlay vira etiqueta de ataque: disparo + reações (com peão treme,
    // sem peão pula); a marca do telegraph apaga no disparo.
    const coreografia = screen.getByTestId('ataque-coreografia')
    expect(coreografia).toHaveAttribute('data-atacante', 'vulto-1')
    expect(coreografia).toHaveAttribute('data-estagio', 'ataque')
    expect(screen.queryByTestId('ataque-telegraph')).not.toBeInTheDocument()
    expect(screen.getByTestId('ataque-disparo')).toHaveAttribute('data-peca-id', 'vulto-1')
    expect(pecaNoEspelho('vulto-1')).not.toHaveAttribute('data-telegraph')
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
    // Duplo feedback peça 3D + chips: o espelho DOM marca a mesma reação.
    expect(pecaNoEspelho('reta-1')).toHaveAttribute('data-reacao', 'tremor')
    expect(pecaNoEspelho('curva-1')).toHaveAttribute('data-reacao', 'pulo')
    // Pré-chegada: HUD e anúncio seguem intactos, sem som novo.
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')
    avancar(100)
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')

    // Chegada ao alvo: tremor (só com atingido) + fatia do Vulto (só Baixa —
    // sanidade segue 3) + anúncio ao leitor (com vítimas, sem THUD).
    avancar(DURACAO_DISPARO_ATAQUE_MS - 100)
    expect(toquesDeEfeito()).toHaveLength(2)
    expect(toquesDeEfeito()[1]).toMatchObject({
      src: CAMINHO_SOM_TREMOR_ATAQUE,
      volume: VOLUME_BASE_SOM_TREMOR_ATAQUE,
    })
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe(
      'ataque_com_penalidade',
    )

    // Drenou: overlay some sem marcas, HUD mantém a fatia aplicada.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(pecaNoEspelho('reta-1')).not.toHaveAttribute('data-reacao')
    expect(pecaNoEspelho('curva-1')).not.toHaveAttribute('data-reacao')
    expect(toquesDeEfeito()).toHaveLength(2)
  })

  it('sem vítimas: telegraph silencioso, depois ataca e soa mesmo assim (só monstro)', async () => {
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

    // Telegraph primeiro: silencioso, sem disparo.
    expect(toquesDeEfeito()).toHaveLength(0)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(screen.getByTestId('ataque-telegraph')).toHaveAttribute('data-peca-id', 'vulto-1')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    // Após o pulso: só monstro — tremor e defesa só com alvo na chegada.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')

    avancar(DURACAO_DISPARO_ATAQUE_MS)
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('com protegidos: telegraph, depois escudo + som de defesa, sem tremor nem debilitação', async () => {
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

    // Telegraph silencioso: proteção segue ativa até a chegada da fatia.
    expect(toquesDeEfeito()).toHaveLength(0)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-protegido')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(pecaNoEspelho('espectro-1')).toHaveAttribute('data-telegraph', 'true')

    // Após o pulso: trovão no disparo — a proteção ainda não consumiu.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({
      src: CAMINHO_SOM_ESPECTRO,
      volume: VOLUME_BASE_SOM_ESPECTRO,
    })
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-protegido')
    // Só escudo — sem tremor; Espectro reage junto (sem stagger).
    const reacao = screen.getByTestId('ataque-reacao')
    expect(reacao).toHaveAttribute('data-reacao', 'escudo')
    expect(reacao).toHaveStyle({ animationDelay: '0ms' })
    // Duplo feedback: o espelho DOM marca o escudo na peça.
    expect(pecaNoEspelho('reta-1')).toHaveAttribute('data-reacao', 'escudo')

    // Chegada: defesa, sem tremor — a fatia consome a proteção; sem vítimas
    // na fatia, o anúncio silencia.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(2)
    expect(toquesDeEfeito()[1]).toMatchObject({
      src: CAMINHO_SOM_DEFESA_ATAQUE,
      volume: VOLUME_BASE_SOM_DEFESA_ATAQUE,
    })
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-protegido')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeEfeito()).toHaveLength(2)
  })

  it('dois monstros animam em fila com telegraph por atacante, sem sobreposição (ordem do wire)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes)
    ativarTimersDoAtaque()

    // O engine emite na ordem de posicionamento (Vulto primeiro) — o cliente
    // anima na ordem do wire, sem reordenar (issue #385: "na ordem de atacantes").
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
          { jogadorId: 'jogador-3', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
        ],
      }),
    )

    // Telegraph do primeiro: Vulto (ordem do wire), silencioso.
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(toquesDeEfeito()).toHaveLength(0)

    // Disparo do primeiro + chegada: uivo, depois tremor.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO])
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO, CAMINHO_SOM_TREMOR_ATAQUE])
    // Chegada do Vulto: Baixa do vermelho aplica; sanidade do azul intacta.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-3')).toHaveAttribute('data-sanidade', '3')

    // Passagem da vez: telegraph do Espectro — silencioso, sem sobrepor nada
    // do anterior (sons do primeiro já terminaram; o segundo ainda não soou).
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'espectro-1')
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(pecaNoEspelho('espectro-1')).toHaveAttribute('data-telegraph', 'true')
    expect(pecaNoEspelho('vulto-1')).not.toHaveAttribute('data-telegraph')
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
    ])

    // Disparo do segundo + chegada + dreno total (~3,9s): sem marcas.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
    ])
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
      CAMINHO_SOM_TREMOR_ATAQUE,
    ])
    // Sanidade do azul aplicou na chegada do Espectro.
    expect(avatarDoAdversario('jogador-3')).toHaveAttribute('data-sanidade', '2')
  })

  it('peão no alcance de dois monstros: Baixa no slot Vulto, sanidade no slot Espectro (ordem do wire)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes)
    ativarTimersDoAtaque()

    // O engine emite o Vulto primeiro — a fila segue o wire: o Vulto resolve
    // por completo primeiro (Baixa na chegada dele); a sanidade só na chegada
    // do Espectro.
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
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['curva-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ],
      }),
    )

    // Nada aplica na hora: sanidade e Baixa seguem intactas, sem anúncio.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    // Slot 1 (Vulto, ordem do wire): telegraph silencioso, depois uivo.
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(toquesDeEfeito()).toHaveLength(0)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'ataque')
    // Com peão sobre reta-1: a peça treme junto.
    expect(screen.getByTestId('ataque-reacao')).toHaveAttribute('data-reacao', 'tremor')
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO, CAMINHO_SOM_TREMOR_ATAQUE])
    // Chegada do Vulto: Baixa aplica, sanidade ainda não, com anúncio.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe(
      'ataque_com_penalidade',
    )

    // Slot 2 (Espectro): telegraph SÓ após o fim do Vulto — silencioso.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'espectro-1')
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(pecaNoEspelho('espectro-1')).toHaveAttribute('data-telegraph', 'true')
    expect(toquesDeEfeito()).toHaveLength(2)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
    ])
    // Sem peão sobre curva-1: a peça pula, mas a tremor soa (dono do alcance).
    expect(screen.getByTestId('ataque-reacao')).toHaveAttribute('data-reacao', 'pulo')
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_ESPECTRO,
      CAMINHO_SOM_TREMOR_ATAQUE,
    ])
    // Chegada do Espectro: sanidade aplica (Baixa segue a do Vulto).
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '2')

    // Fila drena sem marcas.
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
  })

  it('iluminação e limpeza com fila ativa seguram e liberam na chegada do Vulto', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes, {
      celulasIluminadas: [
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 4 },
        { linha: 5, coluna: 5 },
      ],
    })
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    ativarTimersDoAtaque()

    // Gatilho misto na ordem do wire (Vulto primeiro): o Vulto atinge o
    // vermelho (Baixa), o Espectro atinge o azul (sanidade).
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
          { jogadorId: 'jogador-3', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
        ],
      }),
    )
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')

    // Iluminação encolhida + limpeza do mesmo gatilho chegam com a fila ativa:
    // seguram (nada aplica, nenhum som) — cegueira e sumiço não aparecem
    // antes da chegada do Vulto.
    act(() => ws.simulateMessage({ type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 3, coluna: 3 }] }))
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['curva-1'] }))
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Slot do Vulto: telegraph, disparo, chegada — Baixa do vermelho aplica e
    // a limpeza segura libera junto (último Vulto da fila).
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO])
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-3')).toHaveAttribute('data-sanidade', '3')
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3'])
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_SOMBRIO_LIMPEZA,
    ])

    // Slot do Espectro (só após o fim do Vulto): telegraph e disparo sobre o
    // tabuleiro já limpo.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'espectro-1')
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_SOMBRIO_LIMPEZA,
      CAMINHO_SOM_ESPECTRO,
    ])
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3'])

    // Chegada do Espectro: sanidade do azul aplica — sem tremor duplo da
    // limpeza (já liberada no Vulto).
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-3')).toHaveAttribute('data-sanidade', '2')
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_SOMBRIO_LIMPEZA,
      CAMINHO_SOM_ESPECTRO,
      CAMINHO_SOM_TREMOR_ATAQUE,
    ])

    // Drenou sem marcas; o estado final segue projetado.
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-3')).toHaveAttribute('data-sanidade', '2')
    expect(temPecaNoEspelho('curva-1')).toBe(false)
  })

  it('lote real do gatilho (POSICAO → CELULAS → LIMPEZA → ATAQUE → TURNO_*) segura até a chegada do Vulto', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes, {
      celulasIluminadas: [
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 4 },
        { linha: 5, coluna: 5 },
      ],
    })
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    ativarTimersDoAtaque()

    // Ordem canônica do engine no gatilho da confirmação (partida.ts:
    // Iluminação → Limpeza → Ataque): a limpeza do MESMO gatilho chega
    // ANTES de a fila existir — a janela de gatilho segura sem som/trigger.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
    act(() => ws.simulateMessage({ type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 3, coluna: 3 }] }))
    // O próprio gatilho remove o outro monstro e a peça do alcance: o payload
    // do ataque já nasce pós-limpeza (sem elas em `pecasNoAlcance`).
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['espectro-1', 'curva-1'] }))
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(temPecaNoEspelho('espectro-1')).toBe(true)
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Ataque do mesmo gatilho fecha a janela entregando o buffer à fila; a
    // virada segura na fila ativa.
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: MEU_JOGADOR_ID }))
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await act(async () => {})
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Telegraph: as peças condenadas ainda renderizam — sem sumiço antecipado
    // nem cegueira antes da vez do Vulto.
    expect(temPecaNoEspelho('espectro-1')).toBe(true)
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(toquesDeEfeito()).toHaveLength(0)

    // Disparo: uivo — a limpeza segue segurada até a chegada.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_VULTO])
    expect(temPecaNoEspelho('espectro-1')).toBe(true)
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    // A onda varre também as removidas do gatilho (fix do review PR #399): o
    // payload nasce pós-limpeza (só reta-1 no wire), mas o modelo ainda é
    // pré-despacho — espectro-1 e curva-1 reagem pela célula conhecida antes
    // de sumir. A reta-1 treme com o peão; a curva-1 treme com o azul; a
    // espectro-1 (sem peão) pula.
    const reacoes = screen.getAllByTestId('ataque-reacao')
    expect(reacoes).toHaveLength(3)
    const reacaoPorPeca = new Map(
      reacoes.map((el) => [
        el.getAttribute('data-peca-id'),
        el.getAttribute('data-reacao'),
      ]),
    )
    expect(reacaoPorPeca.get('reta-1')).toBe('tremor')
    expect(reacaoPorPeca.get('curva-1')).toBe('tremor')
    expect(reacaoPorPeca.get('espectro-1')).toBe('pulo')

    // Chegada do Vulto: Baixa + luz encolhida + sumiço com o som sombrio —
    // junto da fatia dele.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3'])
    expect(temPecaNoEspelho('espectro-1')).toBe(false)
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(temPecaNoEspelho('reta-1')).toBe(true)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_VULTO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_SOMBRIO_LIMPEZA,
    ])

    // Drenou sem marcas: a virada libera em ordem — o próximo turno assume.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(temPecaNoEspelho('curva-1')).toBe(false)
  })

  it('lote sem ataque: a janela fecha sozinha e a limpeza aplica ao confirmar (fix pós-PR #399)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes, {
      celulasIluminadas: [
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 4 },
        { linha: 5, coluna: 5 },
      ],
    })
    ativarTimersDoAtaque()

    // Confirmação sem ataque no lote: a janela segura luz e limpeza.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
    act(() => ws.simulateMessage({ type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 3, coluna: 3 }] }))
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['curva-1'] }))
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Sem ATAQUE no prazo da janela: aplica ao confirmar — sem esperar turno.
    avancar(DURACAO_JANELA_GATILHO_MS)
    await act(async () => {})
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3'])
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_SOMBRIO_LIMPEZA])
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
  })

  it('ataque tardio pós-fecho varre as removidas retidas (onda cega corrigida)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes, {
      celulasIluminadas: [
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 4 },
        { linha: 5, coluna: 5 },
      ],
    })
    ativarTimersDoAtaque()

    // Mesmo lote do teste do fecho: confirma → luz + limpeza seguradas.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
    act(() => ws.simulateMessage({ type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 3, coluna: 3 }] }))
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['espectro-1', 'curva-1'] }))
    // Janela fecha sem ataque: aplica e RETÉM fotos + ids.
    avancar(DURACAO_JANELA_GATILHO_MS)
    await act(async () => {})
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(temPecaNoEspelho('espectro-1')).toBe(false)

    // ATAQUE tardio do mesmo gatilho (sem TURNO no meio): o payload nasce
    // pós-limpeza (só reta-1 no wire), mas a onda varre as retidas.
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    // Sombrio da limpeza liberada no fecho + uivo no disparo do Vulto.
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_SOMBRIO_LIMPEZA, CAMINHO_SOM_VULTO])

    // A onda varre as 3: reta-1 (wire) + espectro-1/curva-1 (retidas) —
    // legenda do overlay, com camadas toroidais reais da célula pré-limpeza.
    const reacoes = screen.getAllByTestId('ataque-reacao')
    expect(reacoes.map((el) => el.getAttribute('data-peca-id'))).toEqual([
      'reta-1',
      'espectro-1',
      'curva-1',
    ])
    const porPeca = new Map(
      reacoes.map((el) => [
        el.getAttribute('data-peca-id'),
        {
          reacao: el.getAttribute('data-reacao'),
          camada: el.getAttribute('data-camada'),
        },
      ]),
    )
    expect(porPeca.get('reta-1')).toEqual({ reacao: 'tremor', camada: '1' })
    expect(porPeca.get('espectro-1')).toEqual({ reacao: 'pulo', camada: '3' })
    expect(porPeca.get('curva-1')).toEqual({ reacao: 'tremor', camada: '4' })

    // Chegada aplica a fatia normalmente (Baixa, sem tocar na sanidade).
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
  })

  it('[Vulto, Vulto] segura a limpeza até a chegada do último Vulto (review PR #399, item 3)', async () => {
    const VULTO_2: PecaPosicionadaNoSnapshot = {
      pecaId: 'vulto-2',
      tipo: 'vulto',
      orientacao: 0,
      celula: { linha: 5, coluna: 4 },
    }
    const ws = await partidaComTabuleiro([VULTO_1, VULTO_2, RETA_1, CURVA_1])
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
            pecaId: 'vulto-2',
            tipo: 'vulto',
            peoesNoAlcance: [],
            pecasNoAlcance: ['curva-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )
    // Limpeza chega com a fila ativa (2 Vultos): segura até o último Vulto.
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['curva-1'] }))
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Chegada do 1º Vulto: a fatia dele aplica (Baixa), mas a limpeza segue
    // segurada — ainda há Vulto restante na fila.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito().filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(0)

    // Passagem ao slot 2 (último Vulto): telegraph do vulto-2.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-2')

    // Chegada do último Vulto: a limpeza libera (peça some + som sombrio).
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(toquesDeEfeito().filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(1)

    // Drenou sem marcas.
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(temPecaNoEspelho('curva-1')).toBe(false)
  })

  it('lote real sem ataque libera iluminação e limpeza em ordem no fechamento', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, CURVA_1], PEOES_BASE, {
      celulasIluminadas: [
        { linha: 3, coluna: 3 },
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 5 },
      ],
    })
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    ativarTimersDoAtaque()

    // Mesmo lote, sem ataque: a janela segura até a virada fechar.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
    act(() => ws.simulateMessage({ type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 3, coluna: 3 }] }))
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['curva-1'] }))
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3', '3:4', '5:5'])
    expect(temPecaNoEspelho('curva-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Fechamento sem ataque: libera em ordem (luz encolhe, peça some com o
    // som sombrio) e a virada passa direto, sem fila.
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: MEU_JOGADOR_ID }))
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(celulasIluminadasNoEspelho()).toEqual(['3:3'])
    expect(temPecaNoEspelho('curva-1')).toBe(false)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([CAMINHO_SOM_SOMBRIO_LIMPEZA])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
  })

  it('sem Vulto na fila, a limpeza segurada libera ao drenar', async () => {
    const ws = await partidaComTabuleiro([ESPECTRO_1, RETA_1], PEOES_BASE, {
      celulasIluminadas: [
        { linha: 3, coluna: 4 },
        { linha: 5, coluna: 4 },
      ],
    })
    expect(temPecaNoEspelho('reta-1')).toBe(true)
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
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
        ],
      }),
    )
    // Limpeza chega com a fila ativa (só Espectro): segura até drenar.
    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['reta-1'] }))
    expect(temPecaNoEspelho('reta-1')).toBe(true)
    expect(toquesDeEfeito()).toHaveLength(0)

    // Slot do Espectro resolve por completo sem liberar a limpeza.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '2')
    expect(temPecaNoEspelho('reta-1')).toBe(true)
    expect(toquesDeEfeito().filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(0)

    // Drenou: a limpeza libera (peça some + som sombrio).
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(temPecaNoEspelho('reta-1')).toBe(false)
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_ESPECTRO,
      CAMINHO_SOM_TREMOR_ATAQUE,
      CAMINHO_SOM_SOMBRIO_LIMPEZA,
    ])
  })

  it('entrada do turno espera a fila estendida pelo telegraph drenar', async () => {
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

    // Telegraph + disparo não liberam: só o dreno total (~2,3s) libera.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Drenou: a entrada do turno é liberada na ordem.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
  })

  it('fluxo da confirmação (1 atacante): POSICAO_CONFIRMADA passa, a virada segura até drenar (#385)', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    ativarTimersDoAtaque()

    // Ordem do wire no gatilho da confirmação (engine): posição confirmada,
    // ataque resolvido, encerramento da vez e início do próximo turno.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: MEU_JOGADOR_ID }))
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await act(async () => {})

    // Vez antiga congelada durante telegraph + ataque: HUD sem o próximo turno.
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Drenou: encerramento + início liberados em ordem — o próximo turno assume.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
    // A fatia do Vulto aplicou na chegada: Baixa, sem tocar na sanidade.
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
  })

  it('fluxo da confirmação (2 atacantes): dreno total antes da virada (#385)', async () => {
    const peoes: readonly PeaoNoSnapshot[] = [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'curva-1' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
    ]
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1, ESPECTRO_1, CURVA_1], peoes)
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      }),
    )
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
          { jogadorId: 'jogador-3', emBaixaIluminacao: false, sanidade: 2, amedrontado: false },
        ],
      }),
    )
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: MEU_JOGADOR_ID }))
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    await act(async () => {})

    // Slot 1 (Vulto, ordem do wire): vez antiga congelada no telegraph e no disparo.
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Passagem ao slot 2 (Espectro): a virada segue segurada, sem o próximo turno.
    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'espectro-1')
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'telegraph')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Dreno total (~3,9s): encerramento + início liberados em ordem.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    avancar(DURACAO_ATAQUE_POR_ATACANTE_MS - DURACAO_DISPARO_ATAQUE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
  })

  it('início e encerramento segurados liberam em ordem ao drenar', async () => {
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

    // Virada completa com a fila ativa é segurada: nem a entrada nem a saída
    // da vez aplicam.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: 'jogador-2' }))
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)

    // Drenou: libera em ordem — o INICIADO entrou e o ENCERRADO fechou (sem ativo).
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS + DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-turno-ativo')).not.toBeInTheDocument()
  })

  it('snapshot mais novo cancela a fila e invalida fatias e segurados (sem regressão)', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
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
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: 'jogador-2' }))
    await act(async () => {})
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    // Fatia ainda não chegou: HUD intacto.
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')

    // Snapshot projeta a vez (autoridade), cancela a fila e invalida fatias e
    // segurados — a Baixa da fatia pendente nunca aplica.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: { ...snapshotComTabuleiro([VULTO_1, RETA_1], PEOES_BASE), jogadorAtivoId: 'jogador-3', rodada: 2 },
      }),
    )
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-3')
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()

    // Timers órfãos viram no-op: sem regressão da vez nem da Baixa.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS + DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    await act(async () => {})
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-3')
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(toquesDeEfeito()).toHaveLength(0)
  })

  it('payload legado sem pecasNoAlcance ativa o fallback sem quebra (com telegraph)', async () => {
    const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
    ativarTimersDoAtaque()

    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-vermelho'] }],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      }),
    )

    // Telegraph acende mesmo sem onda, sem quebra — e a fatia ainda não
    // aplicou (sanidade intacta, sem Baixa, sem anúncio).
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
    expect(avatarDoAdversario('jogador-2')).not.toHaveAttribute('data-em-baixa')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')
    expect(toquesDeEfeito()).toHaveLength(0)
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-atacante', 'vulto-1')
    expect(pecaNoEspelho('vulto-1')).toHaveAttribute('data-telegraph', 'true')

    // Sem onda, sem quebra: monstro soa após o pulso, fila drena.
    avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_VULTO, volume: VOLUME_BASE_SOM_VULTO })
    expect(screen.getByTestId('ataque-coreografia')).toHaveAttribute('data-estagio', 'ataque')
    expect(screen.queryAllByTestId('ataque-reacao')).toHaveLength(0)

    // Chegada: tremor (dono do alcance) + Baixa da fatia + anúncio.
    avancar(DURACAO_DISPARO_ATAQUE_MS)
    expect(toquesDeEfeito()).toHaveLength(2)
    expect(toquesDeEfeito()[1]).toMatchObject({ src: CAMINHO_SOM_TREMOR_ATAQUE })
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-em-baixa', 'true')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')

    avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
    expect(screen.queryByTestId('ataque-coreografia')).not.toBeInTheDocument()
    expect(pecaNoEspelho('vulto-1')).not.toHaveAttribute('data-telegraph')
  })

  it('prefers-reduced-motion: legenda estática, mas sons e bloqueio seguem o pacing', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    try {
      const ws = await partidaComTabuleiro([VULTO_1, RETA_1])
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

      // Legenda estática (sem `animate-*`, sem `animationDelay`); o telegraph
      // segue silencioso no pacing.
      const telegraphEstatico = screen.getByTestId('ataque-telegraph')
      expect(telegraphEstatico).toHaveTextContent('Vulto prepara ataque')
      expect(telegraphEstatico.className).not.toMatch(/animate-/)
      expect(toquesDeEfeito()).toHaveLength(0)

      // Sons seguem após o pulso: monstro, depois tremor na chegada.
      avancar(DURACAO_TELEGRAPH_ATAQUE_MS)
      expect(toquesDeEfeito()).toHaveLength(1)
      expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_VULTO })
      // Legenda estática do disparo + reação (sem animação nem stagger).
      const disparoEstatico = screen.getByTestId('ataque-disparo')
      expect(disparoEstatico).toHaveTextContent('Vulto ataca')
      expect(disparoEstatico.className).not.toMatch(/animate-/)
      const reacaoEstatica = screen.getByTestId('ataque-reacao')
      expect(reacaoEstatica).toHaveAttribute('data-reacao', 'tremor')
      expect(reacaoEstatica.className).not.toMatch(/animate-|ataque-tremor/)
      expect(reacaoEstatica.style.animationDelay).toBe('')
      avancar(DURACAO_DISPARO_ATAQUE_MS)
      expect(toquesDeEfeito()).toHaveLength(2)
      expect(toquesDeEfeito()[1]).toMatchObject({ src: CAMINHO_SOM_TREMOR_ATAQUE })

      // Bloqueio segue: turno segurado só libera ao drenar.
      act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
      await act(async () => {})
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
      avancar(DURACAO_BASE_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS)
      await act(async () => {})
      expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', 'jogador-2')
      expect(toquesDeEfeito()).toHaveLength(2)
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})

describe('coreografia pura do ataque — ordem, dono por alcance e fatias (issue #385)', () => {
  const contexto = {
    peaoPorJogador: {
      'jogador-2': 'peao-vermelho',
      'jogador-3': 'peao-azul',
    },
    peoes: [
      { peaoId: 'peao-vermelho', celula: { linha: 3, coluna: 4 } },
      { peaoId: 'peao-azul', celula: { linha: 5, coluna: 5 } },
    ],
    posicionadas: [
      { pecaId: 'vulto-1', celula: { linha: 3, coluna: 3 } },
      { pecaId: 'reta-1', celula: { linha: 3, coluna: 4 } },
      { pecaId: 'espectro-1', celula: { linha: 5, coluna: 4 } },
      { pecaId: 'curva-1', celula: { linha: 5, coluna: 5 } },
    ],
  }

  it('preserva a ordem de atacantes do wire (sem reordenar)', () => {
    const itens = coreografarAtaque(
      {
        atacantes: [
          { pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [], pecasNoAlcance: [] },
          { pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: [], pecasNoAlcance: [] },
          { pecaId: 'vulto-2', tipo: 'vulto', peoesNoAlcance: [], pecasNoAlcance: [] },
          { pecaId: 'espectro-2', tipo: 'espectro', peoesNoAlcance: [], pecasNoAlcance: [] },
        ],
        peoesAtingidos: [],
        protegidos: [],
        estadosAplicados: [],
      },
      contexto,
    )

    // Ordem do wire 1:1 (issue #385: "na ordem de atacantes") — Vulto antes
    // do Espectro anima sem quebrar.
    expect(itens.map((item) => item.pecaId)).toEqual([
      'vulto-1',
      'espectro-1',
      'vulto-2',
      'espectro-2',
    ])
  })

  it('deriva atingidos/protegidos por dono do alcance e fatia por slot (sem tocar no reducer)', () => {
    const itens = coreografarAtaque(
      {
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
        peoesAtingidos: ['peao-vermelho'],
        protegidos: ['jogador-3'],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      },
      contexto,
    )

    // Ordem do wire (Vulto primeiro) — dono e fatia por slot, sem reordenar.
    expect(itens).toHaveLength(2)
    expect(itens[0]!.pecaId).toBe('vulto-1')
    expect(itens[1]!.pecaId).toBe('espectro-1')
    // Dono do alcance: vermelho (atingido) só no Vulto, azul (protegido, não
    // atingido) só no Espectro.
    expect(itens[0]!.temAtingido).toBe(true)
    expect(itens[0]!.temProtegido).toBe(false)
    expect(itens[0]!.peoesAtingidos).toEqual(['peao-vermelho'])
    expect(itens[0]!.peoesProtegidos).toEqual([])
    expect(itens[1]!.temAtingido).toBe(false)
    expect(itens[1]!.temProtegido).toBe(true)
    expect(itens[1]!.peoesAtingidos).toEqual([])
    expect(itens[1]!.peoesProtegidos).toEqual(['peao-azul'])
    // Fatias: Vulto leva o resultante do vermelho; Espectro leva só o consumo
    // (sem vítimas no alcance dele).
    expect(itens[0]!.fatia).toEqual({
      tipo: 'vulto',
      estadosAplicados: [
        { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
      ],
      protegidos: [],
    })
    expect(itens[1]!.fatia).toEqual({
      tipo: 'espectro',
      estadosAplicados: [],
      protegidos: ['jogador-3'],
    })
  })

  it('peão no alcance de dois monstros é dono nos dois itens, com fatia em cada slot', () => {
    const itens = coreografarAtaque(
      {
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
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['curva-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 2, amedrontado: false },
        ],
      },
      contexto,
    )

    expect(itens[0]!.pecaId).toBe('vulto-1')
    expect(itens[1]!.pecaId).toBe('espectro-1')
    expect(itens[0]!.peoesAtingidos).toEqual(['peao-vermelho'])
    expect(itens[1]!.peoesAtingidos).toEqual(['peao-vermelho'])
    // O mesmo resultante aparece nas duas fatias (a redução mascara por tipo:
    // sanidade no slot Espectro, Baixa no slot Vulto).
    expect(itens[0]!.fatia.estadosAplicados).toHaveLength(1)
    expect(itens[1]!.fatia.estadosAplicados).toHaveLength(1)
  })

  it('protegido nos dois alcances revela o consumo só no primeiro slot (ordem do wire)', () => {
    const itens = coreografarAtaque(
      {
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
            peoesNoAlcance: ['peao-vermelho'],
            pecasNoAlcance: ['curva-1'],
          },
        ],
        peoesAtingidos: [],
        protegidos: ['jogador-2'],
        estadosAplicados: [],
      },
      contexto,
    )

    expect(itens[0]!.pecaId).toBe('vulto-1')
    expect(itens[0]!.fatia.protegidos).toEqual(['jogador-2'])
    expect(itens[0]!.temProtegido).toBe(true)
    // O segundo slot silencia a defesa (sem som duplo pelo mesmo consumo).
    expect(itens[1]!.fatia.protegidos).toEqual([])
    expect(itens[1]!.temProtegido).toBe(false)
    expect(itens[1]!.peoesProtegidos).toEqual([])
  })

  it('fallback legado sem pecasNoAlcance mantém dono, sons e fatia por slot', () => {
    const itens = coreografarAtaque(
      {
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-vermelho'] }],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
        ],
      },
      contexto,
    )

    expect(itens).toHaveLength(1)
    expect(itens[0]!.pecasNoAlcance).toEqual([])
    expect(itens[0]!.reacoes).toEqual([])
    expect(itens[0]!.temAtingido).toBe(true)
    expect(itens[0]!.peoesAtingidos).toEqual(['peao-vermelho'])
    expect(itens[0]!.fatia).toEqual({
      tipo: 'vulto',
      estadosAplicados: [
        { jogadorId: 'jogador-2', emBaixaIluminacao: true, sanidade: 3, amedrontado: false },
      ],
      protegidos: [],
    })
  })

  it('fallback defensivo sem peoesNoAlcance não quebra e rende alcance vazio (review PR #399, nit 1)', () => {
    // Payload malformado em runtime (`peoesNoAlcance` é obrigatório no
    // contrato, mas JS não garante): a fila não interrompe, sem vítimas.
    const eventoSemPeoes = {
      atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', pecasNoAlcance: ['reta-1'] }],
      peoesAtingidos: [],
      protegidos: [],
      estadosAplicados: [],
    } as unknown as Parameters<typeof coreografarAtaque>[0]

    let itens: ReturnType<typeof coreografarAtaque> = []
    expect(() => {
      itens = coreografarAtaque(eventoSemPeoes, contexto)
    }).not.toThrow()

    expect(itens).toHaveLength(1)
    expect(itens[0]!.temAtingido).toBe(false)
    expect(itens[0]!.peoesAtingidos).toEqual([])
    expect(itens[0]!.fatia.estadosAplicados).toEqual([])
  })

  it('onda varre as removidas do gatilho pela célula pré-limpeza (fix review PR #399)', () => {
    const itens = coreografarAtaque(
      {
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
        estadosAplicados: [],
      },
      contexto,
      ['reta-1', 'curva-1', 'espectro-1', 'fantasma-1', 'vulto-1'],
    )

    // O campo do item espelha o wire (sem as removidas); a onda as varre
    // junto: reta-1 (wire) não duplica; curva-1 e espectro-1 (pré-limpeza,
    // com e sem peão) entram; fantasma-1 (fora do tabuleiro) e vulto-1 (peça
    // do atacante) ficam de fora.
    expect(itens[0]!.pecasNoAlcance).toEqual(['reta-1'])
    expect(itens[0]!.reacoes.map((r) => r.pecaId)).toEqual(['reta-1', 'curva-1', 'espectro-1'])
    const reacaoDe = (pecaId: string): PecaReagindoNoAtaque =>
      itens[0]!.reacoes.find((r) => r.pecaId === pecaId)!
    expect(reacaoDe('reta-1').reacao).toBe('tremor')
    expect(reacaoDe('curva-1').reacao).toBe('tremor')
    expect(reacaoDe('espectro-1').reacao).toBe('pulo')
    // Camada toroidal real da célula pré-limpeza (não o índice de fallback).
    expect(reacaoDe('reta-1').camada).toBe(1)
    expect(reacaoDe('curva-1').camada).toBe(4)
    expect(reacaoDe('espectro-1').camada).toBe(3)
  })

  it('atacante nunca reage à própria onda (blindagem do wire)', () => {
    const itens = coreografarAtaque(
      {
        atacantes: [
          {
            pecaId: 'vulto-1',
            tipo: 'vulto',
            peoesNoAlcance: ['peao-vermelho'],
            // Wire hipotético listando o próprio atacante no alcance.
            pecasNoAlcance: ['vulto-1', 'reta-1'],
          },
        ],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [],
      },
      contexto,
    )

    // O slot existe (som + fila intactos), mas sem auto-reação.
    expect(itens).toHaveLength(1)
    expect(itens[0]!.pecasNoAlcance).toEqual(['vulto-1', 'reta-1'])
    expect(itens[0]!.reacoes.map((r) => r.pecaId)).toEqual(['reta-1'])
    expect(itens[0]!.temAtingido).toBe(true)
  })

  it('duração da fila soma telegraph por atacante (~2,3s/1, ~3,9s/2)', () => {
    expect(duracaoDaFilaDeAtaque(0)).toBe(0)
    expect(duracaoDaFilaDeAtaque(1)).toBe(
      DURACAO_BASE_ATAQUE_MS + DURACAO_TELEGRAPH_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS,
    )
    expect(duracaoDaFilaDeAtaque(2)).toBe(
      DURACAO_BASE_ATAQUE_MS + 2 * (DURACAO_TELEGRAPH_ATAQUE_MS + DURACAO_ATAQUE_POR_ATACANTE_MS),
    )
  })

  it('onda do Vulto é toroidal na borda (ADR-0012): atravessa para o lado oposto', () => {
    const contextoDeBorda = {
      peaoPorJogador: {},
      peoes: [],
      posicionadas: [
        { pecaId: 'vulto-1', celula: { linha: 0, coluna: 0 } },
        { pecaId: 'borda-coluna', celula: { linha: 0, coluna: 6 } },
        { pecaId: 'borda-linha', celula: { linha: 6, coluna: 0 } },
        { pecaId: 'borda-canto', celula: { linha: 6, coluna: 6 } },
        { pecaId: 'longe', celula: { linha: 0, coluna: 3 } },
      ],
    }
    const itens = coreografarAtaque(
      {
        atacantes: [
          {
            pecaId: 'vulto-1',
            tipo: 'vulto',
            peoesNoAlcance: [],
            pecasNoAlcance: ['borda-coluna', 'borda-linha', 'borda-canto', 'longe'],
          },
        ],
        peoesAtingidos: [],
        protegidos: [],
        estadosAplicados: [],
      },
      contextoDeBorda,
    )

    const camadaDe = (pecaId: string): number =>
      itens[0]!.reacoes.find((r) => r.pecaId === pecaId)!.camada
    // Vizinhas pelo wrap: 1 de distância, não 6.
    expect(camadaDe('borda-coluna')).toBe(1)
    expect(camadaDe('borda-linha')).toBe(1)
    expect(camadaDe('borda-canto')).toBe(2)
    // Interior mantém a distância direta.
    expect(camadaDe('longe')).toBe(3)
  })

  it('interior sem wrap preserva a distância direta (regressão Manhattan)', () => {
    const itens = coreografarAtaque(
      {
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
        estadosAplicados: [],
      },
      contexto,
    )

    const camadaDe = (pecaId: string): number =>
      itens[0]!.reacoes.find((r) => r.pecaId === pecaId)!.camada
    expect(camadaDe('reta-1')).toBe(1)
    expect(camadaDe('curva-1')).toBe(4)
  })
})
