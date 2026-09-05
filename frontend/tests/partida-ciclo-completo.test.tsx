import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { EstadoDaPartidaSnapshot, PecaPosicionadaNoSnapshot } from '@flicker/shared'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'

// F4 (#145-exp) — capstone do ciclo completo PELA UI: objetivo global
// derivado ao vivo (POSICAO_CONFIRMADA → conquistas do HUD #226), peões
// por CLIQUE (destinos da F1 emitindo MOVER_PEAO) até o servidor (simulado)
// declarar PARTIDA_TERMINADA; e a derrota por Caixa Esgotada decrescendo a
// contagem até 0 antes do término com o motivo da F2. É teste de CLIENTE: o
// funil autoritativo de término vive no engine (já coberto lá) — aqui se
// orquestra exatamente os eventos que o game-server enviaria.

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

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

function renderPartida(codigoSala: string | null) {
  const mockCtx = mockSalaContext(codigoSala)
  const router = createMemoryRouter(
    [
      { path: '/partida', element: <PartidaPage /> },
      { path: '/sala/:codigoDeSala', element: <div data-testid="sala-pagina">sala</div> },
      { path: '/salas/criar', element: <div data-testid="criar-pagina">criar</div> },
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
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false },
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
    ...overrides,
  }
}

async function partidaDisponivel(codigoSala: string | null = 'A3K9M2') {
  renderPartida(codigoSala)
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
  await screen.findByTestId('tabuleiro')
  return ws
}

function ultimoComando(ws: MockWebSocket): Record<string, unknown> {
  expect(ws.sentMessages.length).toBeGreaterThan(0)
  return JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]!)
}

function peaoDoEspelho(cor: string): HTMLElement {
  const peao = screen
    .getAllByTestId('peao')
    .find((el) => el.getAttribute('data-peao-id') === `peao-${cor}`)
  if (!peao) throw new Error(`peão ${cor} não encontrado no espelho`)
  return peao
}

function pecaDoEspelho(pecaId: string): HTMLElement {
  const peca = screen
    .getAllByTestId('peca-posicionada')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)
  if (!peca) throw new Error(`peça ${pecaId} não encontrada no espelho`)
  return peca
}

const INICIAL_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'inicial-1',
  tipo: 'inicial',
  orientacao: 0,
  celula: { linha: 3, coluna: 3 },
}
const PORTAO_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'portao-1',
  tipo: 'portao_de_saida',
  orientacao: 0,
  celula: { linha: 3, coluna: 4 },
}
const GERADOR_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'gerador-1',
  tipo: 'gerador',
  orientacao: 0,
  celula: { linha: 1, coluna: 2 },
}
const GERADOR_2: PecaPosicionadaNoSnapshot = {
  pecaId: 'gerador-2',
  tipo: 'gerador',
  orientacao: 0,
  celula: { linha: 1, coluna: 4 },
}
const GERADOR_3: PecaPosicionadaNoSnapshot = {
  pecaId: 'gerador-3',
  tipo: 'gerador',
  orientacao: 0,
  celula: { linha: 5, coluna: 2 },
}
const SALA_DIRETOR_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'sala-do-diretor-1',
  tipo: 'sala_do_diretor',
  orientacao: 0,
  celula: { linha: 5, coluna: 4 },
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('ciclo completo pela UI — vitória no Portão e retorno à sala (#145-exp F4)', () => {
  it('objetivos derivados ao vivo + peões ao Portão por clique → PARTIDA_TERMINADA vitoria → overlay → voltar à sala', async () => {
    const ws = await partidaDisponivel('A3K9M2')

    // Tabuleiro: os 4 peões na Inicial vizinha conectada ao Portão (leste);
    // geradores e sala do diretor posicionados para a derivação dos chips.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            posicionadas: [INICIAL_1, PORTAO_1, GERADOR_1, GERADOR_2, GERADOR_3, SALA_DIRETOR_1],
            peoes: [
              { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
              { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'inicial-1' },
              { peaoId: 'peao-azul', cor: 'azul', pecaId: 'inicial-1' },
              { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: 'inicial-1' },
            ],
          },
        }),
      }),
    )
    expect(await screen.findByTestId('hud-da-partida')).toBeInTheDocument()

    // Objetivo Global derivado ao vivo pelos eventos existentes (issue #145):
    // cada confirmação acende uma conquista do HUD (#226); o TURNO_INICIADO
    // seguinte reabre a janela do turno (espelha a serialização real).
    for (const pecaId of ['gerador-1', 'gerador-2', 'gerador-3', 'sala-do-diretor-1']) {
      act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 2 }))
      act(() =>
        ws.simulateMessage({
          type: 'POSICAO_CONFIRMADA',
          jogadorId: MEU_JOGADOR_ID,
          peaoId: 'peao-branco',
          pecaId,
        }),
      )
    }
    // Conquistas no HUD (issue #226): cada confirmação acende 1 gerador; a
    // 4ª (cartão) acende na confirmação da Sala do Diretor.
    function geradoresAcesos(): number {
      return screen
        .getAllByTestId('hud-conquista-gerador')
        .filter((el) => el.getAttribute('data-acesa') === 'true').length
    }
    await waitFor(() => expect(geradoresAcesos()).toBe(3))
    expect(screen.getByTestId('hud-conquista-cartao')).toHaveAttribute('data-acesa', 'true')
    // Última confirmação travou a posição do turno (AC3); o turno seguinte
    // reabre a janela — mesma serialização do jogo real.
    act(() => ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 3 }))
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    // Convergência ao Portão POR CLIQUE — a exceção de ocupação (teto 4) da
    // F1 mantém cada portão intermediário como destino válido.
    const user = userEvent.setup()
    for (const cor of ['branco', 'vermelho', 'azul', 'amarelo']) {
      await user.click(peaoDoEspelho(cor))
      expect(ultimoComando(ws)).toEqual({
        type: 'SELECIONAR_PEAO',
        peaoId: `peao-${cor}`,
        jogadorId: MEU_JOGADOR_ID,
      })
      act(() => ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: `peao-${cor}` }))
      // O Portão segue destino destacado para o peão recém-selecionado.
      expect(pecaDoEspelho('portao-1').getAttribute('data-conectada')).toBe('true')
      await user.click(pecaDoEspelho('portao-1'))
      expect(ultimoComando(ws)).toEqual({
        type: 'MOVER_PEAO',
        peaoId: `peao-${cor}`,
        celula: { linha: 3, coluna: 4 },
        jogadorId: MEU_JOGADOR_ID,
      })
      act(() =>
        ws.simulateMessage({
          type: 'PEAO_MOVIDO',
          peaoId: `peao-${cor}`,
          pecaIdDe: 'inicial-1',
          pecaIdPara: 'portao-1',
          celula: { linha: 3, coluna: 4 },
        }),
      )
    }
    // Os 4 peões reunidos no Portão (condição de vitória do engine).
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('peao')
          .filter((el) => el.getAttribute('data-posicionado') === 'true'),
      ).toHaveLength(4),
    )

    // Servidor (simulado) consome o desfecho: vitória nunca carrega motivo.
    act(() => ws.simulateMessage({ type: 'PARTIDA_TERMINADA', resultado: 'vitoria' }))
    const overlay = await screen.findByTestId('overlay-resultado')
    expect(overlay).toHaveAttribute('data-resultado', 'vitoria')
    expect(overlay).toHaveAttribute('data-motivo', '')
    expect(overlay).toHaveTextContent('Vitória!')

    // Retorno à sala pela UI (navegação + WS encerrado, sem reconexão).
    const wsInst = MockWebSocket.last()!
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
    expect(wsInst.onclose).toBeNull()
  })
})

describe('ciclo completo pela UI — derrota por Caixa Esgotada (#145-exp F4)', () => {
  it('sorteios até o esgotamento → PARTIDA_TERMINADA derrota/caixa_esgotada → overlay com o motivo', async () => {
    const ws = await partidaDisponivel('A3K9M2')

    // Baseline do snapshot: 2 peças na Caixa, objetivos incompletos (sem
    // monstros em cena — a derrota aqui é contagem, não ataque). A contagem
    // da Caixa não é mais exibida no HUD (#226); o fluxo segue até o término
    // com o motivo da F2.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            posicionadas: [INICIAL_1, GERADOR_1],
            pecasRestantesNaCaixa: 2,
          },
        }),
      }),
    )
    expect(await screen.findByTestId('hud-da-partida')).toBeInTheDocument()

    // Sequência de sorteios até 0 — decremento ao vivo por PECA_SORTEADA
    // inédita (regra #145, coberta em tabuleiro-reducao.test.ts); o sorteio
    // em si não pisca flash.
    act(() =>
      ws.simulateMessage({ type: 'PECA_SORTEADA', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 }),
    )
    await waitFor(() => expect(screen.getByTestId('hud-da-partida')).toBeInTheDocument())
    act(() =>
      ws.simulateMessage({ type: 'PECA_SORTEADA', pecaId: 'reta-2', tipoDaPeca: 'reta', orientacao: 0 }),
    )
    await waitFor(() => expect(screen.getByTestId('hud-da-partida')).toBeInTheDocument())
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    // Caixa Esgotada sem objetivos alcançáveis → o funil do engine (testado
    // lá) chega ao cliente como término com o motivo da F2.
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
    expect(overlay).toHaveTextContent('Derrota')
    expect(overlay).toHaveTextContent('A Caixa esgotou antes de a equipe completar a fuga')

    // Retorno à sala também pelo caminho da derrota.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('voltar-a-sala'))
    expect(await screen.findByTestId('sala-pagina')).toBeInTheDocument()
  })
})
