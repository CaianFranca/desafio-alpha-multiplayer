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
 * Localiza o observer do reveal da seção (o que observa a própria `#trailers`).
 * Cada player também observa seu contêiner interno, então a seleção é pelo alvo
 * observado — a seção em si — e não por índice posicional em `instances`.
 */
function getSectionObserver() {
  const section = document.getElementById('trailers')
  const found = FakeIntersectionObserver.instances.find((instance) =>
    instance.observe.mock.calls.some(([target]) => target === section),
  )
  if (!found) throw new Error('observer da seção de trailers deveria existir')
  return found
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
  it('renderiza âncora, título, descrição e títulos de cada trailer sem vídeo', () => {
    const section = renderHome()

    expect(section).toHaveAttribute('id', trailers.id)
    expect(screen.getByRole('heading', { name: trailers.title })).toBeInTheDocument()
    expect(section).toHaveAttribute('aria-labelledby', 'trailers-title')
    expect(within(section).getByText(trailers.description)).toBeInTheDocument()
    for (const item of trailers.items) {
      expect(within(section).getByRole('heading', { name: item.titulo })).toBeInTheDocument()
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

  it('revela uma única vez ao entrar em vista, sem reanimar', () => {
    const section = renderHome()
    const observer = getSectionObserver()

    expect(section).toHaveClass('trailers-reveal', 'is-hidden')

    act(() => observer.trigger(false))
    expect(section).toHaveClass('is-hidden')

    act(() => observer.trigger(true))
    expect(section).toHaveClass('trailers-reveal', 'is-visible')
    expect(observer.disconnect).toHaveBeenCalled()

    act(() => observer.trigger(true))
    expect(section).toHaveClass('trailers-reveal', 'is-visible')
  })

  it('sem IntersectionObserver, nasce visível (fallback estático)', () => {
    Reflect.deleteProperty(window, 'IntersectionObserver')

    const section = renderHome()

    expect(section).toHaveClass('trailers-reveal', 'is-visible')
    expect(section.querySelector('video')).toBeNull()
  })
})
