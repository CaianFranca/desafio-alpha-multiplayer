import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeAudio,
} from './helpers/mockAudio'
import {
  CAMINHO_SOM_ASSENTO_ENCAIXE,
  CAMINHO_SOM_GIRO_ENCAIXE,
  VOLUME_BASE_SOM_DE_ASSENTO,
  VOLUME_BASE_SOM_DE_GIRO,
  origemDoEncaixe,
  tocarSomDeAssentoDoEncaixe,
  tocarSomDeGiroDoEncaixe,
} from '../web/src/components/partida/somDoEncaixe'
import { DURACAO_ENCAIXE_MS } from '../web/src/game/tabuleiro/animacao'
import {
  POSICAO_BANDEJA,
  PECA_Y,
  celulaParaMundo,
  inicialIndiceParaMundo,
} from '../web/src/game/tabuleiro/contrato'
import {
  posicaoMundoDaOrigemDoEncaixe,
  posicaoMundoDoDestinoDoEncaixe,
} from '../web/src/game/tabuleiro/encaixe'
import { criarEstadoInicialDoCliente } from '../web/src/game/tabuleiro/reducao'

// Encaixe de peça com sons (issue #241, spec #238 + mudança de spec verbal):
// transição mesa→célula disparada por PECA_POSICIONADA com SÓ o toque
// enigmático no assento, carta a cada PECA_GIRADA, snap com
// prefers-reduced-motion e silêncio sem asset.
// Comportamento externo via espelho DOM (jsdom não vê WebGL) + áudio mockado.

const JOGADOR_ID = mockAuthenticatedState.jogador.id

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

async function partidaDisponivel() {
  renderPartidaNaRota('/partida?serverId=server-1&partidaId=partida-1')
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: JOGADOR_ID,
      apelido: 'JogadorTeste',
      partidaId: 'partida-1',
      estado: 'em_andamento',
    }),
  )
  await screen.findByTestId('tabuleiro')
  return ws
}

function celulaDoEspelho(linha: number, coluna: number): HTMLElement {
  const celula = screen.getAllByTestId('tabuleiro-celula').find(
    (el) =>
      el.getAttribute('data-linha') === String(linha) &&
      el.getAttribute('data-coluna') === String(coluna),
  )
  if (!celula) throw new Error(`célula ${linha}:${coluna} não encontrada no espelho`)
  return celula
}

function pecaPosicionadaDoEspelho(pecaId: string): HTMLElement {
  const peca = screen
    .getAllByTestId('peca-posicionada')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)
  if (!peca) throw new Error(`peça ${pecaId} não encontrada no espelho`)
  return peca
}

function toquesPorSrc(src: string): readonly { src: string; volume: number }[] {
  return toquesDeAudio.filter((t) => t.src === src)
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('som do encaixe — origem pura estado anterior → mesa/bandeja (issue #241)', () => {
  it('Peça Inicial na mesa resolve origem mesa com o índice da grade', () => {
    const estado = criarEstadoInicialDoCliente()
    expect(origemDoEncaixe(estado, 'inicial-2')).toEqual({ origem: 'mesa', indiceNaMesa: 1 })
  })

  it('Peça Corrente da Bandeja (pendência) resolve origem bandeja', () => {
    const estado = {
      ...criarEstadoInicialDoCliente(),
      recebidasPendentes: [
        { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta' as const, vaga: null, celulaAlvo: null },
      ],
    }
    expect(origemDoEncaixe(estado, 'reta-1')).toEqual({ origem: 'bandeja', indiceNaMesa: null })
  })

  it('tipo já sorteado da Caixa sem pendência também é bandeja', () => {
    const estado = {
      ...criarEstadoInicialDoCliente(),
      iniciais: [],
      pecasDeRecebimento: { 'cruz-1': 'cruz' as const },
    }
    expect(origemDoEncaixe(estado, 'cruz-1')).toEqual({ origem: 'bandeja', indiceNaMesa: null })
  })

  it('peça desconhecida resolve null (sem voo; o evento ainda soa)', () => {
    expect(origemDoEncaixe(criarEstadoInicialDoCliente(), 'fantasma-9')).toBeNull()
  })
})

describe('som do encaixe — constantes centralizadas e toque (issue #241)', () => {
  it('duração parte de ~250ms e caminhos apontam aos assets servidos em /media/', () => {
    expect(DURACAO_ENCAIXE_MS).toBe(250)
    expect(CAMINHO_SOM_GIRO_ENCAIXE).toBe('/media/card-flick.wav')
    expect(CAMINHO_SOM_ASSENTO_ENCAIXE).toBe('/media/scary-sound.mp3')
  })

  it('giro toca a carta na base própria e assento toca o enigmático na dele (ADR-0007)', () => {
    tocarSomDeGiroDoEncaixe()
    tocarSomDeAssentoDoEncaixe()

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({
      src: CAMINHO_SOM_GIRO_ENCAIXE,
      volume: VOLUME_BASE_SOM_DE_GIRO,
    })
    expect(toquesDeAudio[1]).toMatchObject({
      src: CAMINHO_SOM_ASSENTO_ENCAIXE,
      volume: VOLUME_BASE_SOM_DE_ASSENTO,
    })
    // Mudança de spec: carta cai pela metade, enigmático mantém.
    expect(VOLUME_BASE_SOM_DE_GIRO).toBe(0.35)
    expect(VOLUME_BASE_SOM_DE_ASSENTO).toBe(0.7)
  })

  it('falha de play() não quebra (silêncio sem erro)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarSomDeGiroDoEncaixe()).not.toThrow()
    // O toque foi registrado (src/volume); a rejeição foi engolida.
    expect(toquesDeAudio).toHaveLength(1)
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarSomDeAssentoDoEncaixe()).not.toThrow()
  })
})

describe('geometria do voo — origem e destino mundo (issue #241)', () => {
  it('destino termina na transformada exata da Celula (pixel-igual ao assentado)', () => {
    const [x, y, z] = celulaParaMundo({ linha: 3, coluna: 3 })
    expect(posicaoMundoDoDestinoDoEncaixe({ linha: 3, coluna: 3 })).toEqual([x, y + PECA_Y, z])
  })

  it('origem mesa resolve pela grade 2×2 das Iniciais', () => {
    const [x, y, z] = inicialIndiceParaMundo(0)
    expect(posicaoMundoDaOrigemDoEncaixe('mesa', 0)).toEqual([x, y + 0.02, z])
  })

  it('origem bandeja é o slot único da Caixa', () => {
    expect(posicaoMundoDaOrigemDoEncaixe('bandeja', null)).toEqual([
      POSICAO_BANDEJA[0],
      POSICAO_BANDEJA[1] + 0.02,
      POSICAO_BANDEJA[2],
    ])
  })
})

describe('som do giro — carta a cada PECA_GIRADA (issue #241, mudança de spec)', () => {
  it('PECA_GIRADA toca a carta 1x a 0.35 e reduz no modelo', async () => {
    const ws = await partidaDisponivel()

    act(() =>
      ws.simulateMessage({
        type: 'PECA_GIRADA',
        pecaId: 'inicial-1',
        orientacaoAnterior: 0,
        orientacao: 90,
        sentido: 'horario',
      }),
    )

    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(1)
    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)[0]).toMatchObject({
      volume: VOLUME_BASE_SOM_DE_GIRO,
    })
    // Giro não é posicionamento: nenhum enigmático.
    expect(toquesPorSrc(CAMINHO_SOM_ASSENTO_ENCAIXE)).toHaveLength(0)
  })

  it('giros distintos em sequência soam múltiplo (cada giro é uma ação distinta)', async () => {
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({
        type: 'PECA_GIRADA',
        pecaId: 'inicial-1',
        orientacaoAnterior: 0,
        orientacao: 90,
        sentido: 'horario',
      })
      ws.simulateMessage({
        type: 'PECA_GIRADA',
        pecaId: 'inicial-1',
        orientacaoAnterior: 90,
        orientacao: 180,
        sentido: 'horario',
      })
    })

    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(2)
  })

  it('falha de play() no giro: silêncio sem erro', async () => {
    const ws = await partidaDisponivel()

    armarFalhaNoProximoPlay()
    expect(() =>
      act(() =>
        ws.simulateMessage({
          type: 'PECA_GIRADA',
          pecaId: 'inicial-1',
          orientacaoAnterior: 0,
          orientacao: 90,
          sentido: 'horario',
        }),
      ),
    ).not.toThrow()
    // O giro foi tentado (toque registrado); a rejeição foi engolida.
    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(1)
    await Promise.resolve()
  })
})

describe('encaixe na tela — voo, sons e estado final (issue #241)', () => {
  it('PECA_POSICIONADA da Inicial: voa da mesa, soa SÓ o enigmático e termina no estado certo', async () => {
    const ws = await partidaDisponivel()
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(4)

    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )

    // Voo espelhado: peça em voo com origem mesa…
    const peca = pecaPosicionadaDoEspelho('inicial-1')
    expect(peca.getAttribute('data-em-voo')).toBe('true')
    expect(peca.getAttribute('data-origem-encaixe')).toBe('mesa')
    // …estado final igual ao sem animação: tipo preservado, célula ocupada,
    // Inicial consumida da mesa.
    expect(peca.getAttribute('data-tipo')).toBe('inicial')
    expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('true')
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(3)

    // Sem carta no posicionamento (mudança de spec: carta vive no giro)…
    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(0)
    // …toque enigmático no assento (após a duração do voo).
    await waitFor(() =>
      expect(toquesPorSrc(CAMINHO_SOM_ASSENTO_ENCAIXE)).toHaveLength(1),
    )
    expect(toquesPorSrc(CAMINHO_SOM_ASSENTO_ENCAIXE)[0]).toMatchObject({
      volume: VOLUME_BASE_SOM_DE_ASSENTO,
    })
  })

  it('PECA_POSICIONADA da Bandeja: voa da bandeja com o tipo sorteado', async () => {
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta', vaga: null, celulaAlvo: null },
        ],
      })
    })
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      }),
    )

    const peca = pecaPosicionadaDoEspelho('reta-1')
    expect(peca.getAttribute('data-em-voo')).toBe('true')
    expect(peca.getAttribute('data-origem-encaixe')).toBe('bandeja')
    expect(peca.getAttribute('data-tipo')).toBe('reta')
    expect(celulaDoEspelho(2, 3).getAttribute('data-ocupada')).toBe('true')

    expect(toquesPorSrc(CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(0)
    await waitFor(() =>
      expect(toquesPorSrc(CAMINHO_SOM_ASSENTO_ENCAIXE)).toHaveLength(1),
    )
  })

  it('prefers-reduced-motion: snap instantâneo pixel-igual, sem voo, com SÓ o enigmático', async () => {
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
      const ws = await partidaDisponivel()
      act(() =>
        ws.simulateMessage({
          type: 'PECA_POSICIONADA',
          pecaId: 'inicial-1',
          celula: { linha: 3, coluna: 3 },
          orientacao: 0,
        }),
      )

      // Snap: estado final imediato, sem peça em voo.
      const peca = pecaPosicionadaDoEspelho('inicial-1')
      expect(peca.hasAttribute('data-em-voo')).toBe(false)
      expect(peca.getAttribute('data-tipo')).toBe('inicial')
      expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('true')
      expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(3)

      // Só o enigmático imediato (sem espera pela duração do voo; a carta
      // vive no giro, fora deste branch).
      expect(toquesDeAudio.map((t) => t.src)).toEqual([
        CAMINHO_SOM_ASSENTO_ENCAIXE,
      ])
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('asset ausente: silêncio sem erro, assento chega em seguida', async () => {
    const ws = await partidaDisponivel()

    armarFalhaNoProximoPlay()
    expect(() =>
      act(() =>
        ws.simulateMessage({
          type: 'PECA_POSICIONADA',
          pecaId: 'inicial-1',
          celula: { linha: 3, coluna: 3 },
          orientacao: 0,
        }),
      ),
    ).not.toThrow()
    // O assento foi tentado (toque registrado); a rejeição foi engolida.
    await waitFor(() =>
      expect(toquesPorSrc(CAMINHO_SOM_ASSENTO_ENCAIXE)).toHaveLength(1),
    )

    expect(pecaPosicionadaDoEspelho('inicial-1').getAttribute('data-em-voo')).toBe('true')
  })

  it('sem regressão: cliques e câmera intactos após o encaixe', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )
    await screen.findByTestId('peca-posicionada')

    // Câmera/estrutura: canvas sob moldura, grade 7×7 e os 4 peões.
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('ambiente-canvas-fallback')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
    expect(screen.getAllByTestId('tabuleiro-celula')).toHaveLength(49)
    expect(screen.getAllByTestId('peao')).toHaveLength(4)

    // Cliques: Inicial restante ainda seleciona (fallback ST-09 com jogadorId).
    const inicial2 = screen
      .getAllByTestId('mesa-peca-inicial')
      .find((el) => el.getAttribute('data-peca-id') === 'inicial-2')
    expect(inicial2).toBeDefined()
    await user.click(inicial2!)
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'SELECIONAR_PECA',
        pecaId: 'inicial-2',
        jogadorId: JOGADOR_ID,
      })
    })
  })
})
