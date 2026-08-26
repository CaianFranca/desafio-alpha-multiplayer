import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'

// Replica a composição de main.tsx (AuthProvider envolvendo RouterProvider),
// permitindo injetar o estado de autenticação via props do provider.
// O default explícito garante testes determinísticos, independentes do .env.
function renderWithRouter(initialEntries: string[] = ['/'], authState: AuthState = visitorState) {
  const router = createMemoryRouter(routes, { initialEntries })
  return render(
    <AuthProvider initialState={authState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

describe('homepage structure', () => {
  it('renders all main sections', () => {
    renderWithRouter()

    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trailers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /a história/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /características do jogo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /objetivos/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pronto para enfrentar o sanatório/i })).toBeInTheDocument()
  })

  it('renders the header with navigation and CTAs', () => {
    renderWithRouter()

    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /flicker of sanity/i })).toHaveAttribute('href', '/')

    const nav = screen.getByRole('navigation', { name: /navegação principal/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trailers' })).toHaveAttribute('href', '#trailers')
    expect(screen.getByRole('link', { name: /história/i })).toHaveAttribute('href', '#historia')
    expect(screen.getByRole('link', { name: /características/i })).toHaveAttribute('href', '#caracteristicas')
    expect(screen.getByRole('link', { name: /objetivos/i })).toHaveAttribute('href', '#objetivos')
  })

  it('renders feature cards for all five game features', () => {
    renderWithRouter()

    expect(screen.getByRole('heading', { name: /cooperação/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /exploração/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /minigames/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /monstros/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sanidade/i })).toBeInTheDocument()
  })

  it('renders objective items with numbered list', () => {
    renderWithRouter()

    expect(screen.getByRole('heading', { name: /ativar os geradores/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /conseguir o cartão de acesso/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /abrir o portão de saída/i })).toBeInTheDocument()
  })

  it('renders footer with brand and copyright', () => {
    renderWithRouter()

    const footer = screen.getByRole('contentinfo')
    expect(footer).toBeInTheDocument()
    expect(within(footer).getAllByText(/flicker of sanity/i).length).toBeGreaterThanOrEqual(1)
    expect(within(footer).getByText(/todos os direitos reservados/i)).toBeInTheDocument()
  })
})

describe('stub pages', () => {
  it('renders cadastro stub page directly', () => {
    renderWithRouter(['/cadastro'])

    expect(screen.getByRole('heading', { name: /cadastro/i })).toBeInTheDocument()
    const section = screen.getByRole('heading', { name: /cadastro/i }).closest('section')!
    expect(section).toHaveTextContent(/em construção/i)
    expect(screen.getByRole('link', { name: /voltar ao início/i })).toHaveAttribute('href', '/')
  })

  it('renders login stub page directly', () => {
    renderWithRouter(['/login'])

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    const section = screen.getByRole('heading', { name: /^entrar$/i }).closest('section')!
    expect(section).toHaveTextContent(/em construção/i)
    expect(screen.getByRole('link', { name: /voltar ao início/i })).toHaveAttribute('href', '/')
  })

  it('back link navigates to homepage', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.click(screen.getByRole('link', { name: /voltar ao início/i }))

    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
  })
})

describe('hero CTAs', () => {
  it('hero signup link navigates to cadastro', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    const heroSection = document.getElementById('hero')!
    const heroSignup = within(heroSection).getByRole('link', { name: /criar conta/i })
    await user.click(heroSignup)

    expect(screen.getByRole('heading', { name: /cadastro/i })).toBeInTheDocument()
  })

  it('hero login link navigates to login', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    const heroSection = document.getElementById('hero')!
    const heroLogin = within(heroSection).getByRole('link', { name: /entrar/i })
    await user.click(heroLogin)

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
  })
})

describe('authentication states', () => {
  const visitante: AuthState = { status: 'visitor' }
  const autenticado = mockAuthenticatedState
  const apelidoMock = mockAuthenticatedState.jogador.apelido

  it('visitor header shows no nickname and no Criar Sala action', () => {
    renderWithRouter(['/'], visitante)

    const header = screen.getByRole('banner')
    expect(within(header).queryByText(apelidoMock)).not.toBeInTheDocument()
    expect(within(header).queryByRole('link', { name: /criar sala/i })).not.toBeInTheDocument()

    const heroSection = document.getElementById('hero')!
    expect(within(heroSection).getByRole('link', { name: /criar conta/i })).toBeInTheDocument()
    expect(within(heroSection).getByRole('link', { name: /^entrar$/i })).toBeInTheDocument()
  })

  it('authenticated header shows nickname and Criar Sala link', () => {
    renderWithRouter(['/'], autenticado)

    const header = screen.getByRole('banner')
    expect(within(header).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: /criar sala/i })).toHaveAttribute('href', '/salas/criar')

    const heroSection = document.getElementById('hero')!
    expect(within(heroSection).getByRole('link', { name: /criar sala/i })).toBeInTheDocument()
    expect(within(heroSection).queryByRole('link', { name: /criar conta/i })).not.toBeInTheDocument()
  })

  it('final call to action mirrors the current auth state', () => {
    const { unmount } = renderWithRouter(['/'], visitante)

    const finalCtaRegion = screen.getByRole('region', { name: /pronto para enfrentar o sanatório/i })
    expect(within(finalCtaRegion).getByRole('link', { name: /criar conta/i })).toBeInTheDocument()
    expect(within(finalCtaRegion).queryByRole('link', { name: /criar sala/i })).not.toBeInTheDocument()
    unmount()

    renderWithRouter(['/'], autenticado)
    const authenticatedFinalCta = screen.getByRole('region', { name: /pronto para enfrentar o sanatório/i })
    expect(within(authenticatedFinalCta).getByRole('link', { name: /criar sala/i })).toBeInTheDocument()
    expect(within(authenticatedFinalCta).queryByRole('link', { name: /criar conta/i })).not.toBeInTheDocument()
  })

  it('redirects visitor trying to open create room page to login', () => {
    renderWithRouter(['/salas/criar'], visitante)

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getAllByText(/em construção/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  it('lets authenticated player open the create room page', () => {
    renderWithRouter(['/salas/criar'], autenticado)

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
    expect(screen.getAllByText(/em construção/i).length).toBeGreaterThan(0)
  })

  it('authenticated header Criar Sala action navigates to the create room page', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/'], autenticado)

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: /criar sala/i }))

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
  })
})

describe('responsive sections', () => {
  it.each([
    ['mobile (375px)', 375],
    ['tablet (768px)', 768],
    ['desktop (1280px)', 1280],
  ])('renders all sections at %s', (_label, width) => {
    setViewport(width)
    renderWithRouter()

    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trailers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /a história/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /características do jogo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /objetivos/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pronto para enfrentar o sanatório/i })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('skip-link is present for keyboard navigation', () => {
    renderWithRouter()

    const skipLink = screen.getByText(/pular para o conteúdo/i)
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })
})
