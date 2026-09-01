import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { vi } from 'vitest'

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

async function partidaDisponivel(entry: string) {
  renderPartidaNaRota(entry)
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: 'jogador-1',
      apelido: 'Ana',
      partidaId: 'partida-1',
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

  it('admissão aceita leva de carregando para disponível (cena montada)', async () => {
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
      }),
    )

    expect(await screen.findByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('evento de posicionamento atualiza o espelho DOM sem recarregar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    expect(screen.getAllByTestId('reserva-peca')).toHaveLength(22)
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
    expect(screen.getAllByTestId('reserva-peca')).toHaveLength(21)
  })

  it('rotação via botão DOM envia GIRAR_PECA para a peça em manipulação ao WS', async () => {
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
    await user.click(screen.getByTestId('girar-horario'))

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

  it('ERRO_DO_TABULEIRO produz flash vermelho distinto do branco', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // Aprovação → flash branco.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    const branco = await screen.findByTestId('flash-overlay')
    expect(branco.getAttribute('data-cor')).toBe('branco')

    // Branco expira sozinho (320ms).
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    // Rejeição → flash vermelho distinto.
    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PECA_NAO_RECEBIDA',
        mensagem: 'Peças de caminho só entram pelo Recebimento.',
      }),
    )
    const vermelho = await screen.findByTestId('flash-overlay')
    expect(vermelho.getAttribute('data-cor')).toBe('vermelho')
    expect(vermelho.getAttribute('data-motivo')).toBe('rejeicao_do_servico')
  })

  it('sucessivos eventos de mesmo tipo reiniciam o timer do flash (via nova ref)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    vi.useFakeTimers()

    await act(async () => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' })
    })
    expect(screen.getByTestId('flash-overlay')).toBeInTheDocument()

    // Avança quase até o fim (300ms de 320ms).
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId('flash-overlay')).toBeInTheDocument()

    // Segundo evento idêntico reinicia o timer.
    await act(async () => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-2' })
    })

    // Avança mais 100ms (total 400ms desde o início). 
    // Sem o restart, o flash teria sumido em 320ms.
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByTestId('flash-overlay')).toBeInTheDocument()

    // Avança até o fim do segundo timer.
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    
    vi.useRealTimers()
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

  it('controles de giro desabilitam sem seleção e após finalização', async () => {
    const ws = await partidaDisponivel('/partida?serverId=server-1&partidaId=partida-1')

    // 1. Sem nada selecionado: botões desabilitados.
    expect(screen.getByTestId('girar-horario')).toBeDisabled()
    expect(screen.getByTestId('girar-anti-horario')).toBeDisabled()

    // 2. Seleciona: habilita.
    act(() => {
      ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' })
    })
    expect(screen.getByTestId('girar-horario')).not.toBeDisabled()

    // 3. Posiciona: abre manipulação (continua habilitado).
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
    })
    expect(screen.getByTestId('girar-horario')).not.toBeDisabled()

    // 4. Finaliza: desabilita (manipulação e seleção nulas).
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })
    expect(screen.getByTestId('girar-horario')).toBeDisabled()
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

  it('LIMPEZA_APLICADA remove a peça da cena, libera a célula, produz flash único e aceita novo posicionamento sem recarregar', async () => {
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

    // Deixa o flash de aprovação do posicionamento expirar (isola o da Limpeza).
    await waitFor(() =>
      expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument(),
    )

    // A Limpeza chega pelo MESMO socket — sem recarregar página, sem reconectar.
    act(() =>
      ws.simulateMessage({ type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] }),
    )

    // A peça removida some do espelho e a célula volta a estar livre.
    await waitFor(() =>
      expect(screen.queryByTestId('peca-posicionada')).not.toBeInTheDocument(),
    )
    expect(celulaDoEspelho(3, 3).getAttribute('data-ocupada')).toBe('false')

    // Feedback: um ÚNICO flash (branco de aprovação) percebido via data-cor.
    expect(screen.getAllByTestId('flash-overlay')).toHaveLength(1)
    expect(screen.getByTestId('flash-overlay').getAttribute('data-cor')).toBe('branco')

    // Célula liberada aceita novo posicionamento pela mesma via dos testes de
    // interação: seleção via broadcast + clique no espelho → POSICIONAR_PECA no WS.
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'reta-1' }))
    await waitFor(() =>
      expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument(),
    )
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
})
