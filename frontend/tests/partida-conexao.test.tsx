import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { toquesDeAudio } from './helpers/mockAudio'
import {
  CAMINHO_SOM_DE_RECUSA,
  VOLUME_BASE_SOM_DE_RECUSA,
} from '../web/src/components/partida/somDeRecusa'
import {
  CAMINHO_SOM_MOVIMENTO_ENCAIXE,
  CAMINHO_SOM_GIRO_ENCAIXE,
  VOLUME_BASE_SOM_DE_MOVIMENTO,
} from '../web/src/components/partida/somDoEncaixe'
import { CAMINHO_SOM_SOMBRIO_LIMPEZA } from '../web/src/game/tabuleiro/animacao'
import type { EstadoDaPartidaSnapshot, PecaPosicionadaNoSnapshot } from '@flicker/shared'

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
      { jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90', apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    // Explícito: o spread de overrides é Partial e pode não cobrir o campo,
    // deixando `resultado` undefined na cópia (quebra o typecheck em tsc -b).
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...overrides,
  }
}

async function partidaDisponivel(entry: string) {
  renderPartidaNaRota(entry)
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
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

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida conectada ao game-server (issue #85)', () => {
  it('sem alvo (URL sem serverId/partidaId) mostra tela de falha', () => {
    renderPartidaNaRota('/partida')
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('admissão aceita em_andamento leva de carregando para disponível (cena montada)', async () => {
    renderPartidaNaRota('/partida?serverId=server-1&partidaId=partida-1')
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()

    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: 'jogador-1',
        apelido: 'Ana',
        partidaId: 'partida-1',
        estado: 'em_andamento',
      }),
    )

    expect(await screen.findByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('evento de posicionamento atualiza o espelho DOM sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Issue #143: a mesa nasce com as 4 Peças Iniciais (seed determinístico).
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(4)
    expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(0)

    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )

    expect(await screen.findAllByTestId('peca-posicionada')).toHaveLength(1)
    // A inicial encaixada sai da mesa sem recarregar.
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(3)
  })

  it('rotação por tecla R envia GIRAR_PECA para a peça em manipulação ao WS', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Posiciona inicial-1 → abre janela de manipulação.
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )
    await screen.findByTestId('peca-posicionada')

    // Os controles de giro são 3D (overlay) — o atalho R do teclado mantém o
    // caminho de teste DOM para o wire (a cena WebGL é caixa-preta no jsdom).
    const user = userEvent.setup()
    await user.keyboard('r')

    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'GIRAR_PECA',
        pecaId: 'inicial-1',
        sentido: 'horario',
        // Injeção única de jogadorId (issue #91): todo comando do canal da
        // Partida carrega o jogador autenticado (mock-auth).
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
      })
    })
  })

  it('ERRO_DO_TABULEIRO toca som de recusa e anuncia, sem clarão', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Aprovação → silêncio: sem som, sem clarão, sem anúncio.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    await screen.findByTestId('tabuleiro')
    expect(toquesDeAudio).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa')).toHaveTextContent('')
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    // Rejeição → som de recusa com motivo + anúncio, sem clarão.
    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PECA_NAO_RECEBIDA',
        mensagem: 'Peças de caminho só entram pelo Recebimento.',
      }),
    )
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_DE_RECUSA, volume: VOLUME_BASE_SOM_DE_RECUSA })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('rejeicao_do_servico')
    expect(anuncio).toHaveTextContent('Ação recusada.')
  })

  it('recusas sucessivas tocam o som a cada vez, sem clarão', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Aprovações sucessivas seguem em silêncio.
    act(() => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' })
    })
    act(() => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-2' })
    })
    expect(toquesDeAudio).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    // Cada recusa toca uma vez, com seu motivo; o anúncio acompanha a última.
    act(() => {
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PECA_NAO_RECEBIDA',
        mensagem: 'Peças de caminho só entram pelo Recebimento.',
      })
    })
    act(() => {
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'FORA_DA_VEZ',
        mensagem: 'Não é a sua vez.',
      })
    })
    expect(toquesDeAudio).toHaveLength(2)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe('fora_da_vez')
  })

  it('recusa repetida com o mesmo motivo re-anuncia (região viva remonta por key)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    const recusarForaDaVez = () =>
      act(() => {
        ws.simulateMessage({
          type: 'ERRO_DO_TABULEIRO',
          codigo: 'FORA_DA_VEZ',
          mensagem: 'Não é a sua vez.',
        })
      })

    recusarForaDaVez()
    expect(toquesDeAudio).toHaveLength(1)
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('fora_da_vez')
    expect(anuncio).toHaveTextContent('Ação recusada: aguarde a sua vez.')
    const primeiroId = anuncio.getAttribute('data-anuncio-id')
    expect(primeiroId).not.toBeNull()

    // Mesmo motivo de novo: o som toca outra vez e a região viva re-emite
    // (novo id = remontagem por key; sem isso o texto idêntico calaria o
    // segundo anúncio para o leitor de tela).
    recusarForaDaVez()
    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[1]).toMatchObject({
      src: CAMINHO_SOM_DE_RECUSA,
      volume: VOLUME_BASE_SOM_DE_RECUSA,
    })
    const anuncioRepetido = screen.getByTestId('anuncio-de-recusa')
    expect(anuncioRepetido.getAttribute('data-motivo')).toBe('fora_da_vez')
    expect(anuncioRepetido).toHaveTextContent('Ação recusada: aguarde a sua vez.')
    expect(anuncioRepetido.getAttribute('data-anuncio-id')).not.toBeNull()
    expect(anuncioRepetido.getAttribute('data-anuncio-id')).not.toBe(primeiroId)
  })

  it('retry com alvo na URL transita de falha para carregando', async () => {
    const user = userEvent.setup()
    renderPartidaNaRota('/partida?serverId=server-1&partidaId=partida-1')
    
    // Simula falha imediata (ex.: socket não abre)
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    act(() => {
      MockWebSocket.last()!.onerror!(new Event('error'))
    })
    
    expect(await screen.findByTestId('overlay-falha')).toBeInTheDocument()
    
    await user.click(screen.getByTestId('partida-tentar-novamente'))
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
  })

  it('overlay de giro 3D: presente apenas com peça em manipulação (pós-encaixe)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // 1. Sem nada selecionado: sem overlay emitido (a cena 3D é caixa-preta
    // no jsdom; o seam data-manipulacao espelha a mesma fonte).
    const semJanela = () =>
      screen.queryAllByTestId('peca-posicionada').some((el) => el.hasAttribute('data-manipulacao'))
    expect(semJanela()).toBe(false)

    // 2. Seleciona (ainda não posiciona): o overlay só existe pós-encaixe —
    //    a peça selecionada da mesa não recebe controles (rotação pré-encaixe
    //    permanece só por teclas R/E).
    act(() => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' })
    })
    expect(semJanela()).toBe(false)

    // 3. Posiciona: abre manípulação → data-manipulacao liga na peça.
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
    })
    const comManipulacao = () =>
      screen
        .getAllByTestId('peca-posicionada')
        .find((el) => el.getAttribute('data-peca-id') === 'inicial-1')
        ?.getAttribute('data-manipulacao')
    await waitFor(() => expect(comManipulacao()).toBe('true'))

    // 4. Finaliza: manipulação e seleção nulas → overlay some.
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })
    // Atributo ausente → getAttribute devolve null (elemento permanece no DOM).
    expect(comManipulacao()).toBeNull()
  })

  it('envia apenas comandos Partida com jogadorId (hook restrito)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    const user = userEvent.setup()
    // Tenta posicionar via clique vazio -> deve enviar POSICIONAR_PECA com jogadorId
    const celula = celulaDoEspelho(3, 3)
    await user.click(celula)
    await waitFor(() => {
      const parsed = ws.sentMessages.map((m) => JSON.parse(m))
      expect(parsed.length).toBeGreaterThan(0)
      for (const cmd of parsed) {
        expect(cmd.jogadorId).toBe('5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90')
        expect(typeof cmd.type).toBe('string')
      }
    })
  })
})

describe('iluminação e limpeza no cliente via WebSocket (issue #151)', () => {
  it('CELULAS_ILUMINADAS distingue as células iluminadas no espelho DOM sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Estado inicial: nenhuma célula iluminada.
    expect(
      screen
        .getAllByTestId('tabuleiro-celula')
        .filter((el) => el.getAttribute('data-iluminada') === 'true'),
    ).toHaveLength(0)

    act(() =>
      ws.simulateMessage({
        type: 'CELULAS_ILUMINADAS',
        celulas: [
          { linha: 2, coluna: 3 },
          { linha: 4, coluna: 5 },
        ],
      }),
    )

    // data-iluminada="true" exatamente nas células certas (mesma fonte cena/espelho).
    const iluminadas = screen
      .getAllByTestId('tabuleiro-celula')
      .filter((el) => el.getAttribute('data-iluminada') === 'true')
    expect(iluminadas).toHaveLength(2)
    expect(
      iluminadas.map((el) => `${el.getAttribute('data-linha')}:${el.getAttribute('data-coluna')}`),
    ).toEqual(['2:3', '4:5'])
    // Iluminação NÃO produz flash (decisão do plano).
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    // Sem reload/reconexão: o mesmo socket atende tudo, nenhum comando enviado.
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(ws.sentMessages).toHaveLength(0)

    // Evento seguinte substitui o conjunto inteiro (o cliente não acumula).
    act(() =>
      ws.simulateMessage({
        type: 'CELULAS_ILUMINADAS',
        celulas: [{ linha: 0, coluna: 0 }],
      }),
    )
    const reIluminadas = screen
      .getAllByTestId('tabuleiro-celula')
      .filter((el) => el.getAttribute('data-iluminada') === 'true')
    expect(reIluminadas).toHaveLength(1)
    expect(reIluminadas[0]).toBe(celulaDoEspelho(0, 0))
  })

  it('LIMPEZA_APLICADA remove a peça da cena, libera a célula, e aceita novo posicionamento sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Posiciona inicial-1 em 3:3 via broadcast (mesma via dos eventos de #85).
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )
    await screen.findByTestId('peca-posicionada')
    expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('true')

    // Encaixe com sons (issue #241 + mudanças de spec): posicionamento sem
    // carta (a carta vive no giro) — o enigmático sai de imediato no início
    // do movimento, sem clarão.
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_GIRO_ENCAIXE)).toHaveLength(0)
    expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_MOVIMENTO_ENCAIXE)).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({
      src: CAMINHO_SOM_MOVIMENTO_ENCAIXE,
      volume: VOLUME_BASE_SOM_DE_MOVIMENTO,
    })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    // A Limpeza chega pelo MESMO socket — sem recarregar página, sem reconectar.
    act(() =>
      ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] }),
    )

    // A peça removida some do espelho e a célula volta a estar livre.
    await waitFor(() =>
      expect(screen.queryByTestId('peca-posicionada')).not.toBeInTheDocument(),
    )
    expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('false')

    // Limpeza com som único (issue #239): um toque sombrio por comando, sem clarão
    // (filtrado por asset: os sons do Encaixe da #241 convivem no mesmo array).
    await waitFor(() =>
      expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(1),
    )
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    // Célula liberada aceita novo posicionamento pela mesma via dos testes de
    // interação: seleção via broadcast + clique no espelho → POSICIONAR_PECA no WS.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'reta-1' }))
    const user = userEvent.setup()
    await user.click(celulaDoEspelho(3, 3))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'POSICIONAR_PECA',
        pecaId: 'reta-1',
        celula: { linha: 3, coluna: 3 },
        jogadorId: mockAuthenticatedState.jogador.id,
      })
    })
    // A mesma conexão sobreviveu a todo o fluxo (nenhum socket novo).
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('LIMPEZA_APLICADA com N peças toca exatamente 1 som por comando, qualquer quantidade', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Prepara 3 peças posicionadas via deltas
    act(() => {
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 1, coluna: 1 }, orientacao: 0 })
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'inicial-2', celula: { linha: 1, coluna: 2 }, orientacao: 0 })
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'inicial-3', celula: { linha: 1, coluna: 3 }, orientacao: 0 })
    })
    await waitFor(() => expect(screen.getAllByTestId('peca-posicionada')).toHaveLength(3))

    act(() =>
      ws.simulateMessage({
        type: 'LIMPEZA_APLICADA',
        pecasRemovidas: ['inicial-1', 'inicial-2', 'inicial-3'],
      }),
    )

    await waitFor(() => expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(0))
    // Exatamente 1 som de limpeza por comando, mesmo com N=3 (nunca um por
    // peça) — filtrado por asset: os sons do Encaixe da #241 convivem no mesmo array.
    await waitFor(() =>
      expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(1),
    )
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    // Células liberadas
    expect(celulaDoEspelho(1, 1).getAttribute('data-ocupada')).toBe('false')
    expect(celulaDoEspelho(1, 2).getAttribute('data-ocupada')).toBe('false')
    expect(celulaDoEspelho(1, 3).getAttribute('data-ocupada')).toBe('false')
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('LIMPEZA_APLICADA com prefers-reduced-motion faz snap instantâneo mas ainda toca 1 som', async () => {
    const originalMatchMedia = window.matchMedia
    // Mock reduce = true antes de montar a PartidaPage
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
      const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')
      act(() =>
        ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 }),
      )
      await screen.findByTestId('peca-posicionada')
      // Encaixe com reduce = snap (issue #241 + mudança de spec): sem voo,
      // estado final imediato e SÓ o enigmático (a carta vive no giro).
      expect(toquesDeAudio.map((t) => t.src)).toEqual([
        CAMINHO_SOM_MOVIMENTO_ENCAIXE,
      ])

      act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] }))

      // Snap instantâneo: peça some sem precisar de animação, estado final pixel-igual
      await waitFor(() => expect(screen.queryByTestId('peca-posicionada')).not.toBeInTheDocument())
      expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('false')
      // Som único de limpeza mesmo com reduce ativo (ordem total determinística).
      await waitFor(() => expect(toquesDeAudio).toHaveLength(2))
      expect(toquesDeAudio.map((t) => t.src)).toEqual([
        CAMINHO_SOM_MOVIMENTO_ENCAIXE,
        CAMINHO_SOM_SOMBRIO_LIMPEZA,
      ])
      expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('fade+encolher termina sem resíduos — peça removida desaparece e célula fica livre para reuso', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    act(() =>
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 2, coluna: 2 }, orientacao: 0 }),
    )
    await screen.findByTestId('peca-posicionada')
    expect(celulaDoEspelho(2, 2).getAttribute('data-ocupada')).toBe('true')

    act(() => ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] }))

    // Após LIMPEZA_APLICADA o reducer já filtra, e TransicaoLimpeza faz o fade
    // com lerp scale 1→0.7 e opacity 0.88→0 terminando sem resíduos (onFim remove fantasma)
    await waitFor(() => expect(screen.queryByTestId('peca-posicionada')).not.toBeInTheDocument())
    expect(celulaDoEspelho(2, 2).getAttribute('data-ocupada')).toBe('false')

    // Reuso imediato da célula liberada prova que não há resíduo lógico nem visual
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'reta-1' }))
    const user = userEvent.setup()
    await user.click(celulaDoEspelho(2, 2))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'POSICIONAR_PECA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 2 },
        jogadorId: mockAuthenticatedState.jogador.id,
      })
    })
    // A limpeza tocou seu som único (filtrado por asset: o Encaixe da #241
    // convive no mesmo array).
    await waitFor(() =>
      expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_SOMBRIO_LIMPEZA)).toHaveLength(1),
    )
  })
})

describe('turnos no cliente — rodada, destaque do ativo e botões por fase (issue #118)', () => {
  // Jogador autenticado do mock-auth (mesmo id das injeções de comando).
  const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

  afterEach(() => {
    MockWebSocket.clean()
  })

  function peaoDoEspelho(peaoId: string): HTMLElement | undefined {
    return screen
      .getAllByTestId('peao')
      .find((el) => el.getAttribute('data-peao-id') === peaoId)
  }

  it('TURNO_INICIADO exibe botões só na vez do jogador (HUD oculto sem snapshot)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Sem snapshot o HUD fica oculto (issue #226: sem dados inventados) e sem
    // botões de turno.
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    expect(screen.queryByTestId('controles-de-turno')).not.toBeInTheDocument()

    // Minha vez (rodada 2): fase "sem movimento" → Permanecer, desabilitado
    // enquanto o peão próprio não é aprendido. O HUD segue oculto (TURNO não
    // carrega jogadores — só o snapshot projeta jogadorPorId).
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })
    })
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    expect(screen.getByTestId('botao-permanecer')).toBeDisabled()

    // Primeiro evento de peão da janela aprende o mapa → destaque do ativo e
    // botão habilitado (política: sem peaoId resolvido, não dispara comando).
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_PERMANECEU',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
      })
    })
    expect(screen.getByTestId('botao-permanecer')).not.toBeDisabled()
    const branco = peaoDoEspelho('peao-branco')
    expect(branco?.getAttribute('data-ativo')).toBe('true')
    const azul = peaoDoEspelho('peao-azul')
    expect(azul?.getAttribute('data-ativo')).toBe('false')

    // Vez de outro jogador: nenhum botão de ação; HUD segue oculto sem snapshot.
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 })
    })
    expect(screen.queryByTestId('controles-de-turno')).not.toBeInTheDocument()
    expect(screen.queryByTestId('botao-permanecer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
  })

  it('Primeiro Turno (rodada 1) sem peão posicionado não mostra Permanecer/Confirmar; com colocação completa mostra Encerrar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 1 })
    })
    // Peão do ativo ainda sobre a Mesa: nenhum botão de turno.
    await waitFor(() =>
      expect(screen.queryByTestId('controles-de-turno')).not.toBeInTheDocument(),
    )

    // Peão posicionado e sem pendências no wire → colocação completa →
    // Encerrar Turno (sem Permanecer/Confirmar no Primeiro Turno).
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_POSICIONADO',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
      })
    })
    expect(await screen.findByTestId('botao-encerrar-turno')).toBeInTheDocument()
    expect(screen.queryByTestId('botao-permanecer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('botao-confirmar-posicao')).not.toBeInTheDocument()
  })

  it('fluxo por fase: Permanecer → Confirmar Posição → Encerrar Turno envia comandos wire com jogadorId', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Minha vez (rodada 2) com o peão próprio aprendido.
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })
    })
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_PERMANECEU',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
      })
    })

    // Fase sem movimento: botão sem seleção prévia faz 1-clique
    // (SELECIONAR_PEAO e, ao chegar o ack PEAO_SELECIONADO, PERMANECER).
    // PEAO_PERMANECEU acima limpa a seleção (reducao.ts), então o botão parte
    // sem seleção — antes do fix ele enviava PERMANECER direto e o servidor
    // rejeitava com PEAO_NAO_SELECIONADO.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('botao-permanecer'))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'SELECIONAR_PEAO',
        peaoId: 'peao-branco',
        jogadorId: MEU_JOGADOR_ID,
      })
    })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'PERMANECER',
        peaoId: 'peao-branco',
        jogadorId: MEU_JOGADOR_ID,
      })
    })

    // Depois de PEAO_MOVIDO: Confirmar Posição → CONFIRMAR_POSICAO_DO_PEAO.
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 2, coluna: 3 },
      })
    })
    await waitFor(() =>
      expect(screen.queryByTestId('botao-permanecer')).not.toBeInTheDocument(),
    )
    await user.click(screen.getByTestId('botao-confirmar-posicao'))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'CONFIRMAR_POSICAO_DO_PEAO',
        peaoId: 'peao-branco',
        jogadorId: MEU_JOGADOR_ID,
      })
    })

    // Depois de POSICAO_CONFIRMADA: Encerrar Turno → ENCERRAR_TURNO.
    act(() => {
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      })
    })
    await waitFor(() =>
      expect(screen.queryByTestId('botao-confirmar-posicao')).not.toBeInTheDocument(),
    )
    await user.click(screen.getByTestId('botao-encerrar-turno'))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'ENCERRAR_TURNO',
        jogadorId: MEU_JOGADOR_ID,
      })
    })
  })

  it('Permanecer com peão desselecionado (rodada 2+) auto-seleciona o peão da vez e permanece (review #338)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Minha vez (rodada 2), peão próprio aprendido mas DESELECIONADO (o fim
    // do turno anterior deseleciona — PEAO_PERMANECEU limpa a seleção).
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 })
    })
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_PERMANECEU',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
      })
    })

    // Um clique no botão emite SELECIONAR_PEAO + PERMANECER em ordem, com o
    // peão da vez (não o PERMANECER cru, que o engine recusaria).
    const user = userEvent.setup()
    await user.click(screen.getByTestId('botao-permanecer'))
    await waitFor(() => {
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2)
    })
    expect(ws.sentMessages.slice(-2).map((m) => JSON.parse(m))).toEqual([
      { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco', jogadorId: MEU_JOGADOR_ID },
      { type: 'PERMANECER', peaoId: 'peao-branco', jogadorId: MEU_JOGADOR_ID },
    ])
  })

  it('Espaço com manipulação aberta equivale ao OK do overlay 3D (a11y, review #338)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Posiciona inicial-1 → abre janela de manipulação.
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      }),
    )
    await screen.findByTestId('peca-posicionada')

    const user = userEvent.setup()
    await user.keyboard(' ')

    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'FINALIZAR_MANIPULACAO',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
      })
    })
  })

  it('ERRO_DO_TABULEIRO FORA_DA_VEZ toca som de recusa com motivo e anuncia (issue #118)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    act(() => {
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'FORA_DA_VEZ',
        mensagem: 'Não é a sua vez.',
      })
    })
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_DE_RECUSA, volume: VOLUME_BASE_SOM_DE_RECUSA })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('fora_da_vez')
    expect(anuncio).toHaveTextContent('Ação recusada: aguarde a sua vez.')
  })
})

describe('partida snapshot e admissão por estado (issue #156)', () => {
  it('admissão preparada leva para aguardando; PARTIDA_INICIADA promove para disponivel', async () => {
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
        apelido: 'JogadorTeste',
        partidaId: 'p',
        estado: 'preparada',
      }),
    )
    expect(await screen.findByTestId('overlay-aguardando')).toBeInTheDocument()
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()

    act(() => ws.simulateMessage({ type: 'PARTIDA_INICIADA', partidaId: 'p' }))
    expect(await screen.findByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-aguardando')).not.toBeInTheDocument()
  })

  it('TURNO_INICIADO/POSICAO_CONFIRMADA avulsos não promovem a tela (só snapshot/PARTIDA_INICIADA)', async () => {
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
        apelido: 'JogadorTeste',
        partidaId: 'p',
        estado: 'preparada',
      }),
    )
    expect(await screen.findByTestId('overlay-aguardando')).toBeInTheDocument()

    // Promoção secundária por turno foi removida da descrição da PR: eventos
    // de turno sem snapshot/ESTADO_DA_PARTIDA não podem abrir o tabuleiro.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 1 }))
    act(() => ws.simulateMessage({ type: 'TURNO_ENCERRADO', jogadorId: 'jogador-2' }))
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
        pecaId: 'inicial-2',
      }),
    )
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
    expect(screen.getByTestId('overlay-aguardando')).toBeInTheDocument()
  })

  it('admissão em_andamento vai direto para disponivel', async () => {
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
        apelido: 'JogadorTeste',
        partidaId: 'p',
        estado: 'em_andamento',
      }),
    )
    expect(await screen.findByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('ESTADO_DA_PARTIDA popula tabuleiro e chip do jogador ativo', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')

    const snapshot = criarSnapshotBase({
      tabuleiro: {
        posicionadas: [
          { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
          { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 3, coluna: 4 } },
        ],
        iniciais: [],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
          { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
          { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
          { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
        ],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        pecasRestantesNaCaixa: 57,
      },
      jogadores: [
        { jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90', apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      ],
      jogadorAtivoId: 'jogador-2',
      rodada: 2,
      celulasIluminadas: [{ linha: 3, coluna: 3 }],
    })

    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))

    // Duas peças posicionadas
    expect(await screen.findAllByTestId('peca-posicionada')).toHaveLength(2)
    // Turno no HUD com a vez da Ana (jogadora ativa do snapshot)
    const turnoAtivo = await screen.findByTestId('hud-turno-ativo')
    expect(turnoAtivo).toHaveAttribute('data-jogador-id', 'jogador-2')
    expect(turnoAtivo).toHaveAttribute('aria-label', 'Vez de Ana')
    // Peão ativo marcado no espelho
    const peaoVermelho = screen.getAllByTestId('peao').find((el) => el.getAttribute('data-peao-id') === 'peao-vermelho')
    expect(peaoVermelho?.getAttribute('data-ativo')).toBe('true')
  })

  it('ESTADO_DA_PARTIDA com iniciais reconstrói a mesa sem recarregar (issue #143)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')

    // A mesa local nasce com o seed (4 iniciais); o snapshot é a autoridade:
    // inicial-1 já foi posicionada e as demais carregam orientação própria.
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(4)

    const snapshot = criarSnapshotBase({
      tabuleiro: {
        posicionadas: [
          { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        ],
        iniciais: [
          { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
          { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 90 },
          { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0 },
        ],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
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
    })
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))

    // Reconstrução pela mesma conexão: sem socket novo, sem reload.
    const iniciais = await screen.findAllByTestId('mesa-peca-inicial')
    expect(iniciais.map((el) => el.getAttribute('data-peca-id'))).toEqual([
      'inicial-2',
      'inicial-3',
      'inicial-4',
    ])
    expect(screen.getAllByTestId('peca-posicionada')).toHaveLength(1)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('TURNO_INICIADO atualiza o destaque do Turno no HUD (snapshot + TURNO)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    const snapshot = criarSnapshotBase()
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))
    // Jogador local (autenticado) com sanidade cheia: retrato + barra 3/3.
    const local = await screen.findByTestId('hud-jogador-local')
    expect(local).toHaveAttribute('data-jogador-id', '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90')
    expect(screen.getByTestId('hud-sanidade')).toHaveAttribute('data-sanidade', '3')
    expect(
      screen.getAllByTestId('hud-sanidade-segmento').filter((el) => el.getAttribute('data-preenchido') === 'true'),
    ).toHaveLength(3)
    expect(await screen.findByTestId('hud-turno-ativo')).toHaveAttribute(
      'data-jogador-id',
      '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
    )

    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    // TURNO_INICIADO muda jogadorAtivoId e o destaque do Turno passa à Ana;
    // o retrato local segue no jogador autenticado.
    await waitFor(() => {
      const ativo = screen.getByTestId('hud-turno-ativo')
      expect(ativo).toHaveAttribute('data-jogador-id', 'jogador-2')
      expect(ativo).toHaveAttribute('aria-label', 'Vez de Ana')
      expect(screen.getByTestId('hud-jogador-local')).toHaveAttribute(
        'data-jogador-id',
        '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
      )
    })
  })

  it('sem snapshot o HUD não aparece em aguardando', async () => {
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
        apelido: 'JogadorTeste',
        partidaId: 'p',
        estado: 'preparada',
      }),
    )
    expect(await screen.findByTestId('overlay-aguardando')).toBeInTheDocument()
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
  })
})

describe('ATAQUE/RESGATE na tela — chips e feedback ponta a ponta (#174/#145-exp F3)', () => {
  const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

  function avatarDoAdversario(jogadorId: string): HTMLElement | undefined {
    return screen
      .getAllByTestId('hud-avatar-adversario')
      .find((el) => el.getAttribute('data-jogador-id') === jogadorId)
  }

  it('ATAQUE_RESOLVIDO com estadosAplicados atualiza o HUD e toca som de recusa', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    // Ana vira a Jogadora Ativa: o destaque do Turno passa a ser o dela.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 }))
    const ativo = await screen.findByTestId('hud-turno-ativo')
    expect(ativo).toHaveAttribute('data-jogador-id', 'jogador-2')
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')

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

    // Projeção no modelo: avatar da Ana reflete sanidade e Baixa Iluminação.
    await waitFor(() => {
      const avatar = avatarDoAdversario('jogador-2')
      expect(avatar).toHaveAttribute('data-sanidade', '2')
      expect(avatar).toHaveAttribute('data-em-baixa', 'true')
    })
    // Som de recusa com motivo de ataque (PartidaPage: estadosAplicados > 0).
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: CAMINHO_SOM_DE_RECUSA, volume: VOLUME_BASE_SOM_DE_RECUSA })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('ataque_com_penalidade')
    expect(anuncio).toHaveTextContent('ataque')
  })

  it('ATAQUE_RESOLVIDO com Amedrontado atualiza o avatar no HUD', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-vermelho'] }],
        peoesAtingidos: ['peao-vermelho'],
        protegidos: [],
        estadosAplicados: [
          { jogadorId: 'jogador-2', emBaixaIluminacao: false, sanidade: 0, amedrontado: true },
        ],
      }),
    )
    await waitFor(() => {
      const avatar = avatarDoAdversario('jogador-2')
      expect(avatar).toHaveAttribute('data-sanidade', '0')
      expect(avatar).toHaveAttribute('data-amedrontado', 'true')
    })
    // Ataque com penalidade também toca a recusa.
    expect(toquesDeAudio).toHaveLength(1)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe(
      'ataque_com_penalidade',
    )
  })

  it('ATAQUE_RESOLVIDO sem penalidade fica em silêncio (sem vítimas ou proteção que negou)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))

    // Gatilho sem atingidos (alcance vazio): silêncio.
    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [] }],
        peoesAtingidos: [],
        protegidos: [],
        estadosAplicados: [],
      }),
    )
    expect(toquesDeAudio).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')

    // Proteção (sala médica) negou o ataque: silêncio.
    act(() =>
      ws.simulateMessage({
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-vermelho'] }],
        peoesAtingidos: [],
        protegidos: ['jogador-2'],
        estadosAplicados: [],
      }),
    )
    expect(toquesDeAudio).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    // Sem estadosAplicados, o avatar não muda (o eco é feedback, não autoridade).
    expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '3')
  })

  it('RESGATE_REALIZADO limpa os estados no avatar e restaura a Sanidade, em silêncio', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    // Ana Amedrontada (sanidade 0) no snapshot autoritativo.
    const snapshot = criarSnapshotBase({
      jogadores: criarSnapshotBase().jogadores.map((j) =>
        j.jogadorId === 'jogador-2'
          ? { ...j, sanidade: 0, emBaixaIluminacao: true, amedrontado: true }
          : j,
      ),
    })
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))
    await waitFor(() => {
      expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-amedrontado', 'true')
      expect(avatarDoAdversario('jogador-2')).toHaveAttribute('data-sanidade', '0')
    })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    act(() =>
      ws.simulateMessage({
        type: 'RESGATE_REALIZADO',
        pecaId: 'reta-1',
        resgatadoJogadorId: 'jogador-2',
        resgatadorJogadorId: MEU_JOGADOR_ID,
        resgatadorPeaoId: 'peao-branco',
      }),
    )

    // Estados limpos + sanidade restaurada a 1 (regra do Resgate no domínio).
    await waitFor(() => {
      const avatar = avatarDoAdversario('jogador-2')
      expect(avatar).not.toHaveAttribute('data-amedrontado')
      expect(avatar).not.toHaveAttribute('data-em-baixa')
      expect(avatar).toHaveAttribute('data-sanidade', '1')
    })
    // Resgate em silêncio: nenhum toque, nenhum clarão, nenhum anúncio.
    expect(toquesDeAudio).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa')).not.toHaveAttribute('data-motivo')
  })
})

describe('HUD de objetivos globais sem recarregamento (issue #145)', () => {
  function snapshotComObjetivos(opts: {
    pecasRestantes?: number
    geradoresLigados?: readonly string[]
    cartaoDeAcesso?: boolean
    posicionadas?: readonly PecaPosicionadaNoSnapshot[]
  }): EstadoDaPartidaSnapshot {
    return criarSnapshotBase({
      tabuleiro: {
        posicionadas: opts.posicionadas ?? [],
        iniciais: [],
        peoes: [],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        pecasRestantesNaCaixa: opts.pecasRestantes ?? 57,
      },
      geradoresLigados: opts.geradoresLigados ?? [],
      cartaoDeAcessoObtido: opts.cartaoDeAcesso ?? false,
    })
  }

  function geradoresAcesos(): number {
    return screen
      .getAllByTestId('hud-conquista-gerador')
      .filter((el) => el.getAttribute('data-acesa') === 'true').length
  }

  const GERADOR_1: PecaPosicionadaNoSnapshot = {
    pecaId: 'gerador-1',
    tipo: 'gerador',
    orientacao: 0,
    celula: { linha: 1, coluna: 2 },
  }
  const SALA_DIRETOR_1: PecaPosicionadaNoSnapshot = {
    pecaId: 'sala-do-diretor-1',
    tipo: 'sala_do_diretor',
    orientacao: 0,
    celula: { linha: 4, coluna: 4 },
  }

  it('em aguardando o HUD não é montado', async () => {
    renderPartidaNaRota('/partida?serverId=s&partidaId=p')
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    const ws = MockWebSocket.last()!
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_ACEITA',
        jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
        apelido: 'JogadorTeste',
        partidaId: 'p',
        estado: 'preparada',
      }),
    )
    expect(await screen.findByTestId('overlay-aguardando')).toBeInTheDocument()
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
  })

  it('antes do snapshot o HUD fica oculto (nada inventado)', async () => {
    await partidaDisponivel('/partida?serverId=s&partidaId=p')
    // Sem baseline do snapshot o HUD não renderiza — nem conquistas zeradas,
    // nem contagem da Caixa: a issue #226 exige HUD oculto sem snapshot.
    expect(screen.queryByTestId('hud-da-partida')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-conquistas')).not.toBeInTheDocument()
  })

  it('ESTADO_DA_PARTIDA popula as conquistas pela baseline', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({
          pecasRestantes: 57,
          geradoresLigados: ['gerador-1'],
          posicionadas: [GERADOR_1],
        }),
      }),
    )
    await screen.findByTestId('hud-da-partida')
    // Baseline: 1 gerador ligado acende 1 conquista; cartão apagado.
    expect(geradoresAcesos()).toBe(1)
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'false')
  })

  it('PECA_SORTEADA ao vivo não inventa contagem no HUD (Caixa fora do HUD #226)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({ pecasRestantes: 57 }),
      }),
    )
    await screen.findByTestId('hud-da-partida')
    // A contagem da Caixa saiu do HUD (derivação segue no modelo, coberta em
    // tabuleiro-reducao.test.ts): sorteios não acendem conquistas nem exibem
    // contagem — o HUD segue íntegro, inclusive no sorteio repetido.
    act(() =>
      ws.simulateMessage({
        type: 'PECA_SORTEADA',
        pecaId: 'reta-1',
        tipoDaPeca: 'reta',
        orientacao: 0,
      }),
    )
    expect(geradoresAcesos()).toBe(0)
    expect(screen.queryByTestId('contagem-caixa')).not.toBeInTheDocument()

    // Reentrega do mesmo sorteio: sem efeito visível.
    act(() =>
      ws.simulateMessage({
        type: 'PECA_SORTEADA',
        pecaId: 'reta-1',
        tipoDaPeca: 'reta',
        orientacao: 0,
      }),
    )
    await waitFor(() => expect(geradoresAcesos()).toBe(0))
  })

  it('POSICAO_CONFIRMADA de gerador acende a conquista ao vivo, com dedupe', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({ posicionadas: [GERADOR_1] }),
      }),
    )
    await screen.findByTestId('hud-da-partida')
    expect(geradoresAcesos()).toBe(0)

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
        pecaId: 'gerador-1',
      }),
    )
    await waitFor(() => expect(geradoresAcesos()).toBe(1))
    // Reconfirmação do MESMO gerador (reconexão com o gerador já na baseline
    // não pode inflar): dedupe por pecaId.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({
          geradoresLigados: ['gerador-1'],
          posicionadas: [GERADOR_1],
        }),
      }),
    )
    await waitFor(() => expect(geradoresAcesos()).toBe(1))
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
        pecaId: 'gerador-1',
      }),
    )
    await waitFor(() => expect(geradoresAcesos()).toBe(1))
  })

  it('POSICAO_CONFIRMADA de sala_do_diretor acende a conquista do cartão', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({ posicionadas: [SALA_DIRETOR_1] }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: 'jogador-2',
        peaoId: 'peao-vermelho',
        pecaId: 'sala-do-diretor-1',
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'true'),
    )
  })

  it('reconexão: ESTADO_DA_PARTIDA reconcilia as conquistas sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    // Snapshot inicial sem conquistas.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({ pecasRestantes: 57 }),
      }),
    )
    await screen.findByTestId('hud-da-partida')

    // Reconexão: o novo snapshot traz a baseline real do engine (conquistas
    // obtidas enquanto o cliente estava fora) — reconcilia sem reload.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({
          pecasRestantes: 40,
          geradoresLigados: ['gerador-1', 'gerador-2'],
          cartaoDeAcesso: true,
          posicionadas: [GERADOR_1, SALA_DIRETOR_1],
        }),
      }),
    )
    expect(geradoresAcesos()).toBe(2)
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'true')
  })

  it('AC1: especial posicionada renderiza com data-tipo e sem janela de Manipulação (snapshot e delta)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    const SALA_MEDICA_1: PecaPosicionadaNoSnapshot = {
      pecaId: 'sala-medica-1',
      tipo: 'sala_medica',
      orientacao: 0,
      celula: { linha: 1, coluna: 3 },
    }
    // Via snapshot: gerador e sala médica posicionadas, pecaEmManipulacaoId null.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: snapshotComObjetivos({ posicionadas: [GERADOR_1, SALA_MEDICA_1] }),
      }),
    )
    // Sem janela de Manipulação: o overlay 3D não emite (data-manipulacao
    // ausente no espelho) — os controles DOM de giro não existem mais.
    const pospecas = await screen.findAllByTestId('peca-posicionada')
    expect(pospecas).toHaveLength(2)
    expect(
      pospecas.find((el) => el.getAttribute('data-peca-id') === 'gerador-1')?.getAttribute('data-tipo'),
    ).toBe('gerador')
    expect(
      pospecas.find((el) => el.getAttribute('data-peca-id') === 'sala-medica-1')?.getAttribute('data-tipo'),
    ).toBe('sala_medica')
    expect(pospecas.some((el) => el.hasAttribute('data-manipulacao'))).toBe(false)
    expect(screen.queryByTestId('controles-de-giro')).not.toBeInTheDocument()

    // Via delta: sorteio + encaixe direto de outra especial no mesmo lote.
    act(() => {
      ws.simulateMessage({ type: 'PECA_SORTEADA', pecaId: 'sala-medica-2', tipoDaPeca: 'sala_medica', orientacao: 0 })
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'sala-medica-2',
        celula: { linha: 1, coluna: 4 },
        orientacao: 0,
      })
    })
    await waitFor(() => expect(screen.getAllByTestId('peca-posicionada')).toHaveLength(3))
    const delta = screen
      .getAllByTestId('peca-posicionada')
      .find((el) => el.getAttribute('data-peca-id') === 'sala-medica-2')
    expect(delta?.getAttribute('data-tipo')).toBe('sala_medica')
    // O encaixe da especial não abriu janela de Manipulação (o modelo local
    // reflete o engine): sem data-manipulacao nas peças e sem controles DOM.
    expect(
      screen.getAllByTestId('peca-posicionada').some((el) => el.hasAttribute('data-manipulacao')),
    ).toBe(false)
    expect(screen.queryByTestId('controles-de-giro')).not.toBeInTheDocument()
  })
})

describe('reload do primeiro turno — peça de volta à mesa e turno concluível (issue #258)', () => {
  const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

  function peaoDoEspelho(peaoId: string): HTMLElement | undefined {
    return screen
      .getAllByTestId('peao')
      .find((el) => el.getAttribute('data-peao-id') === peaoId)
  }

  function pecaInicialDoEspelho(pecaId: string): HTMLElement {
    const peca = screen
      .getAllByTestId('mesa-peca-inicial')
      .find((el) => el.getAttribute('data-peca-id') === pecaId)
    if (!peca) throw new Error(`peça inicial ${pecaId} não encontrada na mesa`)
    return peca
  }

  it('F5 com a inicial ainda não encaixada: peça reaparece e o turno conclui após DESELECIONAR_PEAO', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')

    // Foto do reload: a inicial em foco sumiu da lista, mas a seleção
    // pendente (`pecaSelecionadaId`) e o peão selecionado sobreviveram.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
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
            pecaSelecionadaId: 'inicial-2',
            pecaEmManipulacaoId: null,
            peaoSelecionadoId: 'peao-branco',
            pecasRestantesNaCaixa: 83,
          },
          jogadorAtivoId: MEU_JOGADOR_ID,
          rodada: 1,
        }),
      }),
    )

    // A peça em foco volta para a mesa (só ela — sem ressuscitar a lista cheia).
    const iniciais = await screen.findAllByTestId('mesa-peca-inicial')
    expect(iniciais.map((el) => el.getAttribute('data-peca-id'))).toEqual(['inicial-2'])

    // O anúncio do turno corrente (replay) não apaga a reconstrução.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 1 }))
    await waitFor(() =>
      expect(
        screen.getAllByTestId('mesa-peca-inicial').map((el) => el.getAttribute('data-peca-id')),
      ).toEqual(['inicial-2']),
    )
    expect(peaoDoEspelho('peao-branco')?.getAttribute('data-selecionado')).toBe('true')

    // H1: com o peão selecionado o clique na célula é bloqueado (ciclo
    // binário #249) — nenhum POSICIONAR_PECA sai.
    const user = userEvent.setup()
    const antesDoBloqueio = ws.sentMessages.length
    await user.click(celulaDoEspelho(3, 3))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(ws.sentMessages).toHaveLength(antesDoBloqueio)

    // Caminho de destravamento: clicar fora da peça/peão desseleciona via
    // comando autoritativo ao servidor (nunca só no local, #249).
    await user.click(screen.getByTestId('tabuleiro'))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'DESELECIONAR_PEAO',
        peaoId: 'peao-branco',
        jogadorId: MEU_JOGADOR_ID,
      })
    })

    // Ack do servidor: o ciclo apaga e a Inicial volta a ser selecionável.
    act(() => ws.simulateMessage({ type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' }))
    await waitFor(() =>
      expect(peaoDoEspelho('peao-branco')?.getAttribute('data-selecionado')).toBe('false'),
    )
    await user.click(pecaInicialDoEspelho('inicial-2'))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'SELECIONAR_PECA',
        pecaId: 'inicial-2',
        jogadorId: MEU_JOGADOR_ID,
      })
    })

    // Seleção confirmada → o clique na célula vazia posiciona a Inicial.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-2' }))
    await user.click(celulaDoEspelho(3, 3))
    await waitFor(() => {
      const ultimo = ws.sentMessages[ws.sentMessages.length - 1]!
      expect(JSON.parse(ultimo)).toEqual({
        type: 'POSICIONAR_PECA',
        pecaId: 'inicial-2',
        celula: { linha: 3, coluna: 3 },
        jogadorId: MEU_JOGADOR_ID,
      })
    })
    // A mesma conexão sobreviveu ao roteiro inteiro (sem reload de verdade).
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
