// Tutorial da Partida (issue #434, item 4 do review da PR #448): a flag de
// sessão (`tutorial-da-partida-visto`) só é gravada quando o modal confirma
// que abriu — a abertura é a fonte única da verdade. Se o painel ainda não
// montou naquele instante (ref nula, primeira entrada em andamento), a
// tentativa de auto-abertura vira no-op SEM queimar a flag: o jogador não
// perde o tutorial dessa aba.
// Regressão: o painel é mockado para nunca montar (ref sempre nula); com o
// código antigo (gravação antecipada no efeito) a flag seria gravada mesmo
// sem o modal abrir.

import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { CHAVE_SESSAO_TUTORIAL_DA_PARTIDA } from '../web/src/components/partida/conteudoDoTutorialDaPartida'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

vi.mock('../web/src/components/partida/PainelDeTutorialDaPartida', () => ({
  PainelDeTutorialDaPartida: () => null,
}))

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

function criarSnapshotEmAndamento(): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: [{ peaoId: 'peao-branco', cor: 'branco', pecaId: null }],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: [
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  } as EstadoDaPartidaSnapshot
}

afterEach(() => {
  MockWebSocket.clean()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Tutorial da Partida — flag só na abertura confirmada (PR #448 item 4)', () => {
  it('painel ainda não montado (ref nula) não grava a flag de sessão', async () => {
    window.sessionStorage.removeItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA)

    const router = createMemoryRouter(
      [{ path: '/partida', element: <PartidaPage /> }],
      { initialEntries: ['/partida?serverId=s&partidaId=p'] },
    )
    render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
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
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotEmAndamento() }))
    await screen.findByTestId('hud-da-partida')

    // O painel mockado nunca monta: nenhum diálogo abre…
    expect(screen.queryByTestId('tutorial-dialogo')).not.toBeInTheDocument()
    // …e a flag NÃO pode ter sido queimada — a aba segue "não atendida".
    expect(window.sessionStorage.getItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA)).toBeNull()
  })
})
