import { render, screen, waitFor, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

// Anúncio da partida com o N real (issue #284, #281): anuncia a contagem
// real do roster (solo anuncia 1, nunca um N falso); o teto do Portão de
// Saída usa o clamp 2..4 em separado.

import { jogador, snapshotComJogadores } from './helpers/rosterN'

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

const MOCK_SALA = {
  sala: null, avisos: [], mensagensDeChat: [], jogadoresBloqueados: [],
  conectado: true, erro: null,
  encaminhamento: { fase: 'ocioso', alvo: null, codigo: null, motivo: null, mensagem: null },
  limparAvisoDeEncaminhamento: () => {}, enviar: () => {}, criarSala: () => {},
  entrarNaSala: () => {}, alternarProntidao: () => {}, sairDaSala: () => {},
  enviarMensagemDeChat: () => {}, expulsarMembro: () => {}, desbloquearJogador: () => {},
  encerrarSala: () => {}, iniciarPartida: () => {}, expulso: false, descartarExpulsao: () => {},
}

function criarMembro(id: string, apelido: string, ordemDeEntrada: number) {
  return {
    id, jogadorId: `jogador-${id}`, apelido, ordemDeEntrada,
    presenca: 'conectado' as const, prontidao: true,
  }
}

function contextoComSala(apelidos: string[]) {
  const membros = apelidos.map((apelido, i) => criarMembro(`m${i + 1}`, apelido, i))
  const sala = {
    id: 'sala-1', codigoDeSala: 'A3K9M2', estado: 'encaminhada' as const,
    anfitriaoId: membros[0].id, membros,
    convite: { codigoDeSala: 'A3K9M2', link: 'http://localhost/sala/A3K9M2' },
  }
  return { ...MOCK_SALA, sala }
}

async function admitirNaPartida(contexto: typeof MOCK_SALA) {
  const router = createMemoryRouter(
    [{ path: '/partida', element: <PartidaPage /> }],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <SalaWebSocketContext.Provider value={contexto as unknown as UseSalaWebSocketReturn}>
        <RouterProvider router={router} />
      </SalaWebSocketContext.Provider>
    </AuthProvider>,
  )
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA', jogadorId: MEU_JOGADOR_ID, apelido: 'Eu',
      partidaId: 'partida-1', estado: 'em_andamento',
    }),
  )
  await screen.findByTestId('tabuleiro')
  return ws
}

async function anuncioComJogadores(jogadores: EstadoDaPartidaSnapshot['jogadores']) {
  const ws = await admitirNaPartida(MOCK_SALA)
  act(() =>
    ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: snapshotComJogadores(jogadores) }),
  )
  await screen.findByTestId('hud-da-partida')
  return screen.getByTestId('anuncio-partida')
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('anúncio da partida com N real (#284)', () => {
  it('solo (N=1) anuncia o N real — nunca um N falso', async () => {
    const anuncio = await anuncioComJogadores([jogador(MEU_JOGADOR_ID, 'Eu', 'branco', 1)])
    expect(anuncio).toHaveTextContent('Partida com 1 jogador')
  })

  it('N=3 anuncia os 3 jogadores com vocabulário canônico', async () => {
    const anuncio = await anuncioComJogadores([
      jogador(MEU_JOGADOR_ID, 'Eu', 'branco', 1),
      jogador('j2', 'Ana', 'vermelho', 2),
      jogador('j3', 'Beto', 'azul', 3),
    ])
    expect(anuncio).toHaveTextContent('Partida com 3 jogadores')
    expect(anuncio).toHaveTextContent('Jogador Ativo')
    expect(anuncio).toHaveTextContent('Portão de Saída')
    expect(anuncio).not.toHaveTextContent('vez de')
  })

  it('pré-snapshot a mesa já nasce com o N da Sala (N=2, sem fantasmas)', async () => {
    await admitirNaPartida(contextoComSala(['Eu', 'Ana']))
    // Seed com o N real da Sala: 2 peões antes de qualquer snapshot.
    expect(screen.getAllByTestId('peao')).toHaveLength(2)
    expect(screen.getByTestId('anuncio-partida')).toHaveTextContent('Partida com 2 jogadores')
  })
})
