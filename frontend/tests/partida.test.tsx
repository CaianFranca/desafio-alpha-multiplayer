import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Link, Outlet } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import type { EstadoDaTela } from '../web/src/components/partida/partidaTelaMachine'

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
  const autenticado = mockAuthenticatedState

  it('autenticado ve moldura e canvas ao acessar /partida diretamente', () => {
    renderWithRouter(['/partida'], autenticado)

    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
    expect(screen.getByTestId('ambiente-canvas-fallback')).toBeInTheDocument()
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
    expect(screen.queryByTestId('ambiente-canvas-fallback')).not.toBeInTheDocument()
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

function renderPartidaComEstado(
  estadoInicial: EstadoDaTela,
  initialEntries: string[] = ['/partida'],
  authState: AuthState = mockAuthenticatedState,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/partida',
        element: <PartidaPage estadoInicial={estadoInicial} />,
      },
    ],
    { initialEntries },
  )
  return render(
    <AuthProvider initialState={authState}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('partida estados da tela', () => {
  const autenticado = mockAuthenticatedState

  it('sem alvo (URL sem serverId/partidaId) mostra tela de falha', () => {
    renderWithRouter(['/partida'], autenticado)
    const overlay = screen.getByTestId('overlay-falha')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
    expect(screen.getByText('Falha ao carregar')).toBeInTheDocument()
  })

  it('estado inicial carregando mostra overlay-carregando', () => {
    renderPartidaComEstado('carregando', ['/partida?serverId=s&partidaId=p'], autenticado)
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
  })

  it('estado aguardando mostra overlay-aguardando com Partida preparada', () => {
    renderPartidaComEstado('aguardando', ['/partida?serverId=s&partidaId=p'], autenticado)
    const overlay = screen.getByTestId('overlay-aguardando')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'status')
    expect(screen.getByText('Aguardando partida')).toBeInTheDocument()
    expect(screen.getByText('Partida preparada')).toBeInTheDocument()
  })

  it('disponivel não mostra overlay (canvas livre)', () => {
    renderPartidaComEstado('disponivel', ['/partida?serverId=s&partidaId=p'], autenticado)
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-aguardando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
  })

  it('falha mostra overlay-falha com botão Tentar novamente', () => {
    renderPartidaComEstado('falha', ['/partida?serverId=s&partidaId=p'], autenticado)
    const overlay = screen.getByTestId('overlay-falha')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Falha ao carregar')).toBeInTheDocument()
    expect(screen.getByTestId('partida-tentar-novamente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument()
  })

  it('overlays sobre canvas com z-10 e moldura com z-20', () => {
    renderWithRouter(['/partida'], autenticado)
    expect(screen.getByTestId('overlay-falha')).toHaveClass('z-10')
    expect(screen.getByTestId('partida-moldura')).toHaveClass('z-20')
    expect(screen.getByTestId('ambiente-de-jogo')).toHaveClass('absolute')
  })

  it('falha sem alvo e clique em Tentar novamente permanece em falha', async () => {
    const user = userEvent.setup()
    renderPartidaComEstado('falha')
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
    await user.click(screen.getByTestId('partida-tentar-novamente'))
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })
})

describe('partida tabuleiro e reserva (issue #156)', () => {
  const autenticado = mockAuthenticatedState

  it('disponivel sem snapshot mostra grade 7x7 vazia e reserva com 22 peças', () => {
    renderPartidaComEstado('disponivel', ['/partida?serverId=s&partidaId=p'], autenticado)
    const celulas = screen.getAllByTestId('tabuleiro-celula')
    expect(celulas).toHaveLength(49)
    const ocupadas = celulas.filter((el) => el.getAttribute('data-ocupada') === 'true')
    const vazias = celulas.filter((el) => el.getAttribute('data-ocupada') === 'false')
    expect(ocupadas).toHaveLength(0)
    expect(vazias).toHaveLength(49)
    expect(screen.queryAllByTestId('peca-posicionada')).toHaveLength(0)
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.getByTestId('reserva')).toBeInTheDocument()
    const pecas = screen.getAllByTestId('reserva-peca')
    expect(pecas).toHaveLength(22)
  })

  it('carregando/aguardando/falha não exibem tabuleiro nem reserva', () => {
    renderPartidaComEstado('carregando', ['/partida?serverId=s&partidaId=p'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reserva')).not.toBeInTheDocument()
  })

  it('aguardando não exibe tabuleiro', () => {
    renderPartidaComEstado('aguardando', ['/partida?serverId=s&partidaId=p'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
  })

  it('falha não exibe tabuleiro', () => {
    renderPartidaComEstado('falha', ['/partida?serverId=s&partidaId=p'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
  })
})
