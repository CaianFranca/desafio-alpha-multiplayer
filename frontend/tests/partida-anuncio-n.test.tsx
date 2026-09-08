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

// Anúncio da partida com o N real (issue #284, #281): o fallback sem clamp
// anunciava "Partida com 1 jogadores" (ou 5+) — o N passa por
// quantidadeValidaDeJogadores (2..4).

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

function jogador(id: string, apelido: string, cor: 'branco' | 'vermelho' | 'azul' | 'amarelo', ordem: number) {
  return {
    jogadorId: id, apelido, cor, ordem, peaoId: `peao-${cor}`,
    primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false,
    amedrontado: false, protegido: false,
  }
}

function snapshotComJogadores(
  jogadores: EstadoDaPartidaSnapshot['jogadores'],
): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: jogadores.map((j) => ({
        peaoId: j.peaoId, cor: j.cor, pecaId: null,
      })),
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores,
    jogadorAtivoId: jogadores[0]?.jogadorId ?? 'j1',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...{},
  } as unknown as EstadoDaPartidaSnapshot
}

const MOCK_SALA = {
  sala: null, avisos: [], mensagensDeChat: [], jogadoresBloqueados: [],
  conectado: true, erro: null,
  encaminhamento: { fase: 'ocioso', alvo: null, codigo: null, motivo: null, mensagem: null },
  limparAvisoDeEncaminhamento: () => {}, enviar: () => {}, criarSala: () => {},
  entrarNaSala: () => {}, alternarProntidao: () => {}, sairDaSala: () => {},
  enviarMensagemDeChat: () => {}, expulsarMembro: () => {}, desbloquearJogador: () => {},
  encerrarSala: () => {}, iniciarPartida: () => {}, expulso: false, descartarExpulsao: () => {},
}

async function anuncioComJogadores(jogadores: EstadoDaPartidaSnapshot['jogadores']) {
  const router = createMemoryRouter(
    [{ path: '/partida', element: <PartidaPage /> }],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <SalaWebSocketContext.Provider value={MOCK_SALA as unknown as UseSalaWebSocketReturn}>
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
  it('solo (N=1) anuncia N com clamp — nunca "Partida com 1 jogadores"', async () => {
    const anuncio = await anuncioComJogadores([jogador(MEU_JOGADOR_ID, 'Eu', 'branco', 1)])
    expect(anuncio).toHaveTextContent('Partida com 2 jogadores')
  })

  it('N=3 anuncia os 3 jogadores', async () => {
    const anuncio = await anuncioComJogadores([
      jogador(MEU_JOGADOR_ID, 'Eu', 'branco', 1),
      jogador('j2', 'Ana', 'vermelho', 2),
      jogador('j3', 'Beto', 'azul', 3),
    ])
    expect(anuncio).toHaveTextContent('Partida com 3 jogadores')
  })
})
