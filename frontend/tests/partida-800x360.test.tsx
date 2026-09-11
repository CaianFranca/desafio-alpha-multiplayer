import * as fs from 'node:fs'
import * as path from 'node:path'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HudDaPartida, deveUsarHudCompacto } from '../web/src/components/partida/HudDaPartida'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { SalaWebSocketContext } from '../web/src/state/sala-web-socket-context'
import type { UseSalaWebSocketReturn } from '../web/src/hooks/useSalaWebSocket'
import { MockWebSocket } from './helpers/mockWebSocket'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'
import {
  LIMIAR_ASPECTO_LARGO_BAIXO,
  MARGEM_CAMERA_INTERATIVA,
  MARGEM_CAMERA_LARGA_BAIXA,
  calcularDistanciaAfastada,
  calcularDistanciaProxima,
  calcularFatorPinch,
  clampAlvo,
  clampDistancia,
  ehAspectoLargoBaixo,
  margemParaAspecto,
  panDeltaToWorld,
} from '../web/src/game/ambiente/cameraLimites'
import {
  FOV_CAMERA,
  NEVOA_LONGE,
  NEVOA_PERTO,
} from '../web/src/game/ambiente/contrato'

// Calibragem 800x360 com HUD contido e mínimo mobile (issue #230, spec #229).
// Comportamento externo com viewport mockado — nunca pixel/classe/timer interno:
// enquadrou (distância < névoa, centro clampado), não esmaeceu (fog além da
// Mesa), não cobriu (HUD pointer-events-none + safe-area), compactou
// (título fora, ícones locais, conquistas só ícones, mínimo integral).

function lerFonte(rel: string): string {
  const candidatos = [
    path.resolve(__dirname, '..', '..', rel),
    path.resolve(process.cwd(), rel),
  ]
  for (const p of candidatos) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  }
  throw new Error(`fonte não encontrada: ${rel}`)
}

const MEU_JOGADOR_ID = '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90'
const JOGADORES_BASE: EstadoDaPartidaSnapshot['jogadores'] = [
  { jogadorId: MEU_JOGADOR_ID, apelido: 'JogadorTeste', cor: 'branco', ordem: 1, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: true, amedrontado: false, protegido: true },
  { jogadorId: 'jogador-2', apelido: 'Ana', cor: 'vermelho', ordem: 2, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 2, emBaixaIluminacao: false, amedrontado: false, protegido: false },
  { jogadorId: 'jogador-3', apelido: 'Beto', cor: 'azul', ordem: 3, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
]

function criarSnapshotBase(): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: [
        { peaoId: 'peao-branco', cor: 'branco', pecaId: null },
        { peaoId: 'peao-vermelho', cor: 'vermelho', pecaId: null },
        { peaoId: 'peao-azul', cor: 'azul', pecaId: null },
      ],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      pecasRestantesNaCaixa: 83,
    },
    jogadores: JOGADORES_BASE,
    jogadorAtivoId: MEU_JOGADOR_ID,
    rodada: 2,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: ['gerador-1'],
    cartaoDeAcessoObtido: false,
  } as EstadoDaPartidaSnapshot
}

const PROPS_HUD_BASE = {
  jogadorPorId: {
    [MEU_JOGADOR_ID]: { apelido: 'JogadorTeste', cor: 'branco' as const, sanidade: 3, emBaixaIluminacao: true, amedrontado: false, protegido: true, ordem: 1 },
    'jogador-2': { apelido: 'Ana', cor: 'vermelho' as const, sanidade: 2, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 2 },
    'jogador-3': { apelido: 'Beto', cor: 'azul' as const, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false, ordem: 3 },
  },
  jogadorAtivoId: MEU_JOGADOR_ID,
  jogadorLocalId: MEU_JOGADOR_ID,
  geradoresLigados: ['gerador-1'] as string[],
  cartaoDeAcessoObtido: false,
  emAndamento: true,
  emResultado: false,
  onSair: () => {},
}

let originalW = 0
let originalH = 0
function mockViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: h })
  window.dispatchEvent(new Event('resize'))
}
function salvarViewport(): void {
  originalW = window.innerWidth
  originalH = window.innerHeight
}
function restaurarViewport(): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalW })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalH })
}

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

afterEach(() => {
  MockWebSocket.clean()
})

describe('800x360 — Mesa enquadra sem esmaecer, pan/pinch funcionais', () => {
  it('aspecto 800/360 é largo-baixo com margem justa; desktop mantém 1.05', () => {
    expect(800 / 360).toBeGreaterThanOrEqual(LIMIAR_ASPECTO_LARGO_BAIXO)
    expect(ehAspectoLargoBaixo(800 / 360)).toBe(true)
    expect(ehAspectoLargoBaixo(16 / 9)).toBe(false)
    expect(ehAspectoLargoBaixo(1)).toBe(false)
    expect(margemParaAspecto(800 / 360)).toBe(MARGEM_CAMERA_LARGA_BAIXA)
    expect(margemParaAspecto(1)).toBe(MARGEM_CAMERA_INTERATIVA)
    expect(margemParaAspecto(16 / 9)).toBe(MARGEM_CAMERA_INTERATIVA)
    expect(MARGEM_CAMERA_LARGA_BAIXA).toBeLessThan(MARGEM_CAMERA_INTERATIVA)
  })

  it('distância afastada 800x360 enquadra (centro clampado) e fica antes da névoa', () => {
    const aspect = 800 / 360
    const afastada = calcularDistanciaAfastada(aspect)
    expect(afastada).toBeGreaterThan(0)
    // Mesa mais próxima que no desktop (não encolhe na altura curta).
    expect(afastada).toBeLessThan(calcularDistanciaAfastada(1))
    // Centro enquadra sem deslocamento.
    expect(clampAlvo({ x: 0, z: 0 }, afastada, FOV_CAMERA, aspect)).toEqual({ x: 0, z: 0 })
    // Névoa além do teto do zoom + cantos (~32): Mesa não esmaece.
    expect(NEVOA_PERTO).toBe(32)
    expect(NEVOA_LONGE).toBe(95)
    expect(afastada).toBeLessThan(NEVOA_PERTO)
  })

  it('AmbienteCena usa a névoa calibrada (sem fog fixo que esmaeça a Mesa)', () => {
    const fonte = lerFonte('frontend/web/src/game/scenes/AmbienteCena.tsx')
    expect(fonte).toContain('NEVOA_PERTO')
    expect(fonte).toContain('NEVOA_LONGE')
    expect(fonte).not.toContain('args={[COR_FUNDO, 24, 70]}')
  })

  it('pan/zoom funcionais em 800x360: arrasto desloca, pinch aproxima/afasta no range', () => {
    const aspect = 800 / 360
    const afastada = calcularDistanciaAfastada(aspect)
    const proxima = calcularDistanciaProxima(afastada)
    // Pan: arrasto gera deslocamento de mundo (sinal invertido, como na câmera).
    const delta = panDeltaToWorld(20, 10, FOV_CAMERA, afastada, 360)
    expect(delta.x).toBeLessThan(0)
    expect(delta.z).toBeLessThan(0)
    // Zoom-in libera pan além do centro.
    const alvoZoomIn = clampAlvo({ x: 4, z: 4 }, proxima, FOV_CAMERA, aspect)
    expect(Math.abs(alvoZoomIn.x) + Math.abs(alvoZoomIn.z)).toBeGreaterThan(0)
    // Pinch: dedos se afastam aproxima, se juntam afasta — dentro do range.
    const aproximar = afastada * calcularFatorPinch(100, 200)
    const afastar = proxima * calcularFatorPinch(100, 50)
    expect(clampDistancia(aproximar, afastada, proxima)).toBeLessThan(afastada)
    expect(clampDistancia(afastar, afastada, proxima)).toBeGreaterThan(proxima)
  })
})

describe('800x360 — HUD compacto: mínimo integral, título fora, safe-area', () => {
  it('deveUsarHudCompacto: 800x360 sim; desktop/tablet/portrait não', () => {
    expect(deveUsarHudCompacto(800, 360)).toBe(true)
    expect(deveUsarHudCompacto(812, 375)).toBe(true)
    expect(deveUsarHudCompacto(1024, 768)).toBe(false)
    expect(deveUsarHudCompacto(1280, 720)).toBe(false)
    expect(deveUsarHudCompacto(768, 1024)).toBe(false)
    expect(deveUsarHudCompacto(375, 812)).toBe(false)
  })

  it('compacto mantém local/turno/sistema integrais; estados locais viram ícones; conquistas só ícones; título fora', () => {
    const { unmount } = render(<HudDaPartida {...PROPS_HUD_BASE} compacto />)
    // Mínimo mobile integral.
    expect(screen.getByTestId('hud-jogador-local')).toBeInTheDocument()
    expect(screen.getByTestId('hud-turno')).toBeInTheDocument()
    expect(screen.getByTestId('hud-controles-partida')).toBeInTheDocument()
    expect(screen.getByTestId('hud-cronometro')).toBeInTheDocument()
    expect(screen.getByTestId('hud-outros-jogadores')).toBeInTheDocument()
    expect(screen.getByTestId('hud-conquistas')).toBeInTheDocument()
    expect(screen.getByTestId('hud-sanidade')).toHaveAttribute('data-sanidade', '3')
    expect(screen.getByTestId('hud-turno-ativo')).toHaveAttribute('data-jogador-id', MEU_JOGADOR_ID)
    // Título fora no mínimo.
    expect(screen.queryByTestId('hud-titulo')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('data-modo-compacto', 'true')
    // Estados locais como ícones ao lado do nome, sem cards.
    expect(screen.getByTestId('hud-local-estados-icones')).toBeInTheDocument()
    expect(screen.getAllByTestId('hud-local-estado-icone')).toHaveLength(3)
    expect(screen.queryByTestId('hud-card-baixa-iluminacao')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-card-amedrontado')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hud-card-protecao')).not.toBeInTheDocument()
    // Conquistas só ícones, sem rótulos.
    expect(screen.getAllByTestId('hud-conquista-gerador')).toHaveLength(3)
    expect(screen.getByTestId('hud-conquista-cartao')).toBeInTheDocument()
    expect(screen.getByTestId('hud-conquistas')).not.toHaveTextContent('Geradores')
    expect(screen.getByTestId('hud-conquistas')).not.toHaveTextContent('Cartão')
    // Avatares compactados seguem presentes (mínimo, sem ocultar).
    expect(screen.getAllByTestId('hud-avatar-adversario')).toHaveLength(2)
    unmount()
  })

  it('integral (desktop) mantém título e cards, sem ícones compactos', () => {
    const { unmount } = render(<HudDaPartida {...PROPS_HUD_BASE} compacto={false} />)
    expect(screen.getByTestId('hud-titulo')).toBeInTheDocument()
    expect(screen.getByTestId('hud-card-baixa-iluminacao')).toBeInTheDocument()
    expect(screen.queryByTestId('hud-local-estados-icones')).not.toBeInTheDocument()
    expect(screen.getByTestId('hud-conquistas')).toHaveTextContent('Geradores')
    expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('data-modo-compacto', 'false')
    unmount()
  })

  it('viewport mockado 800x360 ativa o compacto sem prop (seam no ponto mais alto)', () => {
    salvarViewport()
    mockViewport(800, 360)
    try {
      const { unmount } = render(<HudDaPartida {...PROPS_HUD_BASE} />)
      expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('data-modo-compacto', 'true')
      expect(screen.queryByTestId('hud-titulo')).not.toBeInTheDocument()
      expect(screen.getByTestId('hud-jogador-local')).toBeInTheDocument()
      unmount()
    } finally {
      restaurarViewport()
    }
  })

  it('HUD não cobre alvos: raiz ignora ponteiro + regiões com safe-area', () => {
    const { unmount } = render(<HudDaPartida {...PROPS_HUD_BASE} compacto />)
    // Raiz sem interceptar toque (alvos 3D clicáveis por baixo).
    expect(screen.getByTestId('hud-da-partida').className).toMatch(/pointer-events-none/)
    // Bordas com safe-area para entalhe/borda do celular.
    for (const testid of ['hud-outros-jogadores', 'hud-controles-partida', 'hud-conquistas', 'hud-turno']) {
      const el = screen.getByTestId(testid)
      const estilo = (el.getAttribute('style') ?? '').replace(/\s/g, '')
      expect(estilo).toMatch(/env\(safe-area-inset-(left|right|top|bottom)\)/)
    }
    // SAIR segue acionável (44px já coberto por partida-alvos-de-dedo).
    expect(screen.getByTestId('hud-sair').className).toContain('pointer-events-auto')
    unmount()
  })
})

describe('800x360 — controles de turno contidos com safe-area', () => {
  it('PartidaPage contém controles no compacto sem sobrepor HUD/alvos', async () => {
    salvarViewport()
    mockViewport(800, 360)
    try {
      const mockCtx = mockSalaContext()
      const router = createMemoryRouter(
        [{ path: '/partida', element: <PartidaPage /> }],
        { initialEntries: ['/partida?serverId=s&partidaId=p'] },
      )
      render(
        <AuthProvider initialState={mockAuthenticatedState}>
          <SalaWebSocketContext.Provider value={mockCtx}>
            <RouterProvider router={router} />
          </SalaWebSocketContext.Provider>
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
      act(() => ws.simulateMessage({ type: 'ESTADO_DA_PARTIDA', snapshot: criarSnapshotBase() }))
      // HUD em modo compacto (título fora, mínimo presente).
      await screen.findByTestId('hud-da-partida')
      expect(screen.getByTestId('hud-da-partida')).toHaveAttribute('data-modo-compacto', 'true')
      expect(screen.queryByTestId('hud-titulo')).not.toBeInTheDocument()
      // Controles de turno contidos no mesmo breakpoint, com safe-area.
      const controles = await screen.findByTestId('controles-de-turno')
      expect(controles).toHaveAttribute('data-compacto', 'true')
      const estilo = (controles.getAttribute('style') ?? '').replace(/\s/g, '')
      expect(estilo).toMatch(/env\(safe-area-inset-(right|bottom)\)/)
    } finally {
      restaurarViewport()
    }
  })
})
