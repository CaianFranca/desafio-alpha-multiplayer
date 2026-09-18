import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import {
  tocarCartaoDeAcesso,
  tocarConquistasDaConfirmacao,
  tocarGeradorLigado,
  tocarProtecaoAdquirida,
  type ModeloParaConquista,
} from '../web/src/components/partida/somDaConquista'
import {
  CAMINHO_SOM_CARTAO_ACESSO,
  CAMINHO_SOM_GERADOR_LIGADO,
  CAMINHO_SOM_PROTECAO_ADQUIRIDA,
  VOLUME_BASE_SOM_CARTAO_ACESSO,
  VOLUME_BASE_SOM_GERADOR_LIGADO,
  VOLUME_BASE_SOM_PROTECAO_ADQUIRIDA,
} from '../web/src/game/tabuleiro/animacao'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeEfeito,
} from './helpers/mockAudio'
import type {
  EstadoDaPartidaSnapshot,
  PeaoNoSnapshot,
  PecaPosicionadaNoSnapshot,
} from '@flicker/shared'

// Sons de conquista (issue #385, follow-up): evento-driven por aquisição —
// SÓ `POSICAO_CONFIRMADA` soa, por comparação pré/pós; snapshots nunca soam.
// Áudio mockado globalmente (tests/helpers/mockAudio.ts).

function modeloBase(overrides: Partial<ModeloParaConquista> = {}): ModeloParaConquista {
  return {
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    jogadorPorId: {
      'jogador-1': {
        apelido: 'Ana',
        cor: 'vermelho',
        sanidade: 3,
        emBaixaIluminacao: false,
        amedrontado: false,
        protegido: false,
        ordem: 2,
      },
    },
    ...overrides,
  }
}

describe('som da conquista — pontos próprios com base × mestre (issue #385)', () => {
  it('cada ponto soa o próprio asset com a base própria', () => {
    tocarGeradorLigado()
    tocarCartaoDeAcesso()
    tocarProtecaoAdquirida()

    expect(toquesDeEfeito()).toHaveLength(3)
    expect(toquesDeEfeito()[0]).toMatchObject({
      src: CAMINHO_SOM_GERADOR_LIGADO,
      volume: VOLUME_BASE_SOM_GERADOR_LIGADO,
    })
    expect(toquesDeEfeito()[1]).toMatchObject({
      src: CAMINHO_SOM_CARTAO_ACESSO,
      volume: VOLUME_BASE_SOM_CARTAO_ACESSO,
    })
    expect(toquesDeEfeito()[2]).toMatchObject({
      src: CAMINHO_SOM_PROTECAO_ADQUIRIDA,
      volume: VOLUME_BASE_SOM_PROTECAO_ADQUIRIDA,
    })
  })

  it('mestre escala a base (contrato ADR-0007: volume = mestre × base)', () => {
    tocarGeradorLigado(0.5)

    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]?.volume).toBeCloseTo(VOLUME_BASE_SOM_GERADOR_LIGADO * 0.5, 5)
  })

  it('falha de play() não quebra (no-op sem arquivo)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarCartaoDeAcesso()).not.toThrow()
    expect(toquesDeEfeito()).toHaveLength(1)
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarProtecaoAdquirida()).not.toThrow()
  })
})

describe('tocarConquistasDaConfirmacao — só aquisição pré→pós soa', () => {
  it('gerador novo soa; reconfirmar o mesmo id não soa (dedupe por id)', () => {
    const antes = modeloBase()
    const depois = modeloBase({ geradoresLigados: ['gerador-1'] })
    tocarConquistasDaConfirmacao(antes, depois, 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_GERADOR_LIGADO })

    // Reconfirmar o mesmo gerador: sem id novo, sem som.
    tocarConquistasDaConfirmacao(depois, depois, 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('cartão soa só na transição false→true', () => {
    tocarConquistasDaConfirmacao(modeloBase(), modeloBase({ cartaoDeAcessoObtido: true }), 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_CARTAO_ACESSO })

    // Já obtido antes: sem som.
    const obtido = modeloBase({ cartaoDeAcessoObtido: true })
    tocarConquistasDaConfirmacao(obtido, obtido, 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('proteção soa só em !antes && resultante', () => {
    const comProtecao = (protegido: boolean): ModeloParaConquista =>
      modeloBase({
        jogadorPorId: {
          'jogador-1': {
            apelido: 'Ana',
            cor: 'vermelho',
            sanidade: 3,
            emBaixaIluminacao: false,
            amedrontado: false,
            protegido,
            ordem: 2,
          },
        },
      })
    // Aquisição: soa.
    tocarConquistasDaConfirmacao(comProtecao(false), comProtecao(true), 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_PROTECAO_ADQUIRIDA })

    // Já protegido antes: sem som. Resultante false: sem som.
    tocarConquistasDaConfirmacao(comProtecao(true), comProtecao(true), 'jogador-1')
    tocarConquistasDaConfirmacao(comProtecao(false), comProtecao(false), 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('sem aquisição, silêncio total', () => {
    const antes = modeloBase()
    tocarConquistasDaConfirmacao(antes, antes, 'jogador-1')
    expect(toquesDeEfeito()).toHaveLength(0)
  })
})

// ── Integração ponta a ponta: SÓ POSICAO_CONFIRMADA soa; snapshot nunca ──

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'

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
      { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'jogador-4', apelido: 'Cara', cor: 'amarelo', ordem: 4, peaoId: 'peao-amarelo', primeiroTurnoPendente: true, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ],
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
  }
}

const GERADOR_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'gerador-1',
  tipo: 'gerador',
  orientacao: 0,
  celula: { linha: 3, coluna: 3 },
}
const DIRETOR_1: PecaPosicionadaNoSnapshot = {
  pecaId: 'sala-diretor-1',
  tipo: 'sala_do_diretor',
  orientacao: 0,
  celula: { linha: 3, coluna: 4 },
}

async function partidaComTabuleiro(
  posicionadas: readonly PecaPosicionadaNoSnapshot[],
  peoes: readonly PeaoNoSnapshot[],
  snapshotOverrides: Partial<EstadoDaPartidaSnapshot> = {},
): Promise<MockWebSocket> {
  renderPartidaNaRota('/partida?serverId=s&partidaId=p')
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
  act(() =>
    ws.simulateMessage({
      type: 'ESTADO_DA_PARTIDA',
      snapshot: {
        ...criarSnapshotBase({
          tabuleiro: {
            posicionadas: [...posicionadas],
            iniciais: [],
            peoes: [...peoes],
            recebidas: [],
            pecaSelecionadaId: null,
            pecaEmManipulacaoId: null,
            peaoSelecionadoId: null,
            pecasRestantesNaCaixa: 83,
          },
        }),
        ...snapshotOverrides,
      },
    }),
  )
  await screen.findByTestId('hud-turno-ativo')
  return ws
}

afterEach(() => {
  MockWebSocket.clean()
})

describe('conquista na tela — POSICAO_CONFIRMADA soa, snapshot nunca', () => {
  const PEOES: readonly PeaoNoSnapshot[] = [
    { peaoId: 'peao-branco', cor: 'branco', pecaId: 'gerador-1' },
    { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
    { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
    { peaoId: 'peao-amarelo', cor: 'amarelo', pecaId: null },
  ]

  it('confirmar no gerador soa o gerador uma vez; repetir não soa', async () => {
    const ws = await partidaComTabuleiro([GERADOR_1], PEOES)
    expect(toquesDeEfeito()).toHaveLength(0)

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'gerador-1',
        protegido: false,
      }),
    )
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_GERADOR_LIGADO })

    // Reconfirmar o mesmo gerador: dedupe por id, sem som novo.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'gerador-1',
        protegido: false,
      }),
    )
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('confirmar na sala do diretor soa o cartão; snapshot com cartão não soa', async () => {
    const ws = await partidaComTabuleiro([DIRETOR_1], PEOES)
    expect(toquesDeEfeito()).toHaveLength(0)

    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'sala-diretor-1',
        protegido: false,
      }),
    )
    expect(toquesDeEfeito()).toHaveLength(1)
    expect(toquesDeEfeito()[0]).toMatchObject({ src: CAMINHO_SOM_CARTAO_ACESSO })

    // Snapshot com o cartão já obtido: baseline sem fanfarra.
    act(() =>
      ws.simulateMessage({
        type: 'ESTADO_DA_PARTIDA',
        snapshot: criarSnapshotBase({ cartaoDeAcessoObtido: true }),
      }),
    )
    expect(toquesDeEfeito()).toHaveLength(1)
  })

  it('proteção resultante soa o remédio; sem aquisição, silêncio', async () => {
    const ws = await partidaComTabuleiro([GERADOR_1], PEOES)

    // Sala Médica concedeu (resultante true, antes false): soa gerador + remédio.
    act(() =>
      ws.simulateMessage({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: MEU_JOGADOR_ID,
        peaoId: 'peao-branco',
        pecaId: 'gerador-1',
        protegido: true,
      }),
    )
    expect(toquesDeEfeito().map((t) => t.src)).toEqual([
      CAMINHO_SOM_GERADOR_LIGADO,
      CAMINHO_SOM_PROTECAO_ADQUIRIDA,
    ])
  })
})
