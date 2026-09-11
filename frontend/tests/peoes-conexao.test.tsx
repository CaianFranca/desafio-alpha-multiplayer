import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import { toquesDeAudio } from './helpers/mockAudio'
import {
  CAMINHO_SOM_DE_RECUSA,
  VOLUME_BASE_SOM_DE_RECUSA,
} from '../web/src/components/partida/somDeRecusa'
import {
  SOM_CAMINHO_CLIQUE_PEAO,
  SOM_VOLUME_BASE_CLIQUE_PEAO,
} from '../web/src/game/tabuleiro/vooDoPeao'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

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

function pecaPosicionadaDoEspelho(pecaId: string): HTMLElement {
  const peca = screen
    .getAllByTestId('peca-posicionada')
    .find((el) => el.getAttribute('data-peca-id') === pecaId)
  if (!peca) throw new Error(`peça ${pecaId} não encontrada no espelho`)
  return peca
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

  it('fluxo feliz do ciclo (#138/#143 + pull #199 + preview/OK #357): puxa, escolhe a vaga, gira no preview e confirma no OK — cada comando com jogadorId', async () => {
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
    // O encaixe da Inicial abre a janela de Manipulação; o OK que a fechou
    // libera a bandeja para exibir a corrente seguinte (gate da Manipulação).
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
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

    // ── 3. Clique na vaga SÓ escolhe (issue #357: sem encaixe imediato) ──
    // O clique em (2,3) emite SÓ ESCOLHER_VAGA_DA_PECA_RECEBIDA; a peça surge
    // em preview provisório na célula-alvo e o OK (segundo clique na
    // célula-alvo) emite o POSICIONAR_PECA.
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-1',
      borda: 'norte',
      jogadorId: JOGADOR_ID,
    })

    // ── 4. Servidor fixa a vaga: preview provisório aparece, sem encaixe ──
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'recebida-1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      })
    })
    // A peça saiu da bandeja (vaga definida, aguardando o OK): sem corrente,
    // mas com preview provisório na célula-alvo.
    expect(pecaCorrenteDaBandeja()).toBeNull()
    const preview = screen.getByTestId('peca-provisoria')
    expect(preview.getAttribute('data-peca-id')).toBe('reta-1')
    expect(preview.getAttribute('data-tipo')).toBe('reta')
    expect(preview.getAttribute('data-linha')).toBe('2')
    expect(preview.getAttribute('data-coluna')).toBe('3')
    // A célula (2,3) deixou de ser vaga e virou alvo pendente.
    expect(celulaDoEspelho(2, 3).hasAttribute('data-vaga')).toBe(false)
    expect(celulaDoEspelho(2, 3).getAttribute('data-alvo-pendente')).toBe('true')
    expect(pendenciaDoEspelho('recebida-1').getAttribute('data-peca-id')).toBe('reta-1')
    expect(pendenciaDoEspelho('recebida-1').getAttribute('data-vaga')).toBe('norte')

    // ── 4b. OK do preview (clique na célula-alvo) emite o POSICIONAR_PECA ──
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // O encaixe chega na sequência: pendência some, reta-1 entra na mesa.
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
    })
    expect(screen.queryByTestId('recebida-pendente')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(2)
    expect(screen.getByTestId('caixa')).toBeInTheDocument()
    expect(pecaCorrenteDaBandeja()).toBeNull()

    // ── 5. GIRAR_PECA pós-encaixe (janela de Manipulação aberta para reta-1) ──
    // Rota pelo atalho de teclado R (os botões DOM de giro saíram; o overlay
    // 3D é inacessível no jsdom — o seam data-manipulacao cobre a cena).
    expect(pecaPosicionadaDoEspelho('reta-1').getAttribute('data-manipulacao')).toBe('true')
    await user.keyboard('r')
    expect(ultimoComando(ws)).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-1',
      sentido: 'horario',
      jogadorId: JOGADOR_ID,
    })

    // ── 6. Movimentação: destino conectado → MOVER_PEAO com jogadorId ──
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // ── 7. PEAO_MOVIDO mantém a seleção: o peão segue selecionado ──
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 2, coluna: 3 },
      })
    })
    expect(peaoDoEspelho('branco').getAttribute('data-selecionado')).toBe('true')
    const comandosAteAqui = ws.sentMessages.length
    // Clique em célula vazia (sem peça em manipulação): nada enviado —
    // sem seleção de peça fantasma → sem POSICIONAR_PECA.
    await user.click(celulaDoEspelho(3, 4))
    expect(ws.sentMessages).toHaveLength(comandosAteAqui)
  })

  it('duplo-clique rápido na vaga não reenvia a escolha (gate por recebidaId, review #338)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
    })
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'inicial-1',
        celula: { linha: 3, coluna: 3 },
        orientacao: 0,
      })
    })
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })
    await user.click(peaoDoEspelho('branco'))
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
    await puxarCorrente(user)

    // Dois cliques na mesma vaga sem ack entre eles: só a primeira escolha
    // (e seu encaixe) é enviada — a segunda é bloqueada pelo gate em voo.
    await user.click(celulaDoEspelho(2, 3))
    await user.click(celulaDoEspelho(2, 3))
    const escolhas = ws.sentMessages
      .map((m) => JSON.parse(m) as Record<string, unknown>)
      .filter((c) => c['type'] === 'ESCOLHER_VAGA_DA_PECA_RECEBIDA')
    expect(escolhas).toHaveLength(1)
  })

  it('bandeja de slot único: escolha + OK encaixa cada corrente (r1→r2→esvazia) (#143/#357)', async () => {
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
    // Fecha a janela de Manipulação da Inicial (gate): só então a corrente r1
    // aparece na bandeja.
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })

    // Só a PRIMEIRA pendência é visível (slot único): a segunda fica escondida.
    expect(screen.getAllByTestId('caixa-peca-sorteada')).toHaveLength(1)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('reta-1')

    // Puxa a corrente e o clique na vaga norte SÓ escolhe a vaga de r1
    // (issue #357: sem encaixe imediato) — o OK (clique na célula-alvo do
    // preview) emite o POSICIONAR_PECA.
    await puxarCorrente(user)
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r1',
      borda: 'norte',
      jogadorId: JOGADOR_ID,
    })

    // Servidor fixa a vaga de r1: preview provisório aparece e a corrente
    // vira r2, exigindo novo pull.
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      })
    })
    expect(screen.getByTestId('peca-provisoria').getAttribute('data-peca-id')).toBe('reta-1')
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('cruz-1')
    // A corrente nova exige novo pull: o da r1 não contempla a r2 (#199).
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-puxada')).toBe('false')

    // OK do preview de r1: clique na célula-alvo posiciona reta-1.
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // Encaixe confirmado na sequência: r1 some da lista; r2 permanece corrente.
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'reta-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
    })
    // Fecha a janela de reta-1 (gate): a corrente r2 volta à bandeja.
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'reta-1' })
    })
    expect(screen.getAllByTestId('recebida-pendente')).toHaveLength(1)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-peca-id')).toBe('cruz-1')

    // Segunda corrente: puxar → escolha na vaga leste → OK no preview (r2).
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
    // Aprovações sem recusa: só o clique da seleção (#242), sem clarão.
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    const comandosAntes = ws.sentMessages.length
    await user.click(pecaDaMesa('inicial-1'))
    expect(ws.sentMessages).toHaveLength(comandosAntes)
  })

  it('rejeição local: com pendências, clicar outro peão toca som de recusa e NÃO envia comando (AC 3)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'reta-1', 'reta')],
      })
    })
    // Aprovações sem recusa (só o clique da seleção, #242).
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    const comandosAntes = ws.sentMessages.length
    await user.click(peaoDoEspelho('vermelho'))

    // Nenhum comando novo e seleção otimista bloqueada.
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    expect(peaoDoEspelho('vermelho').getAttribute('data-selecionado')).toBe('false')

    // Som de recusa com motivo + anúncio, sem clarão (após o clique da seleção).
    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[1]).toMatchObject({ src: CAMINHO_SOM_DE_RECUSA, volume: VOLUME_BASE_SOM_DE_RECUSA })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('pendencia_nao_resolvida')
    expect(anuncio).toHaveTextContent('peças recebidas pendentes')
  })

  it('rejeição do serviço (ERRO_DO_TABULEIRO) toca som de recusa com motivo (AC 3)', async () => {
    const ws = await partidaDisponivel()

    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'PENDENCIA_NAO_RESOLVIDA',
        mensagem: 'Há Peças Recebidas pendentes.',
      }),
    )

    expect(toquesDeAudio).toHaveLength(1)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    // Issue #118: pendências não resolvidas carregam o motivo específico.
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('pendencia_nao_resolvida')
  })

  it('CAIXA_ESGOTADA no ERRO_DO_TABULEIRO toca som de recusa com motivo (issue #143)', async () => {
    // Rota DEFENSIVA (#145-exp F5): o código CAIXA_ESGOTADA só é produzido
    // pela primitiva sortearDaCaixa do engine (tabuleiro.ts:504-507), que
    // nenhum comando do wire invoca; o término por Caixa esgotada chega ao
    // cliente via PARTIDA_TERMINADA com motivo (coberto em
    // partida-ciclo-completo.test.tsx, F4). O teste blinda o feedback caso um
    // servidor autoritativo emita a rejeição explícita — não remover.
    const ws = await partidaDisponivel()

    act(() =>
      ws.simulateMessage({
        type: 'ERRO_DO_TABULEIRO',
        codigo: 'CAIXA_ESGOTADA',
        mensagem: 'A Caixa está vazia.',
      }),
    )

    expect(toquesDeAudio).toHaveLength(1)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('anuncio-de-recusa').getAttribute('data-motivo')).toBe(
      'caixa_esgotada',
    )
  })

  it('giro da pendência reflete na corrente da bandeja (rebate PECA_GIRADA — regressão #199)', async () => {
    // O rebate: PECA_GIRADA de pecaId de pendência atualiza a orientação no
    // modelo e a derivação da corrente (bandeja) reflete o giro sem re-sync.
    const ws = await partidaDisponivel()
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'reta-1', 'reta')],
      })
    })
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-orientacao')).toBe('0')

    act(() => {
      ws.simulateMessage({
        type: 'PECA_GIRADA',
        pecaId: 'reta-1',
        orientacaoAnterior: 0,
        orientacao: 90,
        sentido: 'horario',
      })
    })
    // A corrente é derivada da pendência: a nova orientação aparece na bandeja.
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-orientacao')).toBe('90')
    // E o pull segue resolvendo a mesma corrente após o giro.
    const user = userEvent.setup()
    await puxarCorrente(user)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-puxada')).toBe('true')
  })

  it('espectador: corrente pública na bandeja, puxar silencioso e sem destaque de vaga (rebate #199)', async () => {
    // O rebate "a corrente é privada": as pendências vêm do broadcast SEM
    // filtro — a bandeja continua visível a todos; o que o gate restringe é
    // o gesto de puxar (donoDoCiclo) e, por derivação, o destaque de vaga.
    const ws = await partidaDisponivel()
    const user = userEvent.setup()
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: 'jogadora-2', rodada: 2 })
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-vermelho' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'reta-1', 'reta')],
      })
    })

    // Corrente pública: presente no espelho do espectador.
    const corrente = pecaCorrenteDaBandeja()
    expect(corrente).not.toBeNull()
    expect(corrente!.getAttribute('data-peca-id')).toBe('reta-1')
    // Nenhum destaque de vaga (o destaque segue o pull, que o espectador não tem).
    expect(
      screen.getAllByTestId('tabuleiro-celula').every((el) => !el.hasAttribute('data-vaga')),
    ).toBe(true)

    // Clique de pull do não-ativo: silencioso — sem comando e sem puxada local.
    const comandosAntes = ws.sentMessages.length
    await user.click(corrente!)
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-puxada')).toBe('false')
  })

  it('recebimento parcial: 2 pendências de 3 plausíveis renderizam sem erro local (rebate #199)', async () => {
    // O rebate "recebimento parcial": o cliente renderiza o que chega — com
    // duas pendências no wire, o modelo expõe duas e a bandeja abre com a
    // corrente; nenhum estado de erro local é derivado da contagem (a
    // autoridade dela é o engine: Esgotamento da Caixa).
    const ws = await partidaDisponivel()
    act(() => {
      ws.simulateMessage({ type: 'TURNO_INICIADO', jogadorId: JOGADOR_ID, rodada: 2 })
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          recebidaSorteada('r1', 'reta-1', 'reta'),
          recebidaSorteada('r2', 't-1', 'T'),
        ],
      })
    })
    expect(screen.getAllByTestId('recebida-pendente')).toHaveLength(2)
    expect(screen.getAllByTestId('caixa-peca-sorteada')).toHaveLength(1)
    expect(pecaCorrenteDaBandeja()!.getAttribute('data-recebida-id')).toBe('r1')
  })

  it('pós-confirmação: clicar destino conectado NÃO envia MOVER_PEAO e toca som de recusa (AC3, review #165)', async () => {
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
    // Movimento sem recusa (só o clique da seleção anterior, #242; sem clarão;
    // os sons do Encaixe da #241 convivem no mesmo array → filtro por src).
    expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_DE_RECUSA)).toHaveLength(0)
    expect(toquesDeAudio.filter((t) => t.src === SOM_CAMINHO_CLIQUE_PEAO)).toHaveLength(1)
    expect(toquesDeAudio.filter((t) => t.src === SOM_CAMINHO_CLIQUE_PEAO)[0]).toMatchObject({
      volume: SOM_VOLUME_BASE_CLIQUE_PEAO,
    })
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

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
    // Confirmação sem recusa (só o clique da seleção anterior, #242; sem clarão).
    expect(toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_DE_RECUSA)).toHaveLength(0)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()

    // Re-seleção aceita pelo servidor: a seleção volta ao peão confirmado.
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })
    // Destaques de destino somem após confirmar (AC3): nada conecta ao peão.
    expect(pecaDoEspelho('inicial-1').getAttribute('data-conectada')).toBe('false')

    const comandosAntes = ws.sentMessages.length
    await user.click(celulaDoEspelho(3, 3))

    // Guard AC3: nenhum comando trafega e o som de recusa toca com motivo
    // específico (espelha o FORA_DA_VEZ que o servidor responderia) — após os
    // 2 cliques de seleção (#242).
    expect(ws.sentMessages).toHaveLength(comandosAntes)
    const recusas = toquesDeAudio.filter((t) => t.src === CAMINHO_SOM_DE_RECUSA)
    expect(recusas).toHaveLength(1)
    expect(recusas[0]).toMatchObject({ volume: VOLUME_BASE_SOM_DE_RECUSA })
    // 1 clique de seleção (#242): apenas o primeiro PEAO_SELECIONADO; a
    // re-seleção pós-confirmação não representa seleção nova porque o
    // PEAO_MOVIDO manteve o peão selecionado (issue #263) — sem debounce
    // temporal, revisão PR #254, spec #238.
    expect(toquesDeAudio.filter((t) => t.src === SOM_CAMINHO_CLIQUE_PEAO)).toHaveLength(1)
    expect(screen.queryByTestId('flash-overlay')).not.toBeInTheDocument()
    const anuncio = screen.getByTestId('anuncio-de-recusa')
    expect(anuncio.getAttribute('data-motivo')).toBe('posicao_confirmada')
    expect(anuncio).toHaveTextContent('posição já confirmada')
  })

  it('PR #254: eco do mesmo peão no mesmo tick toca 1 clique por evento (2 toques)', async () => {
    // Sem debounce temporal (spec #238, revisão PR #254): cada
    // `PEAO_SELECIONADO` do canal toca — o ref do modelo ainda está stale no
    // mesmo tick, então ambos são seleção nova. Eco de transporte soando
    // duplo é preferível a silenciar seleção legítima.
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
    expect(toquesDeAudio[1]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
  })

  it('PR #254: re-clique do mesmo peão entre renders toca 1 clique só', async () => {
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })

    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
  })

  it('PR #254: troca de peão toca 1 clique por seleção nova (2 toques)', async () => {
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-vermelho' })
    })

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
    expect(toquesDeAudio[1]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
  })

  it('PR #254: re-seleção legítima após desseleção toca de novo (2 toques)', async () => {
    // Regressão do debounce por timestamp removido: selecionar, desselecionar
    // e reselecionar o mesmo peão são duas seleções novas — ambas tocam
    // (spec #238: "Clique ao selecionar", sem temporizador decidindo).
    const ws = await partidaDisponivel()

    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' })
    })
    act(() => {
      ws.simulateMessage({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    })

    expect(toquesDeAudio).toHaveLength(2)
    expect(toquesDeAudio[0]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
    expect(toquesDeAudio[1]).toMatchObject({ src: SOM_CAMINHO_CLIQUE_PEAO, volume: SOM_VOLUME_BASE_CLIQUE_PEAO })
  })
})

// F3 (#145-exp): monstros na Caixa e resgate por clique ponta a ponta NA TELA
// (o funil de regras já é coberto no engine; aqui é o caminho wire → modelo →
// espelho DOM → comando que a auditoria pediu para blindar).
describe('monstros na Caixa e resgate por clique na tela (#145-exp F3)', () => {
  it('vulto na corrente da bandeja: pull → escolha → OK no preview, sem janela de Manipulação', async () => {
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
      // O servidor sorteia o Monstro e o entrega no Recebimento como peça comum.
      ws.simulateMessage({
        type: 'PECA_SORTEADA',
        pecaId: 'vulto-1',
        tipoDaPeca: 'vulto',
        orientacao: 0,
      })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'vulto-1', 'vulto')],
      })
    })
    // Fecha a janela de Manipulação da Inicial (gate): a bandeja passa a
    // exibir o Monstro corrente.
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })

    // Bandeja exibe o Monstro com o tipo do wire.
    const corrente = pecaCorrenteDaBandeja()
    expect(corrente).not.toBeNull()
    expect(corrente!.getAttribute('data-tipo')).toBe('vulto')
    expect(corrente!.getAttribute('data-peca-id')).toBe('vulto-1')

    // Pull → clique na vaga norte SÓ escolhe (issue #357); o Monstro percorre
    // o fluxo escolha → preview → OK (POSICIONAR_PECA no segundo clique).
    await puxarCorrente(user)
    expect(celulaDoEspelho(2, 3).getAttribute('data-vaga')).toBe('true')
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r1',
      borda: 'norte',
      jogadorId: JOGADOR_ID,
    })

    // Servidor fixa a vaga: preview provisório do Monstro, sem encaixe.
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      })
    })
    expect(screen.getByTestId('peca-provisoria').getAttribute('data-peca-id')).toBe('vulto-1')

    // OK do preview: clique na célula-alvo posiciona o Monstro.
    await user.click(celulaDoEspelho(2, 3))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'vulto-1',
      celula: { linha: 2, coluna: 3 },
      jogadorId: JOGADOR_ID,
    })

    // Servidor confirma o encaixe.
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'vulto-1',
        celula: { linha: 2, coluna: 3 },
        orientacao: 0,
      })
    })
    // Monstro posicionado no espelho com o tipo correto…
    expect(pecaPosicionadaDoEspelho('vulto-1').getAttribute('data-tipo')).toBe('vulto')
    // …e sem janela de Manipulação (espelha engine posicionarRecebida): o
    // overlay 3D não emite (data-manipulacao ausente) e não há controles DOM.
    expect(pecaPosicionadaDoEspelho('vulto-1').hasAttribute('data-manipulacao')).toBe(false)
    expect(screen.queryByTestId('controles-de-giro')).not.toBeInTheDocument()
  })

  it('espectro na corrente da bandeja e no encaixe (cobertura do segundo tipo de Monstro)', async () => {
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
        type: 'PECA_SORTEADA',
        pecaId: 'espectro-1',
        tipoDaPeca: 'espectro',
        orientacao: 0,
      })
      ws.simulateMessage({
        type: 'RECEBIMENTO_GERADO',
        recebidas: [recebidaSorteada('r1', 'espectro-1', 'espectro')],
      })
    })
    // Fecha a janela de Manipulação da Inicial (gate) para exibir a corrente.
    act(() => {
      ws.simulateMessage({ type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' })
    })

    expect(pecaCorrenteDaBandeja()!.getAttribute('data-tipo')).toBe('espectro')
    await puxarCorrente(user)
    // Clique na vaga leste (3,4) SÓ escolhe (issue #357); o OK no preview
    // (segundo clique na célula-alvo) posiciona o Monstro.
    await user.click(celulaDoEspelho(3, 4))
    expect(ultimoComando(ws)).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r1',
      borda: 'leste',
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r1',
        borda: 'leste',
        celulaAlvo: { linha: 3, coluna: 4 },
      })
    })
    expect(screen.getByTestId('peca-provisoria').getAttribute('data-peca-id')).toBe('espectro-1')
    await user.click(celulaDoEspelho(3, 4))
    expect(ultimoComando(ws)).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'espectro-1',
      celula: { linha: 3, coluna: 4 },
      jogadorId: JOGADOR_ID,
    })
    act(() => {
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'espectro-1',
        celula: { linha: 3, coluna: 4 },
        orientacao: 0,
      })
    })
  })

  it('Monstro posicionado perde o destaque de destino do peão (exclusão do engine na tela)', async () => {
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
      // O servidor sorteia o Monstro e o posiciona no tabuleiro (rota real:
      // o modelo local só posiciona peça cujo tipo conhece via sorteio).
      ws.simulateMessage({
        type: 'PECA_SORTEADA',
        pecaId: 'vulto-1',
        tipoDaPeca: 'vulto',
        orientacao: 0,
      })
      ws.simulateMessage({
        type: 'PECA_POSICIONADA',
        pecaId: 'vulto-1',
        celula: { linha: 3, coluna: 4 },
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

    // O Monstro está no tabuleiro, mas NÃO é destino do peão selecionado.
    const vulto = pecaPosicionadaDoEspelho('vulto-1')
    expect(vulto.getAttribute('data-conectada')).toBe('false')
    const comandosAntes = ws.sentMessages.length
    await user.click(celulaDoEspelho(3, 4))
    expect(ws.sentMessages).toHaveLength(comandosAntes)
  })

  it('clique em destino de RESGATE emite MOVER_PEAO e o eco limpa o afetado (#145-exp F1+F3d)', async () => {
    const ws = await partidaDisponivel()
    const user = userEvent.setup()

    // Snapshot autoritativo: Ana (vermelho) afetada por Baixa Iluminação na
    // reta vizinha ao meu peão branco (Inicial). Seleção já no modelo.
    const snapshot = {
      tabuleiro: {
        posicionadas: [
          { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
          { pecaId: 'reta-1', tipo: 'reta', orientacao: 90, celula: { linha: 3, coluna: 4 } },
        ],
        iniciais: [],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
          { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: 'reta-1' },
          { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
          { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
        ],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: 'peao-branco',
        pecasRestantesNaCaixa: 60,
      },
      jogadores: [
        { jogadorId: JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: true, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
        { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      ],
      jogadorAtivoId: JOGADOR_ID,
      rodada: 2,
      pecaDoInicioDoTurnoId: 'inicial-1',
      posicaoConfirmada: false,
      celulasIluminadas: [],
      estado: 'em_andamento',
      resultado: null,
      geradoresLigados: [],
      cartaoDeAcessoObtido: false,
    } as unknown as EstadoDaPartidaSnapshot
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))

    // Percepção do afetado no espelho e destino de resgate destacado na peça.
    await waitFor(() =>
      expect(peaoDoEspelho('vermelho').getAttribute('data-em-baixa')).toBe('true'),
    )
    const reta = pecaPosicionadaDoEspelho('reta-1')
    expect(reta.getAttribute('data-conectada')).toBe('true')
    expect(reta.getAttribute('data-resgate')).toBe('true')

    // Clique no destino → MESMO comando MOVER_PEAO (nenhum comando novo no wire).
    await user.click(reta)
    expect(ultimoComando(ws)).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-branco',
      celula: { linha: 3, coluna: 4 },
      jogadorId: JOGADOR_ID,
    })

    // Eco do servidor: movimento consumado + resgate realizado (partida.ts:
    // 675-712) — a Baixa Iluminação limpa na tela e o destino deixa de ser
    // de resgate (peça no teto 1 sem afetado).
    act(() => {
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 3, coluna: 4 },
      })
      ws.simulateMessage({
        type: 'RESGATE_REALIZADO',
        pecaId: 'reta-1',
        resgatadoJogadorId: 'jogador-2',
        resgatadorJogadorId: JOGADOR_ID,
        resgatadorPeaoId: 'peao-branco',
      })
    })
    await waitFor(() =>
      expect(peaoDoEspelho('vermelho').hasAttribute('data-em-baixa')).toBe(false),
    )
    expect(
      screen.getAllByTestId('peca-posicionada').find((el) => el.getAttribute('data-peca-id') === 'reta-1')
        ?.hasAttribute('data-resgate'),
    ).toBe(false)
  })
})
