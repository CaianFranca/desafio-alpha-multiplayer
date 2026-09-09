import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { conectarSocketDaPartida } from './helpers/partida-ws'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import { vagasDisponiveisDoPeao } from '../web/src/game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../web/src/game/tabuleiro/interacaoPeoes'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

function mockSalaContext(): UseSalaWebSocketReturn {
  const sala = {
    id: 'sala-1',
    codigoDeSala: 'A3K9M2',
    estado: 'aberta' as const,
    anfitriaoId: 'm1',
    membros: [],
    convite: { codigoDeSala: 'A3K9M2', link: 'http://localhost/sala/A3K9M2' },
  } as unknown as UseSalaWebSocketReturn['sala']
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

function renderPartida() {
  const mockCtx = mockSalaContext()
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/sala/:codigoDeSala', element: <div data-testid="sala-pagina">sala</div> },
    ],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <SalaWebSocketContext.Provider value={mockCtx as unknown as UseSalaWebSocketReturn}>
        <RouterProvider router={router} />
      </SalaWebSocketContext.Provider>
    </AuthProvider>,
  )
}

function criarSnapshot(peaoSelecionadoId: string | null): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [
        // O peão do turno terminou em reta-1 (2,3), confirmado (#326).
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 2, coluna: 3 } },
      ],
      iniciais: [],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'reta-1' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'inicial-2' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'inicial-3' },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-4' },
      ],
      // Pendência corrente (sem vaga) do Recebimento da Confirmação.
      recebidas: [{ recebidaId: 'recebida-reta-9', pecaId: 'reta-9', tipoDaPeca: 'reta', vaga: null, celulaAlvo: null }],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId,
      pecasRestantesNaCaixa: 70,
    },
    jogadores: [
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: 'inicial-1',
    posicaoConfirmada: true,
    celulasIluminadas: [
      { linha: 1, coluna: 3 }, { linha: 2, coluna: 2 }, { linha: 2, coluna: 3 },
      { linha: 2, coluna: 4 }, { linha: 3, coluna: 3 },
    ],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  }
}

function celulaDoEspelho(linha: number, coluna: number): HTMLElement {
  const celula = screen
    .getAllByTestId('tabuleiro-celula')
    .find(
      (el) =>
        el.getAttribute('data-linha') === String(linha) &&
        el.getAttribute('data-coluna') === String(coluna),
    )
  if (!celula) throw new Error(`célula ${linha}:${coluna} não encontrada no espelho`)
  return celula
}

/**
 * Espelho do teste (D4/review #333): EstadoInteracaoPeoes derivado do
 * snapshot dessincronizado — as vagas do clique são calculadas pela MESMA
 * derivação do módulo de interação, sem hardcode de célula/borda.
 */
function estadoInteracaoDoSnapshot(snapshot: EstadoDaPartidaSnapshot): EstadoInteracaoPeoes {
  const celulaPorPecaId = new Map(
    snapshot.tabuleiro.posicionadas.map((peca) => [peca.pecaId, peca.celula]),
  )
  return {
    peoes: snapshot.tabuleiro.peoes.map((peao) => ({
      peaoId: peao.peaoId,
      cor: peao.cor,
      celula: peao.pecaId === null ? null : (celulaPorPecaId.get(peao.pecaId) ?? null),
    })),
    posicionadas: snapshot.tabuleiro.posicionadas,
    recebidasPendentes: snapshot.tabuleiro.recebidas,
    peaoSelecionadoId: null,
    peaoDoTurnoId: 'peao-branco',
    pecaSelecionadaId: null,
    posicaoConfirmadaNoTurno: true,
    movimentouNoTurno: true,
  }
}

// Issue #326: com Recebidas pendentes e o espelho sem seleção (dessincronia
// pós-confirmação — snapshot com peaoSelecionadoId null), o clique na vaga
// EMITE ESCOLHER_VAGA_DA_PECA_RECEBIDA via o fallback do peão do turno.
test('encaixe pós-confirmação com espelho sem seleção usa o peão do turno (#326)', async () => {
  const user = userEvent.setup()
  renderPartida()
  const ws = await conectarSocketDaPartida()
  act(() => {
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: MEU_JOGADOR_ID,
      apelido: 'JogadorTeste',
      partidaId: 'p',
      estado: 'em_andamento',
    })
  })
  await screen.findByTestId('tabuleiro')

  // Estado pós-confirmação íntegro: peão selecionado + pendência corrente.
  act(() => {
    ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshot('peao-branco') })
  })
  // Dessincronia: um re-sync traz o espelho SEM seleção (o servidor mantém a
  // do peão confirmado; o snapshot antigo/sem o campo não a carrega).
  act(() => {
    ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshot(null) })
  })

  // A vaga clicada deriva do fallback (peão do turno) — mesma função que o
  // roteador usa no clique; nada de célula/borda fixados no teste.
  const vagas = vagasDisponiveisDoPeao(estadoInteracaoDoSnapshot(criarSnapshot(null)))
  const vaga = vagas[0]
  if (!vaga) throw new Error('fallback deveria derivar ao menos uma vaga')

  // Puxar a corrente da bandeja.
  const corrente = screen.getByTestId('caixa-peca-sorteada')
  expect(corrente.getAttribute('data-puxada')).toBe('false')
  await user.click(corrente)
  expect(screen.getByTestId('caixa-peca-sorteada').getAttribute('data-puxada')).toBe('true')

  // Clique na célula da vaga derivada — com o fallback, o comando vai ao wire
  // em vez de clique mudo.
  await user.click(celulaDoEspelho(vaga.celula.linha, vaga.celula.coluna))
  await waitFor(() => {
    const comandos = ws.sentMessages.map((m) => JSON.parse(m) as Record<string, unknown>)
    const escolha = comandos.find(
      (c) => (c as { type?: string }).type === 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
    )
    expect(escolha).toBeDefined()
    expect(escolha).toMatchObject({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-reta-9',
      borda: vaga.borda,
    })
  })
})
