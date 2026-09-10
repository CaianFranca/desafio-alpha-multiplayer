import { act, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { trailers } from '../web/src/components/home/placeholders'

type IntersectionCallback = (entries: Array<{ isIntersecting: boolean }>) => void

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  private callback: IntersectionCallback
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(callback: IntersectionCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }])
  }
}

function renderHome() {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)
  const section = document.getElementById('trailers')
  if (!section) throw new Error('seção de trailers deveria existir')
  return section
}

/**
 * Localiza o observer do reveal de um alvo (título ou item), pelo nó
 * observado. Cada player também observa seu contêiner interno, então a
 * seleção é pelo alvo exato — e não por índice posicional em `instances`.
 */
function getObserverFor(target: Element | null) {
  const found = FakeIntersectionObserver.instances.find((instance) =>
    instance.observe.mock.calls.some(([node]) => node === target),
  )
  if (!found) throw new Error('observer do reveal deveria existir')
  return found
}

function getRevealTargets() {
  const section = document.getElementById('trailers')
  if (!section) throw new Error('seção de trailers deveria existir')
  const title = screen.getByRole('heading', { name: trailers.title })
  const items = Array.from(section.querySelectorAll('li'))
  if (items.length !== trailers.items.length) {
    throw new Error('itens de trailer deveriam existir')
  }
  return { section, title, items }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('seção de trailers', () => {
  it('renderiza âncora, título e títulos com descrições de cada trailer sem vídeo', () => {
    const section = renderHome()

    expect(section).toHaveAttribute('id', trailers.id)
    expect(screen.getByRole('heading', { name: trailers.title })).toBeInTheDocument()
    expect(section).toHaveAttribute('aria-labelledby', 'trailers-title')
    for (const item of trailers.items) {
      expect(within(section).getByRole('heading', { name: item.titulo })).toBeInTheDocument()
      expect(within(section).getByText(item.descricao)).toBeInTheDocument()
    }
    expect(section.querySelector('video')).toBeNull()
  })

  it('mostra placeholder de indisponível nos dois cards e nunca monta vídeo', () => {
    const section = renderHome()

    const mensagens = within(section).getAllByText(trailers.mensagens.indisponivel)
    expect(mensagens).toHaveLength(trailers.items.length)
    for (const item of trailers.items) {
      const placeholder = within(section).getByRole('img', { name: item.titulo })
      expect(placeholder).toHaveTextContent(trailers.mensagens.indisponivel)
      const li = placeholder.closest('li')
      if (!li) throw new Error('item de trailer deveria existir')
      expect(li.querySelector('video')).toBeNull()
      expect(within(li).queryByRole('button')).toBeNull()
    }
    expect(section.querySelector('video')).toBeNull()
  })

  it('revela título e vídeos uma única vez ao entrar em vista, sem reanimar', () => {
    const { section, title, items } = (() => {
      renderHome()
      return getRevealTargets()
    })()
    const titleObserver = getObserverFor(title)
    const itemObservers = items.map((item) => getObserverFor(item))

    // A seção em si segue estática — só título e cards animam.
    expect(section).not.toHaveClass('trailers-reveal')
    expect(title).toHaveClass('trailers-reveal', 'is-hidden')
    for (const item of items) {
      expect(item).toHaveClass('trailers-reveal', 'is-hidden')
    }

    act(() => titleObserver.trigger(false))
    expect(title).toHaveClass('is-hidden')

    // Cada elemento revela de forma independente ao entrar em vista.
    act(() => titleObserver.trigger(true))
    expect(title).toHaveClass('trailers-reveal', 'is-visible')
    expect(titleObserver.disconnect).toHaveBeenCalled()
    for (const item of items) {
      expect(item).toHaveClass('is-hidden')
    }

    act(() => itemObservers[0]?.trigger(true))
    expect(items[0]).toHaveClass('trailers-reveal', 'is-visible')
    expect(items[1]).toHaveClass('is-hidden')

    act(() => itemObservers[1]?.trigger(true))
    expect(items[1]).toHaveClass('trailers-reveal', 'is-visible')
    expect(itemObservers[1]?.disconnect).toHaveBeenCalled()

    act(() => titleObserver.trigger(true))
    expect(title).toHaveClass('trailers-reveal', 'is-visible')
  })

  it('sem IntersectionObserver, nasce visível (fallback estático)', () => {
    Reflect.deleteProperty(window, 'IntersectionObserver')

    const { section, title, items } = (() => {
      renderHome()
      return getRevealTargets()
    })()

    expect(section).not.toHaveClass('trailers-reveal')
    expect(title).toHaveClass('trailers-reveal', 'is-visible')
    for (const item of items) {
      expect(item).toHaveClass('trailers-reveal', 'is-visible')
    }
    expect(section.querySelector('video')).toBeNull()
  })
})
