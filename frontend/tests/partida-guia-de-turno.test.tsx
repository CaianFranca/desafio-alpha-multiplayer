// Guia de turno (issue #441): card com a etapa atual + destaque dos alvos
// acionáveis, só para o dono do turno. Suíte de comportamento externo no
// seam PartidaPage (padrão do teste do chat: canal e autenticação simulados,
// texto do card + atributo de guia no espelho) + unidade pura da máquina.
//
// Cobertura das 18 histórias: sequência inicial (1–10, confirmar via fase
// `confirmar` — no Primeiro Turno o faseamento leva direto a encerrar),
// normal 3 passos + fim (11–12), switch persistido (13–14), região viva
// (15), compacto (16), Amedrontado (17) e espectador (18). Turno e
// permanecer avançam ao exibir (transitórios por desenho): no seam assentam
// no passo seguinte e a exibição é provada pela memória "já ensinado" +
// unidade pura. Giro é só texto; bandeja fixa 1 ciclo antes das vagas.

import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { HudDaPartida } from '../web/src/components/partida/HudDaPartida'
import {
  etapaDoGuiaDeTurno,
  passoDeAvancoImediato,
  passoDeExibicaoUnica,
} from '../web/src/game/tabuleiro/guiaDeTurno'
import { guiaDaCelula } from '../web/src/game/tabuleiro/Tabuleiro'
import { inicialDaCorDoPeao } from '../web/src/game/tabuleiro/interacaoPeoes'
import type { EntradaDoGuiaDeTurno } from '../web/src/game/tabuleiro/guiaDeTurno'
import { MockWebSocket } from './helpers/mockWebSocket'
import { enviarLote } from './helpers/partida-ws'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

const JOGADORES_BASE: EstadoDaPartidaSnapshot['jogadores'] = [
  { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
]

const INICIAIS_BASE = [
  { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 0 },
  { pecaId: 'inicial-4', tipo: 'inicial', orientacao: 0 },
]

const PEOES_NA_MESA = [
  { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
  { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
  { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
  { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
]

function criarSnapshotBase(overrides: Record<string, unknown> = {}): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: INICIAIS_BASE,
      peoes: PEOES_NA_MESA,
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: JOGADORES_BASE,
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...overrides,
  } as unknown as EstadoDaPartidaSnapshot
}

function renderPartidaNaRota(entry: string) {
  const router = createMemoryRouter([{ path: '/partida', element: <PartidaPage /> }], {
    initialEntries: [entry],
  })
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

async function partidaComSnapshot(partidaId: string, snapshot: EstadoDaPartidaSnapshot): Promise<MockWebSocket> {
  renderPartidaNaRota(`/partida?serverId=s&partidaId=${partidaId}`)
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  const ws = MockWebSocket.last()!
  act(() =>
    ws.simulateMessage({
      type: 'ADMISSAO_ACEITA',
      jogadorId: MEU_JOGADOR_ID,
      apelido: 'JogadorTeste',
      partidaId,
      estado: 'em_andamento',
    }),
  )
  await screen.findByTestId('tabuleiro')
  act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot }))
  await screen.findByTestId('hud-da-partida')
  return ws
}

function alvosComGuia(): Element[] {
  return Array.from(document.querySelectorAll('[data-guia="true"]'))
}

/** Sonda do guia para a cena 3D (issue #441): o que foi entregue ao `AmbienteCena`. */
function sondaDaCena(): { alvo: string | null; pecaId: string | null; peaoId: string | null } {
  const sonda = screen.getByTestId('guia-cena')
  return {
    alvo: sonda.getAttribute('data-alvo'),
    pecaId: sonda.getAttribute('data-peca-id'),
    peaoId: sonda.getAttribute('data-peao-id'),
  }
}

let viewportOriginalLargura = 0
let viewportOriginalAltura = 0
function mockViewport(largura: number, altura: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: largura })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: altura })
  window.dispatchEvent(new Event('resize'))
}
function salvarViewport(): void {
  viewportOriginalLargura = window.innerWidth
  viewportOriginalAltura = window.innerHeight
}
function restaurarViewport(): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: viewportOriginalLargura })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: viewportOriginalAltura })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  MockWebSocket.clean()
  restaurarViewport()
})

// ── Máquina pura ──

function entradaBase(overrides: Partial<EntradaDoGuiaDeTurno> = {}): EntradaDoGuiaDeTurno {
  return {
    meuTurno: true,
    amedrontado: false,
    guiaLigado: true,
    rodada: 1,
    inicialPropriaNaMesa: true,
    inicialPropriaPosicionada: false,
    inicialPropriaEmFoco: false,
    temManipulacao: false,
    temPreviewEmFoco: false,
    peaoSelecionadoEhProprio: false,
    peaoProprioPosicionado: false,
    posicaoConfirmadaNoTurno: false,
    movimentouNoTurno: false,
    atravessouNoTurno: false,
    temRecebidaPendente: false,
    faseDoTurno: null,
    ensinados: new Set(),
    fluxoNormalConcluido: false,
    ...overrides,
  }
}

describe('Guia de turno — máquina pura (issue #441)', () => {
  it('sem guia desligado, fora do turno ou Amedrontado', () => {
    expect(etapaDoGuiaDeTurno(entradaBase({ guiaLigado: false }))).toBeNull()
    expect(etapaDoGuiaDeTurno(entradaBase({ meuTurno: false }))).toBeNull()
    expect(etapaDoGuiaDeTurno(entradaBase({ amedrontado: true }))).toBeNull()
  })

  it('travessia vira texto informativo sem alvo', () => {
    const etapa = etapaDoGuiaDeTurno(entradaBase({ atravessouNoTurno: true }))
    expect(etapa?.texto).toMatch(/Travessia feita/)
    expect(etapa?.alvo).toBeNull()
  })

  it('confirmação pendente vence a travessia informativa', () => {
    const etapa = etapaDoGuiaDeTurno(entradaBase({ atravessouNoTurno: true, faseDoTurno: 'confirmar' }))
    expect(etapa?.alvo).toBe('botao-confirmar')
  })

  it('Inicial do dono deriva da cor do peão', () => {
    expect(inicialDaCorDoPeao('peao-branco')).toBe('inicial-1')
    expect(inicialDaCorDoPeao('peao-vermelho')).toBe('inicial-2')
    expect(inicialDaCorDoPeao('peao-azul')).toBe('inicial-3')
    expect(inicialDaCorDoPeao('peao-amarelo')).toBe('inicial-4')
    expect(inicialDaCorDoPeao('peao-sintetico')).toBeNull()
  })

  it('turno abre o fluxo inicial e cede à Inicial quando ensinado', () => {
    const turno = etapaDoGuiaDeTurno(entradaBase())
    expect(turno?.alvo).toBe('turno')
    const inicial = etapaDoGuiaDeTurno(entradaBase({ ensinados: new Set(['guia-inicial-turno']) }))
    expect(inicial?.alvo).toBe('inicial-propria')
  })

  it('giro é só texto (sem alvo), bandeja fixa 1 ciclo antes das vagas', () => {
    const estadoManipulando = {
      inicialPropriaNaMesa: false,
      inicialPropriaPosicionada: true,
      temManipulacao: true,
    }
    const giro = etapaDoGuiaDeTurno(entradaBase(estadoManipulando))
    expect(giro?.texto).toMatch(/Gire a peça/)
    expect(giro?.alvo).toBeNull()
    const depoisDoGiro = etapaDoGuiaDeTurno(
      entradaBase({ ...estadoManipulando, ensinados: new Set(['guia-inicial-turno', 'guia-inicial-giro']) }),
    )
    expect(depoisDoGiro?.id).not.toBe('guia-inicial-giro')
    const bandeja = etapaDoGuiaDeTurno(
      entradaBase({
        inicialPropriaNaMesa: false,
        inicialPropriaPosicionada: true,
        peaoProprioPosicionado: true,
        temRecebidaPendente: true,
        ensinados: new Set(['guia-inicial-turno']),
      }),
    )
    expect(bandeja?.alvo).toBe('bandeja')
    const vagas = etapaDoGuiaDeTurno(
      entradaBase({
        inicialPropriaNaMesa: false,
        inicialPropriaPosicionada: true,
        peaoProprioPosicionado: true,
        temRecebidaPendente: true,
        ensinados: new Set(['guia-inicial-turno', 'guia-inicial-bandeja']),
      }),
    )
    expect(vagas?.alvo).toBe('vagas')
    const depoisDasVagas = etapaDoGuiaDeTurno(
      entradaBase({
        inicialPropriaNaMesa: false,
        inicialPropriaPosicionada: true,
        peaoProprioPosicionado: true,
        temRecebidaPendente: true,
        ensinados: new Set(['guia-inicial-turno', 'guia-inicial-bandeja', 'guia-inicial-vagas']),
      }),
    )
    expect(depoisDasVagas).toBeNull()
  })

  it('bandeja é exibição única sem avanço imediato (fixa 1 ciclo)', () => {
    expect(passoDeExibicaoUnica('guia-inicial-bandeja')).toBe(true)
    expect(passoDeAvancoImediato('guia-inicial-bandeja')).toBe(false)
    expect(passoDeAvancoImediato('guia-inicial-turno')).toBe(true)
    expect(passoDeAvancoImediato('guia-normal-permanecer')).toBe(true)
  })

  it('guia por célula: tabuleiro acende a grade, vagas só nas vagas', () => {
    const vagas = new Set(['3:3', '3:4'])
    expect(guiaDaCelula('3:3', 'tabuleiro', vagas)).toEqual({ tabuleiroEmGuia: true, vagaEmGuia: false })
    expect(guiaDaCelula('0:0', 'tabuleiro', new Set())).toEqual({ tabuleiroEmGuia: true, vagaEmGuia: false })
    expect(guiaDaCelula('3:3', 'vagas', vagas)).toEqual({ tabuleiroEmGuia: false, vagaEmGuia: true })
    expect(guiaDaCelula('0:0', 'vagas', vagas)).toEqual({ tabuleiroEmGuia: false, vagaEmGuia: false })
    expect(guiaDaCelula('3:3', null, vagas)).toEqual({ tabuleiroEmGuia: false, vagaEmGuia: false })
    expect(guiaDaCelula('3:3', 'bandeja', vagas)).toEqual({ tabuleiroEmGuia: false, vagaEmGuia: false })
  })

  it('fluxo normal tem 3 passos e depois termina', () => {
    const normal = { rodada: 2, inicialPropriaNaMesa: false, inicialPropriaPosicionada: true }
    expect(etapaDoGuiaDeTurno(entradaBase({ ...normal }))?.alvo).toBe('peao-proprio')
    expect(
      etapaDoGuiaDeTurno(entradaBase({ ...normal, peaoSelecionadoEhProprio: true, faseDoTurno: 'permanecer' }))?.alvo,
    ).toBe('botao-permanecer')
    expect(
      etapaDoGuiaDeTurno(
        entradaBase({
          ...normal,
          peaoSelecionadoEhProprio: true,
          faseDoTurno: 'permanecer',
          ensinados: new Set(['guia-normal-permanecer']),
        }),
      )?.alvo,
    ).toBe('destino')
    expect(etapaDoGuiaDeTurno(entradaBase({ ...normal, fluxoNormalConcluido: true }))).toBeNull()
  })
})

// ── Sequência inicial no seam ──

describe('Guia de turno — sequência inicial (issues #441 [1–10])', () => {
  it('turno assenta na Inicial, tabuleiro, giro só texto, peão, destino, encerrar, bandeja, vagas e encerrar de novo', async () => {
    const partidaId = 'guia-seq'
    const ws = await partidaComSnapshot(partidaId, criarSnapshotBase())

    // [1] turno (transitório): cede à Inicial no mesmo ciclo; o card assenta na Inicial.
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Seu turno — selecione sua Peça Inicial.')

    // [2] só a minha Inicial destaca — no espelho E na cena 3D real.
    const iniciais = screen.getAllByTestId('mesa-peca-inicial')
    expect(iniciais).toHaveLength(4)
    const comGuia = iniciais.filter((el) => el.getAttribute('data-guia') === 'true')
    expect(comGuia).toHaveLength(1)
    expect(comGuia[0]).toHaveAttribute('data-peca-id', 'inicial-1')
    expect(sondaDaCena()).toEqual({ alvo: 'inicial-propria', pecaId: 'inicial-1', peaoId: 'peao-branco' })

    // [3] Inicial em foco → tabuleiro.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: { ...criarSnapshotBase().tabuleiro, pecaSelecionadaId: 'inicial-1' },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Escolha uma célula livre no tabuleiro.')
    expect(screen.getByTestId('tabuleiro')).toHaveAttribute('data-guia', 'true')
    expect(sondaDaCena()).toEqual({ alvo: 'tabuleiro', pecaId: null, peaoId: 'peao-branco' })

    // [4] giro/OK é só texto informativo (sem alvo, sem ciano, controles clicáveis).
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [{ pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
            pecaEmManipulacaoId: 'inicial-1',
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Gire a peça e confirme com OK.')
    expect(screen.getByTestId('peca-posicionada')).not.toHaveAttribute('data-guia', 'true')
    expect(alvosComGuia()).toHaveLength(0)
    // Cena 3D real: giro só texto — sem peça em guia.
    expect(sondaDaCena()).toEqual({ alvo: null, pecaId: null, peaoId: 'peao-branco' })

    // [5] meu peão.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [{ pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Selecione seu peão.')
    const peoes = screen.getAllByTestId('peao')
    expect(peoes.filter((el) => el.getAttribute('data-guia') === 'true').map((el) => el.getAttribute('data-peao-id'))).toEqual([
      'peao-branco',
    ])
    // Cena 3D real: o peão próprio com o id íntegro até a cena.
    expect(sondaDaCena()).toEqual({ alvo: 'peao-proprio', pecaId: null, peaoId: 'peao-branco' })

    // [6] destino próprio com o peão selecionado.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [{ pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
            peaoSelecionadoId: 'peao-branco',
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Coloque o peão na sua peça.')
    expect(screen.getByTestId('peca-posicionada')).toHaveAttribute('data-guia', 'true')
    // Cena 3D real: destino próprio é a Inicial posicionada.
    expect(sondaDaCena()).toEqual({ alvo: 'destino-proprio', pecaId: 'inicial-1', peaoId: 'peao-branco' })

    // [10] peão posicionado sem pendências → encerrar (sem bloquear o clique).
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [{ pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
            peoes: [
              { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
              { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
              { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
              { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
            ],
            peaoSelecionadoId: 'peao-branco',
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Encerre seu turno.')
    const botaoEncerrar = screen.getByTestId('botao-encerrar-turno')
    expect(botaoEncerrar).toHaveAttribute('data-guia', 'true')
    expect(screen.getByTestId('guia-de-turno').className).toContain('pointer-events-none')
    expect(sondaDaCena()).toEqual({ alvo: 'botao-encerrar', pecaId: null, peaoId: 'peao-branco' })

    // [8→9] recebida na bandeja: bandeja fixa 1 ciclo com ciano na corrente,
    // depois vagas assentam (ordem pura provada acima; no seam o flush assenta
    // em vagas, com a corrente ainda presente para o pull).
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [{ pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } }],
            peoes: [
              { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
              { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
              { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
              { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
            ],
            peaoSelecionadoId: 'peao-branco',
            recebidas: [{ recebidaId: 'rec-1', pecaId: 'peca-rec-1', tipo: 'reta', orientacao: 0, vaga: null, celulaAlvo: null }],
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Puxe a peça da bandeja e encaixe nas vagas.')
    expect(screen.getByTestId('caixa-peca-sorteada')).toBeInTheDocument()
    // Cena 3D real: passo das vagas (a bandeja de 1 ciclo cedeu; a ordem
    // bandeja→vagas vive na unidade pura + no ciano da corrente abaixo).
    expect(sondaDaCena()).toEqual({ alvo: 'vagas', pecaId: null, peaoId: 'peao-branco' })

    // Puxar revela as vagas vizinhas com o destaque do guia.
    await userEvent.click(screen.getByTestId('caixa-peca-sorteada'))
    const vagasComGuia = await screen.findAllByTestId('tabuleiro-celula', undefined, { timeout: 2000 }).then((celulas) =>
      celulas.filter((el) => el.getAttribute('data-vaga') === 'true' && el.getAttribute('data-guia') === 'true'),
    )
    expect(vagasComGuia.length).toBeGreaterThan(0)

    // Encaixe feito → encerrar de novo; o clique segue livre.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({
          tabuleiro: {
            ...criarSnapshotBase().tabuleiro,
            iniciais: INICIAIS_BASE.filter((p) => p.pecaId !== 'inicial-1'),
            posicionadas: [
              { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
              { pecaId: 'peca-rec-1', tipo: 'reta', orientacao: 0, celula: { linha: 2, coluna: 3 } },
            ],
            peoes: [
              { peaoId: 'peao-branco', cor: 'branco', pecaId: 'inicial-1' },
              { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
              { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
              { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
            ],
            peaoSelecionadoId: 'peao-branco',
          },
        }),
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Encerre seu turno.')
    await userEvent.click(screen.getByTestId('botao-encerrar-turno'))
    expect(ws.sentMessages.map(String).join(' ')).toMatch(/ENCERRAR_TURNO/)
  })
})

// ── Confirmar, normal, fim ──

describe('Guia de turno — confirmar e fluxo normal (issues #441 [7,11,12])', () => {
  it('botão de confirmar destaca com confirmação pendente', async () => {
    const ws = await partidaComSnapshot(
      'guia-confirmar',
      criarSnapshotBase({
        rodada: 2,
        pecaDoInicioDoTurnoId: 'peca-a',
        tabuleiro: {
          ...criarSnapshotBase().tabuleiro,
          iniciais: [],
          posicionadas: [
            { pecaId: 'peca-a', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 3 } },
            { pecaId: 'peca-b', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 4 } },
          ],
          peoes: [
            { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-b' },
            { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
            { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
            { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
          ],
          peaoSelecionadoId: 'peao-branco',
        },
      }),
    )
    act(() =>
      ws.simulateMessage({
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'peca-a',
        pecaIdPara: 'peca-b',
        celula: { linha: 3, coluna: 4 },
      }),
    )
    expect(await screen.findByTestId('guia-de-turno-vivo')).toHaveTextContent('Confirme a posição do peão.')
    expect(screen.getByTestId('botao-confirmar-posicao')).toHaveAttribute('data-guia', 'true')
  })

  it('fluxo normal tem 3 passos e depois termina', async () => {
    const partidaId = 'guia-normal'
    const baseNormal = () =>
      criarSnapshotBase({
        rodada: 2,
        pecaDoInicioDoTurnoId: 'peca-a',
        tabuleiro: {
          ...criarSnapshotBase().tabuleiro,
          iniciais: [],
          posicionadas: [
            { pecaId: 'peca-a', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 3 } },
            { pecaId: 'peca-b', tipo: 'cruz', orientacao: 0, celula: { linha: 3, coluna: 4 } },
          ],
          peoes: [
            { peaoId: 'peao-branco', cor: 'branco', pecaId: 'peca-a' },
            { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
            { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
            { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
          ],
        },
      })
    const ws = await partidaComSnapshot(partidaId, baseNormal())

    // Passo 1: peão.
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Selecione seu peão para agir.')
    expect(
      screen.getAllByTestId('peao').filter((el) => el.getAttribute('data-guia') === 'true').map((el) => el.getAttribute('data-peao-id')),
    ).toEqual(['peao-branco'])
    expect(sondaDaCena()).toEqual({ alvo: 'peao-proprio', pecaId: null, peaoId: 'peao-branco' })

    // Passo 2→3: permanecer exibido uma vez, mover assenta com o destino.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: { ...baseNormal(), tabuleiro: { ...baseNormal().tabuleiro, peaoSelecionadoId: 'peao-branco' } },
      }),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Desloque seu peão para uma peça vizinha conectada.')
    expect(screen.getByTestId('botao-permanecer')).toBeInTheDocument()
    const destinos = screen.getAllByTestId('peca-posicionada')
    expect(destinos.filter((el) => el.getAttribute('data-guia') === 'true').map((el) => el.getAttribute('data-peca-id'))).toEqual([
      'peca-b',
    ])
    // Cena 3D real: destinos válidos acesos, sem peça restritiva no passo.
    expect(sondaDaCena()).toEqual({ alvo: 'destino', pecaId: null, peaoId: 'peao-branco' })

    // Turno seguinte de outro jogador e depois o meu: guia encerrado.
    await enviarLote(ws, { type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 2 })
    expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument()
    await enviarLote(ws, { type: 'TURNO_INICIADO', jogadorId: MEU_JOGADOR_ID, rodada: 3 })
    expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument()
    expect(alvosComGuia()).toHaveLength(0)
  })
})

// ── Some: espectador, Amedrontado, desligado, travessia ──

describe('Guia de turno — quando some (issues #441 [13,14,17,18])', () => {
  it('espectador nunca vê guia', async () => {
    await partidaComSnapshot(
      'guia-espectador',
      criarSnapshotBase({ jogadorAtivoId: 'jogador-2', rodada: 2 }),
    )
    expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guia-de-turno-vivo')).not.toBeInTheDocument()
    // Sem alvo não há destaque — o peão próprio segue íntegro até a cena.
    expect(sondaDaCena()).toEqual({ alvo: null, pecaId: null, peaoId: 'peao-branco' })
    expect(alvosComGuia()).toHaveLength(0)
  })

  it('Amedrontado sem guia (turno pulado)', async () => {
    await partidaComSnapshot(
      'guia-amedrontado',
      criarSnapshotBase({
        rodada: 2,
        jogadores: JOGADORES_BASE.map((j) =>
          j.jogadorId === MEU_JOGADOR_ID ? { ...j, sanidade: 0, amedrontado: true } : j,
        ),
      }),
    )
    expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guia-de-turno-vivo')).not.toBeInTheDocument()
    // Sem alvo não há destaque — o peão próprio segue íntegro até a cena.
    expect(sondaDaCena()).toEqual({ alvo: null, pecaId: null, peaoId: 'peao-branco' })
    expect(alvosComGuia()).toHaveLength(0)
  })

  it('travessia vira texto informativo sem alvo', async () => {
    await partidaComSnapshot(
      'guia-travessia',
      criarSnapshotBase({
        rodada: 2,
        atravessouNoTurno: true,
        pecaDaTravessiaId: 'peca-travessia',
      } as Record<string, unknown>),
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Travessia feita — continue seu turno.')
    expect(alvosComGuia()).toHaveLength(0)
  })

  it('desligado zera cards e destaques, e persiste entre visitas', async () => {
    const partidaId = 'guia-switch'
    const ws = await partidaComSnapshot(partidaId, criarSnapshotBase())
    expect(screen.getByTestId('guia-de-turno')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('guia-config-botao'))
    expect(screen.getByTestId('guia-config-modal')).toBeInTheDocument()
    expect(screen.getByTestId('guia-switch')).toHaveFocus()
    await userEvent.click(screen.getByTestId('guia-switch'))
    expect(screen.getByTestId('guia-switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument()
    expect(alvosComGuia()).toHaveLength(0)
    expect(window.localStorage.getItem('guia-do-jogador:ligado')).toBe('0')

    // Escape fecha e devolve o foco ao botão de configurações.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('guia-config-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('guia-config-botao')).toHaveFocus()

    // Nova visita à mesma Partida: segue desligado; cena livre com modal fechado.
    act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
    await waitFor(() => expect(screen.queryByTestId('guia-de-turno')).not.toBeInTheDocument())
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
    expect(alvosComGuia()).toHaveLength(0)
  })

  it('modal aberto torna a cena inert sem travar o HUD', async () => {
    await partidaComSnapshot('guia-inert', criarSnapshotBase())
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
    await userEvent.click(screen.getByTestId('guia-config-botao'))
    expect(screen.getByTestId('cena-interativa')).toHaveAttribute('inert')
    // HUD essencial segue clicável: SAIR abre a confirmação por cima.
    await userEvent.click(screen.getByTestId('hud-sair'))
    expect(screen.getByTestId('hud-confirmacao-saida')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('hud-sair-cancelar'))
    await userEvent.click(screen.getByTestId('guia-config-fechar'))
    expect(screen.queryByTestId('guia-config-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('cena-interativa')).not.toHaveAttribute('inert')
  })
})

// ── Região viva, compacto, card ──

describe('Guia de turno — região viva e compacto (issues #441 [15,16])', () => {
  it('etapa anunciada em nó vivo próprio, sem bloquear cliques', async () => {
    await partidaComSnapshot('guia-viva', criarSnapshotBase())
    const card = screen.getByTestId('guia-de-turno')
    expect(card.className).toContain('pointer-events-none')
    // Anúncio vive em nó `sr-only` separado; o card visual é `aria-hidden`.
    const vivo = screen.getByTestId('guia-de-turno-vivo')
    expect(vivo).toHaveAttribute('role', 'status')
    expect(vivo).toHaveAttribute('aria-live', 'polite')
    expect(vivo).toHaveAttribute('aria-atomic', 'true')
    expect(vivo.className).toContain('sr-only')
    expect(vivo).toHaveTextContent(card.textContent ?? '')
    expect(card.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('card e destaques funcionam no compacto', async () => {
    salvarViewport()
    mockViewport(800, 360)
    try {
      await partidaComSnapshot('guia-compacto', criarSnapshotBase())
      const card = screen.getByTestId('guia-de-turno')
      expect(card).toHaveAttribute('data-compacto', 'true')
      expect(
        screen.getAllByTestId('mesa-peca-inicial').filter((el) => el.getAttribute('data-guia') === 'true'),
      ).toHaveLength(1)
    } finally {
      restaurarViewport()
    }
  })

  it('memória zerada por Partida: legado expira e o guia recomeça do zero', async () => {
    const partidaId = 'guia-memoria-zerada'
    window.localStorage.setItem(`guia-de-turno-ensinados:${partidaId}`, JSON.stringify(['guia-inicial-turno', 'guia-inicial-bandeja']))
    window.localStorage.setItem(`guia-de-turno-normal-concluido:${partidaId}`, '1')
    await partidaComSnapshot(partidaId, criarSnapshotBase())
    // Legado expirado na montagem/troca de Partida; só o switch global persiste.
    expect(window.localStorage.getItem(`guia-de-turno-ensinados:${partidaId}`)).toBeNull()
    expect(window.localStorage.getItem(`guia-de-turno-normal-concluido:${partidaId}`)).toBeNull()
    // Recomeça do zero: card assenta na Inicial, com a Inicial em guia.
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Seu turno — selecione sua Peça Inicial.')
    expect(
      screen.getAllByTestId('mesa-peca-inicial').filter((el) => el.getAttribute('data-guia') === 'true'),
    ).toHaveLength(1)
  })

  it('bandeja acende a corrente antes das vagas (espelho por célula)', async () => {
    const { TabuleiroMirrorDOM } = await import('../web/src/components/partida/TabuleiroMirrorDOM')
    const { chaveCelula } = await import('../web/src/game/tabuleiro/contrato')
    const celula = { linha: 3, coluna: 3 }
    const chave = chaveCelula(celula)
    const { unmount } = render(
      <TabuleiroMirrorDOM
        todasCelulas={[celula]}
        ocupadasSet={new Set()}
        iniciais={[]}
        pecaCorrente={{ recebidaId: 'rec-1', pecaId: 'peca-rec-1', tipo: 'reta', orientacao: 0 }}
        posicionadas={[]}
        peoes={[]}
        peaoSelecionadoId={null}
        destinosSet={new Set()}
        vagasSet={new Set([chave])}
        guiaAlvo="bandeja"
        guiaPecaId="peca-rec-1"
      />,
    )
    expect(screen.getByTestId('caixa-peca-sorteada')).toHaveAttribute('data-guia', 'true')
    unmount()
    render(
      <TabuleiroMirrorDOM
        todasCelulas={[celula]}
        ocupadasSet={new Set()}
        iniciais={[]}
        pecaCorrente={null}
        posicionadas={[]}
        peoes={[]}
        peaoSelecionadoId={null}
        destinosSet={new Set()}
        vagasSet={new Set([chave])}
        guiaAlvo="vagas"
      />,
    )
    const celulas = screen.getAllByTestId('tabuleiro-celula')
    expect(celulas.filter((el) => el.getAttribute('data-guia') === 'true')).toHaveLength(1)
  })

  it('destaque do turno acende no indicador do HUD', () => {
    const jogadorPorId = {
      [MEU_JOGADOR_ID]: { apelido: 'Eu', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 1 },
      ['jogador-2']: { apelido: 'Ana', cor: 'vermelho', sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 2 },
    }
    render(
      <HudDaPartida
        jogadorPorId={jogadorPorId as never}
        jogadorAtivoId={MEU_JOGADOR_ID}
        jogadorLocalId={MEU_JOGADOR_ID}
        geradoresLigados={[]}
        cartaoDeAcessoObtido={false}
        emAndamento
        emResultado={false}
        onSair={() => {}}
        etapaDoGuiaTexto="Seu turno — veja a ordem do turno."
        guiaAlvo="turno"
      />,
    )
    expect(screen.getByTestId('guia-de-turno')).toHaveTextContent('Seu turno — veja a ordem do turno.')
    expect(screen.getByTestId('guia-de-turno-vivo')).toHaveTextContent('Seu turno — veja a ordem do turno.')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-guia', 'true')
  })
})
