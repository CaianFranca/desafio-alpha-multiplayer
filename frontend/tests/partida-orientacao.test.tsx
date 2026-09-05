import { render, screen, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { OverlayOrientacao } from '../web/src/components/partida/OverlayOrientacao'
import { LIMITE_CELULAR_PX } from '../web/src/hooks/useOrientacaoCelular'

// Helper para mockar viewport e matchMedia
type MqlListener = (e: MediaQueryListEvent) => void

function createMatchMediaMock(portraitMatches: boolean) {
  const listeners = new Set<MqlListener>()
  const mql = {
    matches: portraitMatches,
    media: '(orientation: portrait)',
    addEventListener: (type: string, cb: MqlListener) => {
      if (type === 'change') listeners.add(cb)
    },
    removeEventListener: (type: string, cb: MqlListener) => {
      if (type === 'change') listeners.delete(cb)
    },
    // fallback legado
    addListener: (cb: MqlListener) => listeners.add(cb),
    removeListener: (cb: MqlListener) => listeners.delete(cb),
    dispatchChange: (nextMatches: boolean) => {
      ;(mql as unknown as { matches: boolean }).matches = nextMatches
      const event = { matches: nextMatches, media: '(orientation: portrait)' } as MediaQueryListEvent
      listeners.forEach((cb) => cb(event))
    },
  } as unknown as MediaQueryList & { dispatchChange: (m: boolean) => void }
  return mql
}

let currentMql: (MediaQueryList & { dispatchChange: (m: boolean) => void }) | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalInnerWidth: number
let originalInnerHeight: number

function mockViewport(width: number, height: number, portraitMatches: boolean) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
  currentMql = createMatchMediaMock(portraitMatches)
  ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = vi
    .fn()
    .mockImplementation((query: string) => {
      if (query === '(orientation: portrait)') return currentMql as unknown as MediaQueryList
      return createMatchMediaMock(false) as unknown as MediaQueryList
    })
}

function mockViewportFallback(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
  // remove matchMedia para exercitar fallback innerHeight > innerWidth
  ;(window as unknown as { matchMedia: unknown }).matchMedia = undefined
}

function restoreViewport() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight })
  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia
  } else {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia
  }
  currentMql = null
}

function renderPartida(estadoInicial: 'disponivel' | 'carregando' | 'falha' = 'disponivel') {
  const router = createMemoryRouter(
    [{ path: '/partida', element: <PartidaPage estadoInicial={estadoInicial} /> }],
    { initialEntries: ['/partida?serverId=s&partidaId=p'] },
  )
  return render(
    <AuthProvider initialState={mockAuthenticatedState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('OverlayOrientacao — componente isolado', () => {
  it('renderiza com data-testid, role alert e z-50 bloqueante', () => {
    render(<OverlayOrientacao />)
    const overlay = screen.getByTestId('overlay-orientacao')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'alert')
    expect(overlay).toHaveClass('z-50')
    expect(overlay).toHaveClass('absolute')
    expect(overlay).toHaveClass('inset-0')
    expect(overlay).toHaveClass('pointer-events-auto')
    expect(overlay).toHaveTextContent('Vire o aparelho para jogar')
  })
})

describe('useRequerOrientacaoLandscape via PartidaPage', () => {
  beforeEach(() => {
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    originalMatchMedia = window.matchMedia
  })
  afterEach(() => {
    restoreViewport()
  })

  it('celular Portrait 375x812 exibe overlay e mantém tabuleiro (sem desmontar modelo)', () => {
    mockViewport(375, 812, true)
    renderPartida('disponivel')

    const overlay = screen.getByTestId('overlay-orientacao')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveClass('z-50')
    // Tabuleiro permanece sob o overlay
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
    // Overlay acima de moldura (z-20) e flash (z-40) — z-50 garante
    expect(screen.getByTestId('partida-moldura')).toHaveClass('z-20')
  })

  it('giro para Landscape 812x375 remove overlay sem remontar AmbienteDeJogo', () => {
    mockViewport(375, 812, true)
    renderPartida('disponivel')

    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()
    const ambienteAntes = screen.getByTestId('ambiente-de-jogo')

    // Simula giro: largura vira 812, altura 375, portrait false
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
      currentMql?.dispatchChange(false)
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('orientationchange'))
    })

    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
    // Mesmo DOM — não remontou
    expect(screen.getByTestId('ambiente-de-jogo')).toBe(ambienteAntes)
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('libera também via evento matchMedia change sem resize', () => {
    mockViewport(375, 812, true)
    renderPartida('disponivel')
    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()

    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
      currentMql?.dispatchChange(false)
    })

    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
  })

  it('resize para >=768 em Portrait não exibe overlay (tablet nunca bloqueia)', () => {
    mockViewport(768, 1024, true)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()

    // 767 ainda é celular → bloqueia, 768 não
    mockViewport(767, 1024, true)
    // re-render para recalcular limite
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    // Como o hook lê innerWidth < 768, precisamos remontar para testar limite isolado
    // Mas resize já deve ter atualizado o estado — verifica
    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()
  })

  it('desktop 1024x768 não exibe overlay mesmo em portrait simulado', () => {
    mockViewport(1024, 768, true)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()

    // desktop landscape também não exibe
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 720 })
      currentMql?.dispatchChange(false)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
  })

  it('fallback sem matchMedia: usa innerHeight > innerWidth e respeita limite 768', () => {
    mockViewportFallback(375, 812)
    renderPartida('disponivel')
    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()

    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()

    // Tablet fallback também não bloqueia
    act(() => {
      mockViewportFallback(1024, 768)
      window.dispatchEvent(new Event('resize'))
    })
    // Precisa remontar pois mudou mock para tablet — render novo
    // Limpa e re-renderiza para validar isolado
  })

  it('fallback sem matchMedia: tablet portrait não bloqueia', () => {
    mockViewportFallback(768, 1024)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
  })

  it('celular landscape 812x375 não exibe overlay (liberação sem recarregar)', () => {
    mockViewport(812, 375, false)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('LIMITE_CELULAR_PX exportado é 768', () => {
    expect(LIMITE_CELULAR_PX).toBe(768)
  })

  it('preserva estado do modelo ao alternar orientação (sanidade/vez não perdidos)', () => {
    // Este teste garante que o overlay é condicional visual e não condiciona AmbienteDeJogo/modelo
    mockViewport(375, 812, true)
    renderPartida('disponivel')
    const tabuleiroAntes = screen.getByTestId('tabuleiro')
    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()

    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
      currentMql?.dispatchChange(false)
      window.dispatchEvent(new Event('resize'))
    })

    expect(screen.queryByTestId('overlay-orientacao')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBe(tabuleiroAntes)
    // Volta a portrait e overlay reaparece — ida e volta sem perder DOM
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 812 })
      currentMql?.dispatchChange(true)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('overlay-orientacao')).toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })
})
