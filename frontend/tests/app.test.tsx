import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { MockWebSocket } from './helpers/mockWebSocket'

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
    expect(screen.getByRole('heading', { name: /trailers/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /a história/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /características do jogo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /para escapar, você precisa/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pronto para enfrentar o sanatório/i })).toBeInTheDocument()
  })

  it('renders the header with navigation and CTAs', () => {
    renderWithRouter()

    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /flicker of sanity/i })).toHaveAttribute('href', '/')

    const nav = screen.getByRole('navigation', { name: /navegação principal/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trailers' })).toHaveAttribute('href', '/#trailers')
    expect(screen.getByRole('link', { name: /história/i })).toHaveAttribute('href', '/#historia')
    expect(screen.getByRole('link', { name: /características/i })).toHaveAttribute('href', '/#caracteristicas')
    expect(screen.getByRole('link', { name: /objetivos/i })).toHaveAttribute('href', '/#objetivos')
  })

  it('header nav outside home redirects to home and targets the section', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    renderWithRouter(['/login'])

    await user.click(screen.getByRole('link', { name: /história/i }))

    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(document.getElementById('historia')).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
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

    expect(screen.getByRole('heading', { name: /restaurar a energia/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /obter o acesso/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sobreviver à fuga/i })).toBeInTheDocument()
  })

  it('renders footer with brand and copyright', () => {
    renderWithRouter()

    const footer = screen.getByRole('contentinfo')
    expect(footer).toBeInTheDocument()
    expect(within(footer).getAllByText(/flicker of sanity/i).length).toBeGreaterThanOrEqual(1)
    expect(within(footer).getByText(/todos os direitos reservados/i)).toBeInTheDocument()
  })
})

describe('auth pages', () => {
  it('renders cadastro page with card styling and CTA', () => {
    renderWithRouter(['/cadastro'])

    expect(screen.getByRole('heading', { name: /crie seu cadastro/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar-se/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /entre/i })).toHaveAttribute('href', '/login')
  })

  it('renders login page with Entrar CTA', () => {
    renderWithRouter(['/login'])

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /crie seu cadastro/i })).toHaveAttribute('href', '/cadastro')
  })

  it('cadastro footer link navigates to login', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.click(screen.getByRole('link', { name: /entre/i }))

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
  })
})

describe('hero CTAs', () => {
  it('hero signup link navigates to cadastro', async () => {
    const user = userEvent.setup()
    renderWithRouter()

    const heroSection = document.getElementById('hero')!
    const heroSignup = within(heroSection).getByRole('link', { name: /criar conta/i })
    await user.click(heroSignup)

    expect(screen.getByRole('heading', { name: /crie seu cadastro/i })).toBeInTheDocument()
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
    expect(within(header).queryByRole('link', { name: /criar\/entrar sala/i })).not.toBeInTheDocument()

    const heroSection = document.getElementById('hero')!
    expect(within(heroSection).getByRole('link', { name: /criar conta/i })).toBeInTheDocument()
    expect(within(heroSection).getByRole('link', { name: /^entrar$/i })).toBeInTheDocument()
  })

  it('authenticated header shows nickname and Criar Sala link', () => {
    renderWithRouter(['/'], autenticado)

    const header = screen.getByRole('banner')
    expect(within(header).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: /criar\/entrar sala/i })).toHaveAttribute('href', '/salas/criar')

    const heroSection = document.getElementById('hero')!
    expect(within(heroSection).getByRole('link', { name: /criar\/entrar sala/i })).toBeInTheDocument()
    expect(within(heroSection).queryByRole('link', { name: /criar conta/i })).not.toBeInTheDocument()
  })

  it('header trunca apelido longo mantendo navegação e controles', () => {
    const apelidoLongo = 'UmApelidoExtremamenteLongoParaTesteDeAlinhamentoDoHeader'
    renderWithRouter(['/'], {
      status: 'authenticated',
      jogador: {
        id: '7c9e4f2a-1b3d-4e5f-8a6b-0c1d2e3f4a5b',
        apelido: apelidoLongo,
        email: 'apelido.longo@exemplo.com',
      },
    })

    const header = screen.getByRole('banner')
    // Só o apelido trunca com reticências; navegação e controles permanecem.
    expect(within(header).getByText(apelidoLongo)).toHaveClass('truncate')
    expect(within(header).getByRole('link', { name: 'Trailers' })).toHaveAttribute('href', '/#trailers')
    expect(within(header).getByRole('link', { name: /criar\/entrar sala/i })).toHaveAttribute('href', '/salas/criar')
    expect(within(header).getByRole('button', { name: /^sair$/i })).toBeInTheDocument()
  })

  it('final call to action mirrors the current auth state', () => {
    const { unmount } = renderWithRouter(['/'], visitante)

    const finalCtaRegion = screen.getByRole('region', { name: /pronto para enfrentar o sanatório/i })
    expect(within(finalCtaRegion).getByRole('link', { name: /criar conta/i })).toBeInTheDocument()
    expect(within(finalCtaRegion).queryByRole('link', { name: /criar\/entrar sala/i })).not.toBeInTheDocument()
    unmount()

    renderWithRouter(['/'], autenticado)
    const authenticatedFinalCta = screen.getByRole('region', { name: /pronto para enfrentar o sanatório/i })
    expect(within(authenticatedFinalCta).getByRole('link', { name: /criar\/entrar sala/i })).toBeInTheDocument()
    expect(within(authenticatedFinalCta).queryByRole('link', { name: /criar conta/i })).not.toBeInTheDocument()
  })

  it('redirects visitor trying to open create room page to login', () => {
    renderWithRouter(['/salas/criar'], visitante)

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  it('lets authenticated player open the create room page', () => {
    renderWithRouter(['/salas/criar'], autenticado)

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
    // Stub substituído por lobby real (issue #32): verifica layout bipartido
    expect(screen.getByText(/ponto de encontro/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar sala/i })).toBeInTheDocument()
  })

  it('no lobby, o header oferece Voltar para o início (sem SAIR_DA_SALA) e Sair (logout)', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], autenticado)

    const header = screen.getByRole('banner')
    // "Voltar para o início" apenas navega para a home (não sai da sala), e "Sair" é o logout.
    expect(within(header).getByRole('button', { name: /voltar para o início/i })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /^sair$/i })).toBeInTheDocument()

    // Voltar para o início: navega sem enviar SAIR_DA_SALA.
    const ws = MockWebSocket.last()
    await user.click(within(header).getByRole('button', { name: /voltar para o início/i }))

    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    const headerHome = screen.getByRole('banner')
    expect(within(headerHome).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(headerHome).getByRole('link', { name: /criar\/entrar sala/i })).toHaveAttribute('href', '/salas/criar')
    expect(within(headerHome).queryByRole('button', { name: /voltar para o início/i })).not.toBeInTheDocument()
    // Nenhum SAIR_DA_SALA foi enviado ao voltar (apenas navegação).
    const enviouSair = ws?.sentMessages.some((m) => {
      try {
        return JSON.parse(m as string).type === 'SAIR_DA_SALA'
      } catch {
        return false
      }
    })
    expect(enviouSair).toBe(false)

    // Sair encerra a Sessão: volta como Visitante à home.
    await user.click(within(headerHome).getByRole('button', { name: /^sair$/i }))

    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).queryByText(apelidoMock)).not.toBeInTheDocument()
  })

  it('authenticated header Criar/Entrar Sala action navigates to the create room page', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/'], autenticado)

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: /criar\/entrar sala/i }))

    expect(screen.getByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
  })
})

describe('header variations (issue #211)', () => {
  const visitante: AuthState = { status: 'visitor' }
  const autenticado = mockAuthenticatedState
  const apelidoMock = mockAuthenticatedState.jogador.apelido

  function criarSalaParaHeader(codigoDeSala = 'H211AA') {
    const membro = {
      id: 'membro-1',
      jogadorId: mockAuthenticatedState.jogador.id,
      apelido: apelidoMock,
      ordemDeEntrada: 0,
      presenca: 'conectado' as const,
      prontidao: false,
    }
    return {
      id: 'sala-1',
      codigoDeSala,
      estado: 'aberta' as const,
      anfitriaoId: membro.id,
      membros: [membro],
      convite: { codigoDeSala, link: `http://localhost/sala/${codigoDeSala}` },
    }
  }

  function iconePortaDoSair(header: HTMLElement) {
    const botaoSair = within(header).getByRole('button', { name: /^sair$/i })
    const icone = botaoSair.querySelector('img.site-header__logout-icon')
    expect(icone).not.toBeNull()
    expect(icone?.getAttribute('alt')).toBe('')
    expect(icone?.getAttribute('aria-hidden')).toBe('true')
    expect(icone?.getAttribute('src')).toContain('door_open_icon.svg')
  }

  it('variação 1 — Visitante na Home: âncoras + Entrar + Criar conta, sem Apelido', () => {
    MockWebSocket.clean()
    renderWithRouter(['/'], visitante)

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('site-header')
    expect(within(header).getByRole('link', { name: /flicker of sanity/i })).toHaveAttribute('href', '/')

    const nav = within(header).getByRole('navigation', { name: /navegação principal/i })
    expect(nav).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /história/i })).toHaveAttribute('href', '/#historia')
    expect(within(nav).getByRole('link', { name: 'Trailers' })).toHaveAttribute('href', '/#trailers')

    expect(within(header).getByRole('link', { name: /^entrar$/i })).toHaveAttribute('href', '/login')
    expect(within(header).getByRole('link', { name: /criar conta/i })).toHaveAttribute('href', '/cadastro')

    expect(within(header).queryByText(apelidoMock)).not.toBeInTheDocument()
    expect(header.querySelector('img.site-header__logout-icon')).toBeNull()
    expect(within(header).queryByRole('button', { name: /^sair$/i })).not.toBeInTheDocument()
  })

  it('variação 2 — Jogador na Home sem sala: âncoras + Apelido + Criar/Entrar Sala + Sair com ícone', () => {
    MockWebSocket.clean()
    renderWithRouter(['/'], autenticado)

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument()
    expect(within(header).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: /criar\/entrar sala/i })).toHaveAttribute('href', '/salas/criar')
    expect(within(header).queryByRole('button', { name: /voltar para o início/i })).not.toBeInTheDocument()
    iconePortaDoSair(header)
  })

  it('variação 3 — Logado em Criação (/salas/criar, sem sala): sem âncoras + Voltar + Sair sem SAIR_DA_SALA', async () => {
    MockWebSocket.clean()
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], autenticado)

    const header = screen.getByRole('banner')
    expect(within(header).queryByRole('navigation', { name: /navegação principal/i })).not.toBeInTheDocument()
    expect(within(header).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /voltar para o início/i })).toBeInTheDocument()
    iconePortaDoSair(header)
    expect(within(header).queryByRole('link', { name: /criar\/entrar sala/i })).not.toBeInTheDocument()
    expect(within(header).queryByRole('link', { name: /retornar para sala/i })).not.toBeInTheDocument()

    const ws = MockWebSocket.last()
    await user.click(within(header).getByRole('button', { name: /voltar para o início/i }))

    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    const enviouSair = ws?.sentMessages.some((m) => {
      try {
        return JSON.parse(m as string).type === 'SAIR_DA_SALA'
      } catch {
        return false
      }
    })
    expect(enviouSair).toBe(false)
  })

  it('variação 4 — Logado em Sala (sala !== null): sem âncoras + Apelido + Retornar + Sair com ícone', async () => {
    MockWebSocket.clean()
    const user = userEvent.setup()
    renderWithRouter(['/salas/criar'], autenticado)

    const ws = MockWebSocket.last()!
    ws.simulateMessage({ type: 'SALA_ATUALIZADA', sala: criarSalaParaHeader() })
    await screen.findByText('H211AA')

    // Volta à Home mantendo a sala: header passa a oferecer Retornar para Sala.
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /voltar para o início/i }))
    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()

    const headerHome = screen.getByRole('banner')
    expect(within(headerHome).queryByRole('navigation', { name: /navegação principal/i })).not.toBeInTheDocument()
    expect(within(headerHome).getByText(apelidoMock)).toBeInTheDocument()
    expect(within(headerHome).getByRole('link', { name: /retornar para sala/i })).toHaveAttribute('href', '/salas/criar')
    expect(within(headerHome).queryByRole('button', { name: /voltar para o início/i })).not.toBeInTheDocument()
    iconePortaDoSair(headerHome)

    const enviouSair = ws.sentMessages.some((m) => {
      try {
        return JSON.parse(m as string).type === 'SAIR_DA_SALA'
      } catch {
        return false
      }
    })
    expect(enviouSair).toBe(false)
    await waitFor(() => expect(headerHome).toHaveClass('site-header'))
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
    expect(screen.getByRole('heading', { name: /trailers/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /a história/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /características do jogo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /para escapar, você precisa/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pronto para enfrentar o sanatório/i })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('skip-link is present for keyboard navigation', () => {
    renderWithRouter()

    const skipLink = screen.getByText(/pular para o conteúdo/i)
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })
})
