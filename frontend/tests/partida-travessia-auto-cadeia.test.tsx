import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { Celula, EstadoDaPartidaSnapshot, Orientacao } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

interface PendenciaTravada {
  readonly recebidaId: string
  readonly pecaId: string
  readonly tipo: 'reta' | 'vulto'
  readonly orientacao: Orientacao
  readonly vaga: null
  readonly celulaAlvo: Celula
}

// Auto-cadeia da Travessia do Escuro (ADR-0014 / issue #377): o FE encadeia
// MOVER + CONFIRMAR (e SELECIONAR+PERMANECER no Monstro) sozinho — sem teste
// de integração até aqui. Cenário central = RE-ADMISSÃO no meio da travessia:
// o ESTADO_DA_PARTIDA (readmissão/reconexão/HMR) agora CARREGA a fase
// (atravessouNoTurno + pendência travada) — antes o `false`/`null` forçado
// órfã a fase: marcadores reapareciam e o auto-mover nunca disparava (Bug 2).

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

function mockSalaContext(): UseSalaWebSocketReturn {
  return {
    sala: null,
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
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/sala/:codigoDeSala', element: <div data-testid="sala-pagina">sala</div> },
    ],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <SalaWebSocketContext.Provider value={mockSalaContext() as unknown as UseSalaWebSocketReturn}>
        <RouterProvider router={router} />
      </SalaWebSocketContext.Provider>
    </AuthProvider>,
  )
}

// Rodada 2, turno do Jogador local em Baixa Iluminação, com a Travessia em
// curso RE-ADMITIDA no meio: atravessouNoTurno === true (wire) + pendência
// travada (vaga nula, célula-alvo fixada em (2,3), norte de inicial-1).
function criarSnapshotDaTravessia(pendente: PendenciaTravada): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0, celula: { linha: 0, coluna: 0 } },
        { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 6 } },
        { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 0 } },
      ],
      iniciais: [],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'inicial-2' },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: 'inicial-3' },
        { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-4' },
      ],
      recebidas: [pendente],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 80,
    },
    jogadores: [
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: true, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: 'inicial-1',
    posicaoConfirmada: false,
    atravessouNoTurno: true,
    pecaDaTravessiaId: null,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
  }
}

// Snapshot de um turno em Baixa PRONTO para o gesto de travessia (nada
// atravessado ainda): peão do ator selecionado sobre a Peça do início, sem
// pendências. `tabuleiroExtra` sobrescreve partes do tabuleiro (ex.: para
// materializar uma peça vizinha, destino da ida-e-volta de outro Jogador).
function criarSnapshotEmBaixaPronta(
  tabuleiroExtra?: Partial<EstadoDaPartidaSnapshot['tabuleiro']>,
): EstadoDaPartidaSnapshot {
  const base: EstadoDaPartidaSnapshot['tabuleiro'] = {
    posicionadas: [
      { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
      { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0, celula: { linha: 0, coluna: 0 } },
      { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 6 } },
      { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 0 } },
    ],
    iniciais: [],
    peoes: [
      { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
      { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'inicial-2' },
      { peaoId: 'peao-azul', cor: 'azul', pecaId: 'inicial-3' },
      { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-4' },
    ],
    recebidas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
    peaoSelecionadoId: 'peao-branco',
    pecasRestantesNaCaixa: 80,
  }
  return {
    tabuleiro: { ...base, ...tabuleiroExtra },
    jogadores: [
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: true, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: 'inicial-1',
    posicaoConfirmada: false,
    atravessouNoTurno: false,
    pecaDaTravessiaId: null,
    celulasIluminadas: [],
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
      (el) => el.getAttribute('data-linha') === String(linha) && el.getAttribute('data-coluna') === String(coluna),
    )
  if (!celula) throw new Error(`célula ${linha},${coluna} não encontrada`)
  return celula
}

function celulasComTravessia(): HTMLElement[] {
  return screen.getAllByTestId('tabuleiro-celula').filter((el) => el.getAttribute('data-travessia') === 'true')
}

async function partidaReAdmitida(pendente: PendenciaTravada) {
  renderPartida()
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
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotDaTravessia(pendente) }))
  await screen.findByTestId('tabuleiro')
  return ws
}

async function partidaEmBaixaPronta(tabuleiroExtra?: Partial<EstadoDaPartidaSnapshot['tabuleiro']>) {
  renderPartida()
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
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotEmBaixaPronta(tabuleiroExtra) }))
  await screen.findByTestId('tabuleiro')
  return ws
}

function comandos(ws: MockWebSocket): Record<string, unknown>[] {
  return ws.sentMessages.map((m) => JSON.parse(m))
}

function comandosDoTipo(ws: MockWebSocket, tipo: string): Record<string, unknown>[] {
  return comandos(ws).filter((c) => c.type === tipo)
}

function ultimoComando(ws: MockWebSocket): Record<string, unknown> {
  const enviados = comandos(ws)
  return enviados[enviados.length - 1]
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('auto-cadeia da Travessia re-admitida (ADR-0014 / issue #377, Bug 2)', () => {
  it('peça comum: auto-ESCOLHA → OK → auto-MOVER → PEAO_MOVIDO → auto-CONFIRMAR; marcadores somem', async () => {
    const pendencia: PendenciaTravada = {
      recebidaId: 'recebida-travessia',
      pecaId: 'reta-9',
      tipo: 'reta',
      orientacao: 0 as Orientacao,
      vaga: null,
      celulaAlvo: { linha: 2, coluna: 3 },
    }
    const ws = await partidaReAdmitida(pendencia)

    // Readmissão no meio da travessia: a pendência travada mantém o marcador
    // (a fase veio no wire — sem órfã).
    expect(celulaDoEspelho(2, 3).getAttribute('data-travessia')).toBe('true')

    // Auto-ESCOLHA da vaga travada (1 clique, sem o segundo clique).
    await waitFor(() =>
      expect(comandosDoTipo(ws, 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')).toHaveLength(1),
    )
    expect(comandosDoTipo(ws, 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')[0]).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-travessia',
      borda: 'norte',
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-travessia',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      }),
    )

    // MANTIDO da pendência pendente: aqui o jogador giraria/daria OK; a peça
    // encaixa (server) — o auto-MOVER dispara sozinho para a peça colocada.
    act(() =>
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'reta-9', celula: { linha: 2, coluna: 3 }, orientacao: 0 }),
    )
    await waitFor(() => expect(comandosDoTipo(ws, 'MOVER_PEAO')).toHaveLength(1))
    expect(comandosDoTipo(ws, 'MOVER_PEAO')[0]).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
      jogadorId: MEU_JOGADOR_ID,
    })
    // A travessia fechou: marcador sumiu (Bug 2 — antes persistia).
    await waitFor(() => expect(celulasComTravessia()).toHaveLength(0))

    // Ack do mover → auto-CONFIRMAR (caí direto no Encerrar).
    act(() =>
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-9',
        celula: { linha: 2, coluna: 3 },
      }),
    )
    await waitFor(() => expect(comandosDoTipo(ws, 'CONFIRMAR_POSICAO_DO_PEAO')).toHaveLength(1))
    expect(comandosDoTipo(ws, 'CONFIRMAR_POSICAO_DO_PEAO')[0]).toEqual({
      type: 'CONFIRMAR_POSICAO_DO_PEAO',
      peaoId: 'peao-branco',
      jogadorId: MEU_JOGADOR_ID,
    })
  })

  it('peça Monstro: sem auto-MOVER — auto-PERMANECER fecha o turno travado', async () => {
    const pendencia: PendenciaTravada = {
      recebidaId: 'recebida-monstro',
      pecaId: 'vulto-x',
      tipo: 'vulto',
      orientacao: 0 as Orientacao,
      vaga: null,
      celulaAlvo: { linha: 2, coluna: 3 },
    }
    const ws = await partidaReAdmitida(pendencia)

    await waitFor(() =>
      expect(comandosDoTipo(ws, 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')).toHaveLength(1),
    )
    act(() =>
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-monstro',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      }),
    )
    act(() =>
      ws.simulateMessage({ type: 'PECA_POSICIONADA', pecaId: 'vulto-x', celula: { linha: 2, coluna: 3 }, orientacao: 0 }),
    )
    // Monstro não aceita peão: o auto-permanecer entra no lugar do auto-mover.
    await waitFor(() => expect(comandosDoTipo(ws, 'PERMANECER')).toHaveLength(1))
    expect(comandosDoTipo(ws, 'PERMANECER')[0]).toEqual({
      type: 'PERMANECER',
      peaoId: 'peao-branco',
      jogadorId: MEU_JOGADOR_ID,
    })
    expect(comandosDoTipo(ws, 'MOVER_PEAO')).toHaveLength(0)
  })

  it('ao vivo (peça comum): clique na vaga → lote → auto-ESCOLHA → OK → auto-MOVER → auto-CONFIRMAR → auto-ENCERRAR', async () => {
    const user = userEvent.setup()
    const ws = await partidaEmBaixaPronta()

    // Marcador da vaga escura (Peão do ator selecionado na Peça do início, em Baixa).
    expect(celulaDoEspelho(2, 3).getAttribute('data-travessia')).toBe('true')

    // 1. Clique na vaga escura → ATRAVESSAR_O_ESCURO (primeiro clique do jogador).
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ATRAVESSAR_O_ESCURO',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
      jogadorId: MEU_JOGADOR_ID,
    })

    // 2. Lote do servidor (mesmo tick): atravessou + sorteio + recebimento travado.
    act(() => {
      ws.simulateMessage({ type: 'ATRAVESSOU_O_ESCURO', peaoId: 'peao-branco', celula: { linha: 2, coluna: 3 } })
      ws.simulateMessage({ type: 'PECA_SORTEADA', pecaId: 'reta-9', tipoDaPeca: 'reta', orientacao: 0 })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          {
            recebidaId: 'recebida-travessia',
            pecaId: 'reta-9',
            tipoDaPeca: 'reta',
            orientacao: 0,
            vaga: null,
            celulaAlvo: { linha: 2, coluna: 3 },
          },
        ],
      })
    })

    // 3. Auto-ESCOLHA da vaga travada (sem segundo clique).
    await waitFor(() =>
      expect(comandosDoTipo(ws, 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')).toHaveLength(1),
    )
    expect(comandosDoTipo(ws, 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')[0]).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-travessia',
      borda: 'norte',
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-travessia',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      }),
    )

    // 4. OK (clique no alvo pendente) → POSICIONAR_PECA; a peça encaixa (server).
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-9',
      celula: { linha: 2, coluna: 3 },
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-9',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      }),
    )

    // 5. Auto-MOVER para a peça colocada (sem clique — o Bug 1 do relato:
    // após o OK o peão não ia para o destino).
    await waitFor(() => expect(comandosDoTipo(ws, 'MOVER_PEAO')).toHaveLength(1))
    expect(comandosDoTipo(ws, 'MOVER_PEAO')[0]).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-9',
        celula: { linha: 2, coluna: 3 },
      }),
    )

    // 6. Auto-CONFIRMAR (sem clique).
    await waitFor(() =>
      expect(comandosDoTipo(ws, 'CONFIRMAR_POSICAO_DO_PEAO')).toHaveLength(1),
    )
    expect(comandosDoTipo(ws, 'CONFIRMAR_POSICAO_DO_PEAO')[0]).toEqual({
      type: 'CONFIRMAR_POSICAO_DO_PEAO',
      peaoId: 'peao-branco',
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-9',
        protegido: false,
      }),
    )

    // 7. Auto-ENCERRAR o turno (sem clique — fechamento de zero cliques).
    await waitFor(() => expect(comandosDoTipo(ws, 'ENCERRAR_TURNO')).toHaveLength(1))
    expect(comandosDoTipo(ws, 'ENCERRAR_TURNO')[0]).toEqual({
      type: 'ENCERRAR_TURNO',
      jogadorId: MEU_JOGADOR_ID,
    })
  })

  it('ao vivo (ida-e-volta): mover à peça vizinha e voltar à origem mantém a vaga escura', async () => {
    const user = userEvent.setup()
    // Peça vizinha a leste (reta-9 em (3,4)): destino da ida-e-volta; a vaga
    // escura (2,3) permanece como travessia (Bug 2: o retorno apagava a opção).
    const ws = await partidaEmBaixaPronta({
      posicionadas: [
        { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        // Orientação 90: a reta abre leste/oeste — oeste aponta à origem (3,3),
        // formando a conexão bidirecional (leste do inicial ↔ oeste da reta).
        { pecaId: 'reta-9', tipo: 'reta', orientacao: 90, celula: { linha: 3, coluna: 4 } },
        { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0, celula: { linha: 0, coluna: 0 } },
        { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 6 } },
        { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0, celula: { linha: 6, coluna: 0 } },
      ],
    })

    // Vaga escura visível ANTES de mover.
    expect(celulaDoEspelho(2, 3).getAttribute('data-travessia')).toBe('true')

    // Ida: clique na peça vizinha → MOVER_PEAO.
    await user.click(celulaDoEspelho(3, 4))
    expect(ultimoComando(ws)).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 3, coluna: 4 },
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-9',
        celula: { linha: 3, coluna: 4 },
      }),
    )

    // Fora da origem (e mesmo tendo movido): SEM vaga escura destacável.
    await waitFor(() => expect(celulasComTravessia()).toHaveLength(0))

    // Volta à origem: clique de volta.
    await user.click(celulaDoEspelho(3, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 3, coluna: 3 },
      jogadorId: MEU_JOGADOR_ID,
    })
    act(() =>
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'reta-9',
        pecaIdPara: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
      }),
    )

    // Bug 2: de volta à Peça do início, a vaga escura REAPARECE (o gesto
    // segue disponível — a restrição é por localização).
    await waitFor(() =>
      expect(celulaDoEspelho(2, 3).getAttribute('data-travessia')).toBe('true'),
    )
  })
})