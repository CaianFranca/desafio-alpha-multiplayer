import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'

// Issue #91: conexão do frontend com o game-server para peões e ciclo.
// O canal da Partida exige jogadorId em TODOS os comandos (wire.ts do
// game-server) — os cliques no espelho DOM trafegam pelo mesmo roteador da
// cena (despacharCliqueDeCelula / mapearCliqueNaReservaComCiclo) e o
// PartidaPage injeta o jogadorId num ponto único (enviarComJogador).

const JOGADOR_ID = mockAuthenticatedState.jogador.id

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

async function partidaDisponivel() {
  renderPartidaNaRota('/partida?serverId=server-1&partidaId=partida-1')
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

function celulaDoEspelho(linha: number, coluna: number): HTMLElement {
  const celula = screen.getAllByTestId('tabuleiro-celula').find(
    (el) =>
      el.getAttribute('data-linha') === String(linha) &&
      el.getAttribute('data-coluna') === String(coluna),
  )
  if (!celula) throw new Error(`célula ${linha}:${coluna} não encontrada no espelho`)
  return celula
}

function pecaDaReserva(pecaId: string): HTMLElement {
  const peca = screen
    .getAllByTestId('reserva-peca')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)
  if (!peca) throw new Error(`peça ${pecaId} não encontrada na reserva do espelho`)
  return peca
}

function pendenciaDoEspelho(recebidaId: string): HTMLElement {
  const pendencia = screen
    .getAllByTestId('recebida-pendente')
    .find((el) => el.getAttribute('data-recebida-id') === recebidaId)
  if (!pendencia) throw new Error(`pendência ${recebidaId} não encontrada no espelho`)
  return pendencia
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida conectada ao ciclo do peão (issue #91)', () => {
  it('pós-admissão o espelho mostra os 4 peões seedados, sobre a Mesa (US 1 / AC 2)', async () => {
    await partidaDisponivel()
    const peoes = screen.getAllByTestId('peao')
    expect(peoes).toHaveLength(4)
    expect(peoes.map((p) => p.getAttribute('data-peao-id'))).toEqual([
      'peao-branco',
      'peao-vermelho',
      'peao-azul',
      'peao-amarelo',
    ])
    for (const peao of peoes) {
      expect(peao.getAttribute('data-posicionado')).toBe('false')
      expect(peao.getAttribute('data-selecionado')).toBe('false')
    }
  })

  it('fluxo feliz do ciclo: cada comando trafega com jogadorId (AC 1 / AC 2)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    // ── Peça Inicial posicionada pelo servidor ──
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
    })

    // ── 1. Clique no peão → SELECIONAR_PEAO com jogadorId ──
    await user.click(peaoDoEspelho('branco'))
    expect(ultimoComando(ws)).toEqual({
      type: 'SELECIONAR_PEAO',
      peaoId: 'peao-branco',
      jogadorId: JOGADOR_ID,
    })

    // ── Servidor confirma seleção, posiciona o peão e gera o Recebimento ──
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'PEAO_POSICIONADO',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
      })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        ],
      })
    })

    // ── 2. Clique na célula-alvo da pendência SEM tipo → foco local (sem comando) ──
    const alvo = celulaDoEspelho(2, 3)
    expect(alvo.getAttribute('data-alvo-pendente')).toBe('true')
    await user.click(alvo)
    // Nenhum comando novo: foco é estado local.
    expect(ws.sentMessages).toHaveLength(1)
    expect(pendenciaDoEspelho('recebida-norte').getAttribute('data-focada')).toBe('true')
    expect(alvo.getAttribute('data-focada')).toBe('true')

    // ── 3. Clique na peça da Reserva → ESCOLHER_TIPO_DA_PECA_RECEBIDA ──
    await user.click(pecaDaReserva('reta-1'))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-norte',
      tipoDaPeca: 'reta',
      jogadorId: JOGADOR_ID,
    })

    // ── 4. Servidor escolhe o tipo: peça consumida da Reserva, pendência tipada ──
    act(() => {
      ws.simulateMessage({
        type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-norte',
        pecaId: 'reta-1',
        tipoDaPeca: 'reta',
      })
    })
    // As peças consumidas saem da Reserva sem recarregar (AC 2):
    // 22 iniciais - inicial-1 (posicionada) - reta-1 (escolhida) = 20.
    expect(screen.queryAllByTestId('reserva-peca')).toHaveLength(20)
    expect(
      screen
        .getAllByTestId('reserva-peca')
        .some((el) => el.getAttribute('data-peca-id') === 'reta-1'),
    ).toBe(false)
    expect(pendenciaDoEspelho('recebida-norte').getAttribute('data-peca-id')).toBe('reta-1')

    // ── 5. Servidor fecha a Manipulação da Inicial (finalização por clique) ──
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })

    // ── 6. GIRAR_PECA da Recebida via botão (pecaSelecionadaId = reta-1) ──
    const girarHorario = screen.getByTestId('girar-horario')
    expect(girarHorario).not.toBeDisabled()
    await user.click(girarHorario)
    expect(ultimoComando(ws)).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-1',
      sentido: 'horario',
      jogadorId: JOGADOR_ID,
    })

    // ── 7. Clique no alvo da pendência tipada → POSICIONAR_PECA ──
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // ── 8. Servidor encaixa: pendência some, manipulação abre ──
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'reta-1' })
    })
    expect(screen.queryByTestId('recebida-pendente')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(2)

    // ── 9. Movimentação: destino conectado → MOVER_PEAO com jogadorId ──
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // ── 10. PEAO_MOVIDO limpa a seleção: destinos deixam de reagir ──
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 2, coluna: 3 },
      })
    })
    expect(peaoDoEspelho('branco').getAttribute('data-selecionado')).toBe('false')
    const comandosAteAqui = ws.sentMessages.length
    // Clique em célula vazia SEM seleção: sem seleção fantasma → nada enviado.
    await user.click(celulaDoEspelho(3, 4))
    expect(ws.sentMessages).toHaveLength(comandosAteAqui)
  })

  it('rejeição local: com pendências, clicar outro peão produz flash vermelho e NÃO envia comando (AC 3)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        ],
      })
    })
    // Flash branco dos eventos expira sozinho.
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    const comandosAntes = ws.sentMessages.length
    await user.click(peaoDoEspelho('vermelho'))

    // Nenhum comando novo e seleção otimista bloqueada.
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    expect(peaoDoEspelho('vermelho').getAttribute('data-selecionado')).toBe('false')

    const flash = await screen.findByTestId('flash-overlay')
    expect(flash.getAttribute('data-cor')).toBe('vermelho')
  })

  it('rejeição do serviço (ERRO_DO_TABULEIRO) produz flash vermelho distinto (AC 3)', async () => {
    const ws = await partidaDisponivel()

    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PENDENCIA_NAO_RESOLVIDA',
        mensagem: 'Há Peças Recebidas pendentes.',
      }),
    )

    const flash = await screen.findByTestId('flash-overlay')
    expect(flash.getAttribute('data-cor')).toBe('vermelho')
    // Issue #118: pendências não resolvidas carregam o motivo específico.
    expect(flash.getAttribute('data-motivo')).toBe('pendencia_nao_resolvida')
  })

  it('pós-confirmação: clicar destino conectado NÃO envia MOVER_PEAO e pisca âmbar (AC3, review #165)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    // Turno meu, rodada 2: peão posicionado na Inicial e movido à reta vizinha.
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'PEAO_POSICIONADO',
        peaoId: 'peao-branco',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
      })
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 2, coluna: 3 },
      })
    })
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    // Fase 'confirmar' → botão envia CONFIRMAR_POSICAO_DO_PEAO; servidor confirma.
    await user.click(screen.getByTestId('botao-confirmar-posicao'))
    expect(ultimoComando(ws)).toEqual({
      type: 'CONFIRMAR_POSICAO_DO_PEAO',
      peaoId: 'peao-branco',
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'reta-1',
      })
    })
    await waitFor(() => expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument())

    // Re-seleção aceita pelo servidor: a seleção volta ao peão confirmado.
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })

    const comandosAntes = ws.sentMessages.length
    await user.click(celulaDoEspelho(3, 3))

    // Guard AC3: nenhum comando trafega e o feedback é âmbar com motivo
    // específico (espelha o FORA_DA_VEZ que o servidor responderia).
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    const flash = await screen.findByTestId('flash-overlay')
    expect(flash.getAttribute('data-cor')).toBe('ambar')
    expect(flash.getAttribute('data-motivo')).toBe('posicao_confirmada')
  })
})
