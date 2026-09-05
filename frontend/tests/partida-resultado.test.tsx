import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

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

function renderPartidaResultado(entry: string, codigoSala: string | null) {
  const mockCtx = mockSalaContext(codigoSala)
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/sala/:codigoDeSala', element: <div data-testid="sala-pagina">sala</div> },
      { path: '/salas/criar', element: <div data-testid="criar-pagina">criar</div> },
    ],
    { initialEntries: [entry] },
  )
  return {
    router,
    ...render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <SalaWebSocketContext.Provider value={mockCtx as unknown as UseSalaWebSocketReturn}>
          <RouterProvider router={router} />
        </SalaWebSocketContext.Provider>
      </AuthProvider>,
    ),
  }
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
    },
    jogadores: [
      { jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90', apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
    ],
    jogadorAtivoId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
    rodada: 2,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    ...overrides,
  } as EstadoDaPartidaSnapshot
}

async function partidaDisponivel(entry: string, codigoSala: string | null = 'A3K9M2') {
  renderPartidaResultado(entry, codigoSala)
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
  // ESTADO_DA_PARTIDA em_andamento para sair de carregando
  const snap = criarSnapshotBase({ estado: 'em_andamento', resultado: null })
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: snap }))
  await screen.findByTestId('tabuleiro')
  return ws
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida resultado e retorno à sala (issue #180)', () => {
  it('PARTIDA_TERMINADA vitoria apresenta overlay resultado e esconde controles', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p', 'A3K9M2')

    // garante controles visíveis antes: simula TURNO_INICIADO + peao para habilitar Permanecer
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90', rodada: 2 }))
    act(() => ws.simulateMessage({ type: 'PEAO_PERMANECEU', peaoId: 'peao-branco', pecaId: 'inicial-1' }))
    expect(await screen.findByTestId('controles-de-turno')).toBeInTheDocument()

    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))

    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-resultado', 'vitoria')
    expect(overlay).toHaveTextContent('Vitória!')
    expect(screen.getByTestId('voltar-a-sala')).toBeInTheDocument()
    // ações indisponíveis visualmente
    expect(screen.queryByTestId('controles-de-turno')).not.toBeInTheDocument()
    expect(screen.queryByTestId('controles-de-giro')).not.toBeInTheDocument()
    // tabuleiro ainda visível mas congelado
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('PARTIDA_TERMINADA derrota apresenta overlay correto', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'derrota' }))
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-resultado', 'derrota')
    expect(overlay).toHaveTextContent('Derrota')
    // Payload sem motivo (contrato antigo — defensivo): texto genérico, sem data-motivo.
    expect(overlay).toHaveAttribute('data-motivo', '')
    expect(overlay).toHaveTextContent('A equipe não conseguiu escapar')
  })

  it('derrota com motivo caixa_esgotada distingue o motivo na tela (#145-exp)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_TERMINADA',
        resultado: 'derrota',
        motivo: 'caixa_esgotada',
      }),
    )
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-resultado', 'derrota')
    expect(overlay).toHaveAttribute('data-motivo', 'caixa_esgotada')
    expect(overlay).toHaveTextContent('A Caixa esgotou antes de a equipe completar a fuga')
    expect(overlay).not.toHaveTextContent('A equipe não conseguiu escapar')
  })

  it('derrota com motivo equipe_amedrontada distingue o motivo na tela (#145-exp)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_TERMINADA',
        resultado: 'derrota',
        motivo: 'equipe_amedrontada',
      }),
    )
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-motivo', 'equipe_amedrontada')
    expect(overlay).toHaveTextContent('A equipe perdeu toda a Sanidade')
    expect(overlay).not.toHaveTextContent('A equipe não conseguiu escapar')
  })

  it('snapshot terminada com motivo no resultado também o projeta na tela (#145-exp)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    const snap = criarSnapshotBase({
      estado: 'terminada',
      resultado: 'derrota' as const,
      motivo: 'caixa_esgotada' as const,
    })
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: snap }))
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-motivo', 'caixa_esgotada')
    expect(overlay).toHaveTextContent('A Caixa esgotou antes de a equipe completar a fuga')
  })

  it('ESTADO_DA_PARTIDA snapshot terminada (reload) volta a exibir resultado', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    const snap = criarSnapshotBase({ estado: 'terminada', resultado: 'vitoria' as const })
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: snap }))
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-resultado', 'vitoria')
    // tabuleiro preservado
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('após término, ações não enviam comandos (somente leitura)', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    await screen.findByTestId('overlay-resultado')
    const antes = ws.sentMessages.length
    // tenta clicar voltar não deve enviar, mas tenta enviar comando via giro (se existisse) — garante que enviarComJogador bloqueia
    // simula tentativa de comando direto via WS: PartidaPage bloquearia, então só checa que nenhum comando de jogo foi enfileirado
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    // PartidaPage ignora eventos pós-término, então nenhum flash novo e nenhum envio
    expect(ws.sentMessages.length).toBe(antes)
    expect(screen.getByTestId('overlay-resultado')).toBeInTheDocument()
  })

  it('botão voltar à sala com código navega para /sala/:codigo e encerra WS da partida', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p', 'A3K9M2')
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    await screen.findByTestId('overlay-resultado')
    const wsInst = MockWebSocket.last()!
    // onclose deve ser nulado ao desconectar para não reconectar
    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
    // WS da partida encerrado: onclose nulado e close chamado, sem reconexão
    expect(wsInst.onclose).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('botão voltar sem código vai para /salas/criar', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p', null)
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'derrota' }))
    await screen.findByTestId('overlay-resultado')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('criar-pagina')).toBeInTheDocument()
  })

  it('falha de conexão após término não sobrepõe resultado', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    await screen.findByTestId('overlay-resultado')
    // simula falha: ws.onerror -> falhar, mas máquina deve manter resultado
    act(() => ws.onerror?.(new Event('error')))
    // ainda resultado, não falha
    expect(screen.getByTestId('overlay-resultado')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
  })

  it('flash é limpo ao receber término', async () => {
    const ws = await partidaDisponivel('/partida?serverId=s&partidaId=p')
    act(() => ws.simulateMessage({ type: 'PECA_SELECIONADA', pecaId: 'inicial-1' }))
    expect(await screen.findByTestId('flash-overlay')).toBeInTheDocument()
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    await screen.findByTestId('overlay-resultado')
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
  })
})
