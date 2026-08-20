import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'

function renderWithRouter(initialEntries: string[] = ['/']) {
  const router = createMemoryRouter(routes, { initialEntries })
  return render(<RouterProvider router={router} />)
}

describe('homepage structure', () => {
  it('renders all main sections', () => {
    renderWithRouter()

    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: /história/i })).toHaveAttribute('href', '#historia')
    expect(screen.getByRole('link', { name: /características/i })).toHaveAttribute('href', '#caracteristicas')
    expect(screen.getByRole('link', { name: /objetivos/i })).toHaveAttribute('href', '#objetivos')

    const headerActions = within(header).getByRole('link', { name: /criar conta/i })
    expect(headerActions).toHaveAttribute('href', '/cadastro')

    const headerLogin = within(header).getByRole('link', { name: /entrar/i })
    expect(headerLogin).toHaveAttribute('href', '/login')

    expect(screen.getByRole('link', { name: /criar sala/i })).toHaveAttribute('href', '/salas/criar')
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

describe('navigation to stub routes', () => {
  it('navigates to cadastro page via header CTA', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    const header = screen.getByRole('banner')
    await user.click(within(header).getByRole('link', { name: /criar conta/i }))

    expect(screen.getByRole('heading', { name: /cadastro/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /cadastro/i }).closest('section')!).toHaveTextContent(/em construção/i)
    expect(screen.getByRole('link', { name: /voltar ao início/i })).toBeInTheDocument()
  })

  it('navigates to login page via header CTA', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    const header = screen.getByRole('banner')
    await user.click(within(header).getByRole('link', { name: /entrar/i }))

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^entrar$/i }).closest('section')!).toHaveTextContent(/em construção/i)
  })

  it('navigates to criar sala page via header CTA', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    await user.click(screen.getByRole('link', { name: /criar sala/i }))

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /criar sala/i }).closest('section')!).toHaveTextContent(/em construção/i)
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

  it('renders criar sala stub page directly', () => {
    renderWithRouter(['/salas/criar'])

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
    const section = screen.getByRole('heading', { name: /criar sala/i }).closest('section')!
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
