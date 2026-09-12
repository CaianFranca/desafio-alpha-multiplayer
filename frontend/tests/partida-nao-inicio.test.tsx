import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import {
  CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA,
  MOTIVO_PARTIDA_NAO_INICIADA,
} from '../web/src/hooks/usePartidaWebSocket'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
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
    marcarSaidaPropria: () => {},
    enviarMensagemDeChat: () => {},
    expulsarMembro: () => {},
    desbloquearJogador: () => {},
    encerrarSala: () => {},
    iniciarPartida: () => {},
    expulso: false,
    descartarExpulsao: () => {},
  }
}

function renderPartidaNaoInicio(entry: string, codigoSala: string | null = null) {
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

async function socketDaPartida(entry: string, codigoSala: string | null = null) {
  renderPartidaNaoInicio(entry, codigoSala)
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  return MockWebSocket.last()!
}

/** Espera além da janela de reconexão de 1s do canal da Partida. */
function esperarJanelaDeReconexao() {
  return act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1300)
    })
  })
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida não iniciada no cliente (issue #329)', () => {
  it('close 4000 PARTIDA_NAO_INICIADA exibe overlay de não-início sem reconexão', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))

    const overlay = await screen.findByTestId('overlay-partida-nao-iniciada')
    expect(overlay).toHaveTextContent('Partida não iniciada')
    expect(screen.getByTestId('voltar-a-sala')).toBeInTheDocument()
    // Estado terminal próprio: sem "Tentar novamente" (que recairia no loop).
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
    expect(screen.queryByTestId('partida-tentar-novamente')).not.toBeInTheDocument()

    // Nenhuma nova instância de socket mesmo após a janela de reconexão.
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(screen.getByTestId('overlay-partida-nao-iniciada')).toBeInTheDocument()
  })

  it('reason PARTIDA_NAO_INICIADA sem código 4000 segue em reconexão (par estrito)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(1000, MOTIVO_PARTIDA_NAO_INICIADA))

    // Par estrito (issue #329): reason sozinho não é terminal.
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
  })

  it('código 4000 sem reason PARTIDA_NAO_INICIADA segue em reconexão (par estrito)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, 'OUTRO_MOTIVO'))

    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
  })

  it('ADMISSAO_REJEITADA PARTIDA_NAO_ENCONTRADA sem contexto vai para falha com retry e voltar', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    // Primeira entrada com partidaId inválido/expirado: sem close 4000 prévio,
    // é falha com retry — não diagnóstico enganoso de não-início.
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_REJEITADA',
        codigo: 'PARTIDA_NAO_ENCONTRADA',
        motivo: 'Partida não encontrada.',
      }),
    )

    await screen.findByTestId('overlay-falha')
    expect(screen.getByTestId('partida-tentar-novamente')).toBeInTheDocument()
    expect(screen.getByTestId('voltar-a-sala')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
    // Socket encerrado sem reagendar: onclose nulado, sem instância nova.
    expect(ws.onclose).toBeNull()
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('ADMISSAO_REJEITADA pós-não-início (após close 4000) mantém o terminal sem loop', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))
    await screen.findByTestId('overlay-partida-nao-iniciada')

    // Retry tardio que encontra o upgrade sem a Partida cancelada.
    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_REJEITADA',
        codigo: 'PARTIDA_NAO_ENCONTRADA',
        motivo: 'Partida não encontrada.',
      }),
    )

    expect(screen.getByTestId('overlay-partida-nao-iniciada')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('ADMISSAO_REJEITADA com outro código segue ignorada (sem terminal)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_REJEITADA',
        codigo: 'SESSAO_INVALIDA',
        motivo: 'Sessão inválida.',
      }),
    )

    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
    expect(ws.onclose).not.toBeNull()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('botão voltar à sala com código navega à Sala reaberta e encerra o socket', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p', 'A3K9M2')

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))
    await screen.findByTestId('overlay-partida-nao-iniciada')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
    // Retorno à Sala: sem reconexão na saída.
    expect(ws.onclose).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('botão voltar sem código vai para /salas/criar', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p', null)

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))
    await screen.findByTestId('overlay-partida-nao-iniciada')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('criar-pagina')).toBeInTheDocument()
  })

  it('?codigoDeSala= na URL supre o contexto ausente no voltar à sala', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p&codigoDeSala=A3K9M2', null)

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))
    await screen.findByTestId('overlay-partida-nao-iniciada')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
  })

  it('overlay de falha tem voltar à sala que navega sem reconectar', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p', 'A3K9M2')

    act(() =>
      ws.simulateMessage({
        type: 'ADMISSAO_REJEITADA',
        codigo: 'PARTIDA_NAO_ENCONTRADA',
        motivo: 'Partida não encontrada.',
      }),
    )
    await screen.findByTestId('overlay-falha')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('PARTIDA_TERMINADA segue indo para resultado (sem terminal de não-início)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_TERMINADA',
        resultado: 'derrota',
        motivo: null,
      }),
    )

    await screen.findByTestId('overlay-resultado')
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
  })

  it('PARTIDA_TERMINADA tardia após não-início é ignorada (terminal mantido)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(CODIGO_FECHAMENTO_PARTIDA_NAO_INICIADA, MOTIVO_PARTIDA_NAO_INICIADA))
    await screen.findByTestId('overlay-partida-nao-iniciada')

    act(() =>
      ws.simulateMessage({
        type: 'PARTIDA_TERMINADA',
        resultado: 'vitoria',
        motivo: null,
      }),
    )

    expect(screen.getByTestId('overlay-partida-nao-iniciada')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-resultado')).not.toBeInTheDocument()
  })
})

describe('regressões do canal da partida (issue #329)', () => {
  it('close 1006 (rede) ainda reconecta após 1s', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(1006, ''))

    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
  })

  it('close 4409 CONEXAO_SUBSTITUIDA mantém o comportamento (reconecta)', async () => {
    const ws = await socketDaPartida('/partida?serverId=s&partidaId=p')

    act(() => ws.simulateClose(4409, 'CONEXAO_SUBSTITUIDA'))

    await esperarJanelaDeReconexao()
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(screen.queryByTestId('overlay-partida-nao-iniciada')).not.toBeInTheDocument()
  })
})
