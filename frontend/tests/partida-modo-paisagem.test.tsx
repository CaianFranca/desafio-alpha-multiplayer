import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { OverlayModoPaisagem } from '../web/src/components/partida/OverlayModoPaisagem'

// Helper para mockar viewport e matchMedia (S3)
type MqlListener = (e: MediaQueryListEvent) => void

function createMatchMediaMock(retratoCorresponde: boolean) {
  const listeners = new Set<MqlListener>()
  const mql = {
    matches: retratoCorresponde,
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

/**
 * Define o viewport do teste. Quando `retratoCorresponde` é omitido,
 * remove `matchMedia` para exercitar o fallback geométrico
 * (`innerHeight > innerWidth`). (S3)
 */
function definirViewport(width: number, height: number, retratoCorresponde?: boolean): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
  if (retratoCorresponde === undefined) {
    ;(window as unknown as { matchMedia: unknown }).matchMedia = undefined
    currentMql = null
    return
  }
  currentMql = createMatchMediaMock(retratoCorresponde)
  ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = vi
    .fn()
    .mockImplementation((query: string) => {
      if (query === '(orientation: portrait)') return currentMql as unknown as MediaQueryList
      return createMatchMediaMock(false) as unknown as MediaQueryList
    })
}

/**
 * Simula o giro do aparelho: atualiza dimensões, propaga mudança da
 * media query (quando houver mock) e dispara `resize`/`orientationchange`. (S3)
 */
function girarPara(width: number, height: number, retratoCorresponde?: boolean): void {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
    if (retratoCorresponde !== undefined) {
      currentMql?.dispatchChange(retratoCorresponde)
    }
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
  })
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

describe('OverlayModoPaisagem — componente isolado', () => {
  it('renderiza com data-testid, role alert, aria-live e texto observável', () => {
    render(<OverlayModoPaisagem />)
    const overlay = screen.getByTestId('overlay-modo-paisagem')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'alert')
    expect(overlay).toHaveAttribute('aria-live', 'assertive')
    expect(overlay).toHaveTextContent('Vire o aparelho para jogar')
    expect(overlay).toHaveTextContent('modo paisagem')
  })
})

describe('useRequerModoPaisagem via PartidaPage', () => {
  beforeEach(() => {
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    originalMatchMedia = window.matchMedia
  })
  afterEach(() => {
    cleanup()
    restoreViewport()
  })

  it('celular em retrato 375x812 exibe overlay e mantém tabuleiro (sem desmontar modelo)', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')

    const overlay = screen.getByTestId('overlay-modo-paisagem')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveTextContent('Vire o aparelho para jogar')
    // Tabuleiro permanece sob o overlay
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('giro para paisagem 812x375 remove overlay sem remontar AmbienteDeJogo', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')

    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()
    const ambienteAntes = screen.getByTestId('ambiente-de-jogo')

    girarPara(812, 375, false)

    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
    // Mesmo DOM — não remontou
    expect(screen.getByTestId('ambiente-de-jogo')).toBe(ambienteAntes)
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('libera também via evento matchMedia change sem resize', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()

    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 812 })
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 375 })
      currentMql?.dispatchChange(false)
    })

    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
  })

  it('limite celular: 767 bloqueia, 768 libera (só presença/ausência do overlay)', () => {
    definirViewport(767, 1024, true)
    const primeira = renderPartida('disponivel')
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    primeira.unmount()

    definirViewport(768, 1024, true)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
  })

  it('desktop 1024x768 não exibe overlay mesmo em retrato simulado', () => {
    definirViewport(1024, 768, true)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()

    // desktop em paisagem também não exibe
    girarPara(1280, 720, false)
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
  })

  it('fallback sem matchMedia: retrato celular bloqueia, paisagem libera via resize', () => {
    definirViewport(375, 812)
    renderPartida('disponivel')
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()

    girarPara(812, 375)
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
  })

  it('fallback sem matchMedia: tablet em retrato não bloqueia', () => {
    definirViewport(768, 1024)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
  })

  it('celular em paisagem 812x375 não exibe overlay (liberação sem recarregar)', () => {
    definirViewport(812, 375, false)
    renderPartida('disponivel')
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('overlay bloqueia de verdade: toque na camada não dispensa nem atinge o tabuleiro', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')

    const overlay = screen.getByTestId('overlay-modo-paisagem')
    const tabuleiro = screen.getByTestId('tabuleiro')
    const celulasAntes = screen.getAllByTestId('tabuleiro-celula').length
    const conteudoAntes = tabuleiro.textContent

    // Ordem observável no DOM: overlay após o tabuleiro → pinta por cima
    // no mesmo contexto de empilhamento e recebe o toque primeiro.
    expect(tabuleiro.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Tabuleiro marcado como oculto para leitor de tela enquanto bloqueado.
    expect(tabuleiro).toHaveAttribute('aria-hidden', 'true')

    // Toque do usuário na camada bloqueante: não dispensa o bloqueio…
    fireEvent.click(overlay)
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()
    expect(screen.getByTestId('overlay-modo-paisagem')).toHaveTextContent('Vire o aparelho para jogar')

    // …nem atinge o tabuleiro: células e conteúdo intactos.
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.getAllByTestId('tabuleiro-celula')).toHaveLength(celulasAntes)
    expect(screen.getByTestId('tabuleiro').textContent).toBe(conteudoAntes)
  })

  it('após liberar em paisagem, o tabuleiro recebe cliques sem overlay', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()

    girarPara(812, 375, false)
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()

    // Clique no tabuleiro liberado não reabre overlay nem quebra o DOM.
    fireEvent.click(screen.getByTestId('tabuleiro'))
    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
  })

  it('preserva valores observáveis do tabuleiro ao girar ida-volta', () => {
    definirViewport(375, 812, true)
    renderPartida('disponivel')

    const ambienteAntes = screen.getByTestId('ambiente-de-jogo')
    const tabuleiroAntes = screen.getByTestId('tabuleiro')
    const celulasAntes = screen.getAllByTestId('tabuleiro-celula').length
    const conteudoAntes = tabuleiroAntes.textContent
    const caixaAntes = screen.getByTestId('caixa').textContent
    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()

    girarPara(812, 375, false)

    expect(screen.queryByTestId('overlay-modo-paisagem')).not.toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBe(ambienteAntes)
    expect(screen.getByTestId('tabuleiro')).toBe(tabuleiroAntes)
    expect(screen.getAllByTestId('tabuleiro-celula')).toHaveLength(celulasAntes)
    expect(screen.getByTestId('caixa').textContent).toBe(caixaAntes)

    // Volta ao retrato: overlay reaparece sem perder DOM nem conteúdo.
    girarPara(375, 812, true)

    expect(screen.getByTestId('overlay-modo-paisagem')).toBeInTheDocument()
    expect(screen.getByTestId('tabuleiro')).toBe(tabuleiroAntes)
    expect(screen.getByTestId('tabuleiro').textContent).toBe(conteudoAntes)
    expect(screen.getAllByTestId('tabuleiro-celula')).toHaveLength(celulasAntes)
  })
})
