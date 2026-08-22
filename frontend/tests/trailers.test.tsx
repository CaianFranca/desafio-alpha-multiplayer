import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function getVideo(section: HTMLElement) {
  const video = section.querySelector('video')
  if (!video) throw new Error('vídeo deveria estar montado')
  return video as HTMLVideoElement
}

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('seção de trailers', () => {
  it('renderiza âncora, título, descrição e conteúdo textual de cada trailer sem vídeo', () => {
    const section = renderHome()

    expect(screen.getByRole('heading', { name: 'Trailers' })).toBeInTheDocument()
    expect(section).toHaveAttribute('aria-labelledby', 'trailers-title')
    expect(within(section).getByText(trailers.description)).toBeInTheDocument()
    for (const item of trailers.items) {
      expect(within(section).getByRole('heading', { name: item.titulo })).toBeInTheDocument()
    }
    expect(within(section).getByText(trailers.mensagens.indisponivel)).toBeInTheDocument()
    expect(section.querySelector('video')).toBeNull()
  })

  it('monta o vídeo só quando entra na tela, com autoplay mudo e preload none', () => {
    const section = renderHome()
    expect(section.querySelector('video')).toBeNull()

    act(() => FakeIntersectionObserver.instances[0].trigger(true))

    expect(section.querySelectorAll('video')).toHaveLength(1)
    const video = getVideo(section)
    expect(video.getAttribute('src')).toBe('/videos/trailer-anuncio.mp4')
    expect(video.autoplay).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.preload).toBe('none')
    expect(within(section).getByText(trailers.mensagens.indisponivel)).toBeInTheDocument()
  })

  it('sem IntersectionObserver, carrega sob demanda pela interação do usuário', async () => {
    const user = userEvent.setup()
    Reflect.deleteProperty(window, 'IntersectionObserver')

    const section = renderHome()
    expect(section.querySelector('video')).toBeNull()

    await user.click(within(section).getByRole('button', { name: trailers.labels.play }))

    const video = getVideo(section)
    expect(video.getAttribute('src')).toBe('/videos/trailer-anuncio.mp4')
  })

  it('controles de reprodução e áudio funcionam por teclado e clique', async () => {
    const user = userEvent.setup()
    const section = renderHome()
    act(() => FakeIntersectionObserver.instances[0].trigger(true))

    const video = getVideo(section)
    expect(within(section).getByRole('status')).toHaveTextContent(trailers.mensagens.carregando)
    act(() => video.dispatchEvent(new Event('canplay')))
    expect(within(section).queryByText(trailers.mensagens.carregando)).not.toBeInTheDocument()

    const botaoPlay = within(section).getByRole('button', { name: trailers.labels.play })
    botaoPlay.focus()
    await user.keyboard('{Enter}')
    expect(botaoPlay).toHaveAccessibleName(trailers.labels.pause)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()

    await user.click(within(section).getByRole('button', { name: trailers.labels.pause }))
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(within(section).getByRole('button', { name: trailers.labels.play })).toBeInTheDocument()

    expect(video.muted).toBe(true)
    await user.click(within(section).getByRole('button', { name: trailers.labels.som }))
    expect(video.muted).toBe(false)
    await user.click(within(section).getByRole('button', { name: trailers.labels.mudo }))
    expect(video.muted).toBe(true)
  })

  it('em caso de falha de carregamento mostra capa com mensagem alternativa', async () => {
    const section = renderHome()
    act(() => FakeIntersectionObserver.instances[0].trigger(true))
    const video = getVideo(section)

    await act(async () => {
      video.dispatchEvent(new Event('error'))
    })

    expect(section.querySelector('video')).toBeNull()
    expect(within(section).getByText(trailers.mensagens.falha)).toBeInTheDocument()
    expect(within(section).getByRole('img', { name: 'Trailer de Anúncio' })).toBeInTheDocument()
    expect(within(section).queryByRole('button')).toBeNull()
  })

  it('sem src mostra placeholder em gradiente com mensagem de indisponível', () => {
    const section = renderHome()

    const placeholder = within(section).getByText(trailers.mensagens.indisponivel).closest('[role="img"]')
    if (!placeholder) throw new Error('placeholder deveria existir')

    expect(placeholder).toHaveAttribute('aria-label', 'Gameplay em Grupo')
    expect(placeholder).toHaveClass('bg-linear-to-br')
    const li = placeholder.closest('li')!
    expect(li.querySelector('video')).toBeNull()
    expect(within(li).queryByRole('button')).toBeNull()
  })
})
