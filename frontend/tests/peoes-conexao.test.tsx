import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'

// Issue #91 + #143: conexão do frontend com o game-server para peões, ciclo e
// a Caixa sobre a mesa (forma #138: peça sorteada + escolha sequencial de
// vaga). O canal da Partida exige jogadorId em TODOS os comandos (wire.ts do
// game-server) — os cliques no espelho DOM trafegam pelo mesmo roteador da
// cena (despacharCliqueDeCelula / mapearCliqueNaPecaDaMesa) e o PartidaPage
// injeta o jogadorId num ponto único (enviarComJogador).

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

function pendenciaDoEspelho(recebidaId: string): HTMLElement {
  const pendencia = screen
    .getAllByTestId('recebida-pendente')
    .find((el) => el.getAttribute('data-recebida-id') === recebidaId)
  if (!pendencia) throw new Error(`pendência ${recebidaId} não encontrada no espelho`)
  return pendencia
}

function pecaDaMesa(pecaId: string): HTMLElement {
  const peca = screen
    .getAllByTestId('mesa-peca-inicial')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)
  if (!peca) throw new Error(`inicial ${pecaId} não encontrada na mesa do espelho`)
  return peca
}

/** Peça exibida na bandeja de slot único da Caixa (null = bandeja vazia). */
function pecaCorrenteDaBandeja(): HTMLElement | null {
  const elementos = screen.queryAllByTestId('caixa-peca-sorteada')
  expect(elementos.length).toBeLessThanOrEqual(1)
  return elementos[0] ?? null
}

/** Clique na corrente da bandeja → pull (estado local; nenhum comando de wire). */
async function puxarCorrente(user: ReturnType<typeof userEvent.setup>) {
  const corrente = pecaCorrenteDaBandeja()
  if (!corrente) throw new Error('bandeja sem corrente para puxar')
  await user.click(corrente)
}

// Pendência na forma sorteada (#138) como chega no wire.
function recebidaSorteada(
  recebidaId: string,
  pecaId: string,
  tipoDaPeca: string,
) {
  return { recebidaId, pecaId, tipoDaPeca, vaga: null, celulaAlvo: null }
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('partida conectada — Caixa, bandeja e ciclo (#91/#143)', () => {
  it('pós-admissão: espelho mostra os 4 peões seedados e as 4 iniciais na mesa (Caixa com bandeja vazia)', async () => {
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
    // Caixa sobre a mesa: 4 iniciais, sem corrente na bandeja (nada sorteado).
    expect(screen.getByTestId('caixa')).toBeInTheDocument()
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(4)
    expect(pecaCorrenteDaBandeja()).toBeNull()
  })

  it('fluxo feliz do ciclo (#138/#143 + pull #199): puxa, vaga, giro, encaixe — cada comando com jogadorId', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    // Vez do jogador local: donoDoCiclo habilita o pull na bandeja (#199).
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
    })

    // ── Peça Inicial posicionada pelo servidor ──
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
    })
    expect(screen.getAllByTestId('mesa-peca-inicial')).toHaveLength(3)

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
        recebidas: [recebidaSorteada('recebida-1', 'reta-1', 'reta')],
      })
    })

    // ── 2. Bandeja exibe a corrente; sem pull, vaga NÃO destaca nem reage ──
    const corrente = pecaCorrenteDaBandeja()
    expect(corrente).not.toBeNull()
    expect(corrente!.getAttribute('data-peca-id')).toBe('reta-1')
    expect(corrente!.getAttribute('data-tipo')).toBe('reta')
    expect(corrente!.getAttribute('data-puxada')).toBe('false')
    // Alvo inválido sem pull: clique na vaga fica silencioso (#199).
    const comandosAntes = ws.sentMessages.length
    await user.click(celulaDoEspelho(2, 3))
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    expect(celulaDoEspelho(2, 3).hasAttribute('data-vaga')).toBe(false)

    // ── 2b. Puxar a corrente (estado local, sem comando) destrava as vagas ──
    await puxarCorrente(user)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-puxada')).toBe('true')
    expect(celulaDoEspelho(2, 3).getAttribute('data-vaga')).toBe('true')
    expect(celulaDoEspelho(3, 4).getAttribute('data-vaga')).toBe('true')
    expect(celulaDoEspelho(0, 0).hasAttribute('data-vaga')).toBe(false)
    // Puxar não emite comando de wire.
    expect(ws.sentMessages).toHaveLength(comandosAntes)

    // ── 3. Clique na célula vazia vizinha → ESCOLHER_VAGA (para a puxada) ──
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-1',
      borda: 'norte',
      jogadorId: JOGADOR_ID,
    })

    // ── 4. Servidor fixa a vaga: alvo destacado, seleção na peça sorteada ──
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      })
    })
    // A peça saiu da bandeja (vaga definida, aguardando encaixe): sem corrente.
    expect(pecaCorrenteDaBandeja()).toBeNull()
    // A célula (2,3) deixou de ser vaga e virou alvo pendente.
    expect(celulaDoEspelho(2, 3).hasAttribute('data-vaga')).toBe(false)
    expect(celulaDoEspelho(2, 3).getAttribute('data-alvo-pendente')).toBe('true')
    expect(pendenciaDoEspelho('recebida-1').getAttribute('data-peca-id')).toBe('reta-1')
    expect(pendenciaDoEspelho('recebida-1').getAttribute('data-vaga')).toBe('norte')

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

    // ── 7. Clique no alvo da pendência em foco → POSICIONAR_PECA ──
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
    expect(screen.getByTestId('caixa')).toBeInTheDocument()
    expect(pecaCorrenteDaBandeja()).toBeNull()

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

  it('bandeja de slot único: duas pendências, a corrente vira a próxima quando a atual ganha vaga (#143)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
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
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          recebidaSorteada('r1', 'reta-1', 'reta'),
          recebidaSorteada('r2', 'cruz-1', 'cruz'),
        ],
      })
    })

    // Só a PRIMEIRA pendência é visível (slot único): a segunda fica escondida.
    expect(screen.getAllByTestId('caixa-peca-sorteada')).toHaveLength(1)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('reta-1')

    // Puxa a corrente e escolhe vaga norte para r1 → a corrente passa a ser r2.
    await puxarCorrente(user)
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r1',
      borda: 'norte',
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      })
    })
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('cruz-1')
    // A corrente nova exige novo pull: o da r1 não contemplates a r2 (#199).
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-puxada')).toBe('false')

    // Encaixa r1 (foco em reta-1): pendência some; r2 permanece corrente.
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
    })
    expect(screen.getAllByTestId('recebida-pendente')).toHaveLength(1)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('cruz-1')

    // Segunda corrente: puxar → vaga leste → encaixe → bandeja esvazia.
    await puxarCorrente(user)
    await user.click(celulaDoEspelho(3, 4))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r2',
      borda: 'leste',
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r2',
        borda: 'leste',
        celulaAlvo: { linha: 3, coluna: 4 },
      })
    })
    expect(pecaCorrenteDaBandeja()).toBeNull()
    await user.click(celulaDoEspelho(3, 4))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'cruz-1',
      celula: { linha: 3, coluna: 4 },
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'cruz-1',
        celula: { linha: 3, coluna: 4 },
        orientacao: 0,
      })
    })
    expect(screen.queryAllByTestId('recebida-pendente')).toHaveLength(0)
    expect(pecaCorrenteDaBandeja()).toBeNull()
  })

  it('clique em Peça Inicial na mesa emite SELECIONAR_PECA com jogadorId (fallback ST-09, #143)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    await user.click(pecaDaMesa('inicial-3'))
    expect(ultimoComando(ws)).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-3',
      jogadorId: JOGADOR_ID,
    })
  })

  it('com pendências, clique em Inicial da mesa não emite comando (bloqueio local silencioso)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'reta-1', 'reta')],
      })
    })
    await waitFor(() =>
      expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument(),
    )

    const comandosAntes = ws.sentMessages.length
    await user.click(pecaDaMesa('inicial-1'))
    expect(ws.sentMessages).toHaveLength(comandosAntes)
  })

  it('rejeição local: com pendências, clicar outro peão produz flash vermelho e NÃO envia comando (AC 3)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'reta-1', 'reta')],
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

  it('CAIXA_ESGOTADA no ERRO_DO_TABULEIRO produz flash vermelho com motivo (issue #143)', async () => {
    const ws = await partidaDisponivel()

    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'CAIXA_ESGOTADA',
        mensagem: 'A Caixa está vazia.',
      }),
    )

    const flash = await screen.findByTestId('flash-overlay')
    expect(flash.getAttribute('data-cor')).toBe('vermelho')
    expect(flash.getAttribute('data-motivo')).toBe('caixa_esgotada')
  })

  it('pós-confirmação: clicar destino conectado NÃO envia MOVER_PEAO e pisca âmbar (AC3, review #165)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()
    const pecaDoEspelho = (pecaId: string): HTMLElement => {
      const peca = screen
        .getAllByTestId('peca-posicionada')
        .find((el) => el.getAttribute('data-peca-id') === pecaId)
      if (!peca) throw new Error(`peça ${pecaId} não encontrada no espelho`)
      return peca
    }

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
        type: 'PECA_SORTEADA',
        pecaId: 'reta-1',
        tipoDaPeca: 'reta',
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
    })
    // Controle: seleção ativa e SEM confirmação → destino conectado destacado.
    expect(pecaDoEspelho('reta-1').getAttribute('data-conectada')).toBe('true')

    act(() => {
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
    // Destaques de destino somem após confirmar (AC3): nada conecta ao peão.
    expect(pecaDoEspelho('inicial-1').getAttribute('data-conectada')).toBe('false')

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
