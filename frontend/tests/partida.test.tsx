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

  it('aguardando via query param mostra overlay-aguardando com Partida preparada', () => {
    renderWithRouter(['/partida?partidaEstado=aguardando'], autenticado)
    const overlay = screen.getByTestId('overlay-aguardando')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveAttribute('role', 'status')
    expect(screen.getByText('Aguardando partida')).toBeInTheDocument()
    expect(screen.getByText('Partida preparada')).toBeInTheDocument()
  })

  it('disponivel via query param não mostra overlay (canvas livre)', () => {
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-aguardando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
    expect(screen.getByTestId('ambiente-de-jogo')).toBeInTheDocument()
    expect(screen.getByTestId('partida-moldura')).toBeInTheDocument()
  })

  it('falha via query param mostra overlay-falha com botão Tentar novamente', () => {
    renderWithRouter(['/partida?partidaEstado=falha'], autenticado)
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
    // Sem alvo, não transita para carregando (evita loop infinito de loader).
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
  })

  it('query param inválido é ignorado e sem alvo mostra falha', () => {
    renderWithRouter(['/partida?partidaEstado=invalido'], autenticado)
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()
  })

  it('carregando via query param força estado mesmo partindo de outro inicial', () => {
    renderWithRouter(['/partida?partidaEstado=carregando'], autenticado)
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
  })
})

describe('partida dev toolbar', () => {
  const autenticado = mockAuthenticatedState

  it('toolbar DEV renderiza 4 botões quando em DEV', () => {
    renderWithRouter(['/partida'], autenticado)
    // em ambiente de teste import.meta.env.DEV === true (não produção)
    expect(screen.getByTestId('partida-dev-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('dev-forcar-carregando')).toBeInTheDocument()
    expect(screen.getByTestId('dev-forcar-aguardando')).toBeInTheDocument()
    expect(screen.getByTestId('dev-forcar-disponivel')).toBeInTheDocument()
    expect(screen.getByTestId('dev-forcar-falha')).toBeInTheDocument()
  })

  it('cada botão da toolbar força o estado correspondente', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/partida'], autenticado)

    await user.click(screen.getByTestId('dev-forcar-aguardando'))
    expect(screen.getByTestId('overlay-aguardando')).toBeInTheDocument()

    await user.click(screen.getByTestId('dev-forcar-falha'))
    expect(screen.getByTestId('overlay-falha')).toBeInTheDocument()

    await user.click(screen.getByTestId('dev-forcar-disponivel'))
    expect(screen.queryByTestId('overlay-falha')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-carregando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('overlay-aguardando')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('dev-forcar-carregando'))
    expect(screen.getByTestId('overlay-carregando')).toBeInTheDocument()
  })

  it('toolbar fica acima da moldura com z-30', () => {
    renderWithRouter(['/partida'], autenticado)
    expect(screen.getByTestId('partida-dev-toolbar')).toHaveClass('z-30')
  })
})

describe('partida tabuleiro e reserva (issue #83)', () => {
  const autenticado = mockAuthenticatedState

  it('disponivel mostra grade 7x7 (49 células) com distinção vazia/ocupada e caminho basico de 5 pecas encaixadas', () => {
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)
    const celulas = screen.getAllByTestId('tabuleiro-celula')
    expect(celulas).toHaveLength(49)
    const ocupadas = celulas.filter((el) => el.getAttribute('data-ocupada') === 'true')
    const vazias = celulas.filter((el) => el.getAttribute('data-ocupada') === 'false')
    expect(ocupadas).toHaveLength(5)
    expect(vazias).toHaveLength(44)
    expect(screen.getAllByTestId('peca-posicionada')).toHaveLength(5)
    const centroOcupada = celulas.find(
      (el) => el.getAttribute('data-linha') === '3' && el.getAttribute('data-coluna') === '3' && el.getAttribute('data-ocupada') === 'true',
    )
    expect(centroOcupada).toBeInTheDocument()
  })

  it('disponivel mostra reserva lateral com 22 placeholders (4 iniciais + 6 de cada caminho)', () => {
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)
    expect(screen.getByTestId('tabuleiro')).toBeInTheDocument()
    expect(screen.getByTestId('reserva')).toBeInTheDocument()
    const pecas = screen.getAllByTestId('reserva-peca')
    expect(pecas).toHaveLength(22)
    expect(pecas.filter((el) => el.getAttribute('data-tipo') === 'inicial')).toHaveLength(4)
    expect(pecas.filter((el) => el.getAttribute('data-tipo') === 'reta')).toHaveLength(6)
    expect(pecas.filter((el) => el.getAttribute('data-tipo') === 'T')).toHaveLength(6)
    expect(pecas.filter((el) => el.getAttribute('data-tipo') === 'cruz')).toHaveLength(6)
  })

  it('carregando/aguardando/falha não exibem tabuleiro nem reserva', () => {
    renderWithRouter(['/partida?partidaEstado=carregando'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reserva')).not.toBeInTheDocument()
    // também para aguardando e falha via re-render com toolbar
  })

  it('aguardando não exibe tabuleiro', () => {
    renderWithRouter(['/partida?partidaEstado=aguardando'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
  })

  it('falha não exibe tabuleiro', () => {
    renderWithRouter(['/partida?partidaEstado=falha'], autenticado)
    expect(screen.queryByTestId('tabuleiro')).not.toBeInTheDocument()
  })
})

function peaoPorId(id: string): HTMLElement {
  return screen.getAllByTestId('peao').find((el) => el.getAttribute('data-peao-id') === id)!
}

function pecaPorId(id: string): HTMLElement {
  return screen
    .getAllByTestId('peca-posicionada')
    .find((el) => el.getAttribute('data-peca-id') === id)!
}

describe('partida peões e conexões (issue #90)', () => {
  const autenticado = mockAuthenticatedState

  it('disponivel mostra 4 peões de cores distintas, exatamente 1 posicionado', () => {
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)
    const peoes = screen.getAllByTestId('peao')
    expect(peoes).toHaveLength(4)
    expect(new Set(peoes.map((el) => el.getAttribute('data-cor'))).size).toBe(4)
    expect(peoes.filter((el) => el.getAttribute('data-posicionado') === 'true')).toHaveLength(1)
    expect(peoes.filter((el) => el.getAttribute('data-posicionado') === 'false')).toHaveLength(3)
    // nenhum selecionado por padrão
    expect(peoes.every((el) => el.getAttribute('data-selecionado') === 'false')).toBe(true)
  })

  it('sem seleção de peão posicionado, peças não expõem conexão', () => {
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)
    for (const el of screen.getAllByTestId('peca-posicionada')) {
      expect(el).not.toHaveAttribute('data-conectada')
      expect(el).not.toHaveAttribute('data-selecionada')
    }
  })

  it('clicar peão posicionado seleciona e destaca a vizinha conectada no espelho', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)

    await user.click(peaoPorId('peao-1-branco'))

    expect(peaoPorId('peao-1-branco')).toHaveAttribute('data-selecionado', 'true')
    // (3,4) reta@90 tem oeste aberto voltado à inicial → conectada/destino
    expect(pecaPorId('posicionada-reta-2')).toHaveAttribute('data-conectada', 'true')
    // demais posicionadas não conectadas: presentes e falsas
    expect(pecaPorId('posicionada-cruz-3')).toHaveAttribute('data-conectada', 'false')
    expect(pecaPorId('posicionada-reta-4')).toHaveAttribute('data-conectada', 'false')
    expect(pecaPorId('posicionada-t-5')).toHaveAttribute('data-conectada', 'false')
    // a peça sob o peão selecionado marca data-selecionada
    expect(pecaPorId('posicionada-inicial-1')).toHaveAttribute('data-selecionada', 'true')
    expect(pecaPorId('posicionada-reta-2')).toHaveAttribute('data-selecionada', 'false')
  })

  it('clicar outro peão troca a seleção; peão sobre a Mesa não produz conexões', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)

    await user.click(peaoPorId('peao-1-branco'))
    await user.click(peaoPorId('peao-2-vermelho'))

    expect(peaoPorId('peao-1-branco')).toHaveAttribute('data-selecionado', 'false')
    expect(peaoPorId('peao-2-vermelho')).toHaveAttribute('data-selecionado', 'true')
    // seleção não posicionada: attributes de conexão somem (peões na Mesa)
    for (const el of screen.getAllByTestId('peca-posicionada')) {
      expect(el).not.toHaveAttribute('data-conectada')
      expect(el).not.toHaveAttribute('data-selecionada')
    }
  })

  it('clicar fora (célula vazia do espelho) desseleciona o peão', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/partida?partidaEstado=disponivel'], autenticado)

    await user.click(peaoPorId('peao-1-branco'))
    expect(peaoPorId('peao-1-branco')).toHaveAttribute('data-selecionado', 'true')

    const celulaVazia = screen
      .getAllByTestId('tabuleiro-celula')
      .find((el) => el.getAttribute('data-ocupada') === 'false')!
    await user.click(celulaVazia)

    expect(peaoPorId('peao-1-branco')).toHaveAttribute('data-selecionado', 'false')
    for (const el of screen.getAllByTestId('peca-posicionada')) {
      expect(el).not.toHaveAttribute('data-conectada')
    }
  })
})
