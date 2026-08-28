import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Link, Outlet } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'

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

describe('partida route', () => {
  const visitante: AuthState = { status: 'visitor' }
  const autenticado = estadoAutenticadoMock

  it('autenticado ve moldura e canvas ao acessar /partida diretamente', () => {
    renderWithRouter(['/partida'], autenticado)

    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
  })

  it('canvas ocupa tela cheia sob moldura overlay', () => {
    renderWithRouter(['/partida'], autenticado)

    const canvas = screen.getByTestId('ambiente-de-jogo')
    const moldura = screen.getByTestId('partida-moldura')

    expect(canvas).toHaveClass('absolute')
    expect(canvas).toHaveClass('inset-0')
    expect(canvas).toHaveClass('h-full')
    expect(canvas).toHaveClass('w-full')

    expect(moldura).toHaveClass('absolute')
    expect(moldura).toHaveClass('inset-0')
    expect(moldura).toHaveClass('pointer-events-none')
    expect(moldura).toHaveAttribute('aria-hidden', 'true')
  })

  it('visitante e redirecionado para login ao tentar abrir /partida', () => {
    renderWithRouter(['/partida'], visitante)

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('ambiente-de-jogo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('partida-moldura')).not.toBeInTheDocument()
  })

  it('autenticado navega via SPA sem reload ao clicar em link para /partida', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <Link to="/partida">Ir para partida</Link>
              <Outlet />
            </div>
          ),
          children: routes[0].children,
        },
      ],
      { initialEntries: ['/'] },
    )

    render(
      <AuthProvider initialState={autenticado}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    expect(screen.queryByTestId('ambiente-de-jogo')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /ir para partida/i }))

    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
  })

  it.each([
    ['mobile (375px)', 375],
    ['tablet (768px)', 768],
    ['desktop (1280px)', 1280],
  ])('renderiza moldura e canvas em %s', (_label, width) => {
    setViewport(width)
    renderWithRouter(['/partida'], autenticado)

    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toHaveClass('absolute')
    expect(screen.getByTestId('partida-moldura')).toHaveClass('pointer-events-none')
  })

  it('mantem estrutura responsiva sem quebrar navegacao SPA apos resize', async () => {
    const user = userEvent.setup()
    setViewport(375)
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <Link to="/partida">Ir para partida</Link>
              <Outlet />
            </div>
          ),
          children: routes[0].children,
        },
      ],
      { initialEntries: ['/'] },
    )

    render(
      <AuthProvider initialState={autenticado}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    setViewport(1280)
    await user.click(screen.getByRole('link', { name: /ir para partida/i }))

    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
  })
})
