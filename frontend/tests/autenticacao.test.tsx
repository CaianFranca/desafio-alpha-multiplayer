import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { apiFetch } from '../web/src/api/client'

afterEach(() => vi.unstubAllGlobals())

const jogador = {
  id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
  apelido: 'Ana',
  email: 'ana@exemplo.com',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface MockRoute {
  url: string
  method?: string
  response: () => Response | Promise<Response>
}

function mockApi(routes: MockRoute[]) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push(`${method} ${url}`)
      const route = routes.find((r) => url.includes(r.url) && (r.method ?? 'GET').toUpperCase() === method)
      return route ? route.response() : new Response(null, { status: 404 })
    }),
  )
  return calls
}

function renderApp(initialEntries: string[] = ['/']) {
  const router = createMemoryRouter(routes, { initialEntries })
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('reidratação da sessão', () => {
  it('reidrata o Jogador via /api/auth/me e exibe o apelido no cabeçalho', async () => {
    mockApi([{ url: '/api/auth/me', response: () => jsonResponse(jogador) }])
    renderApp()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByRole('link', { name: /criar \/ entrar na sala/i })).toHaveAttribute('href', '/salas/criar')
  })

  it('sessão expirada (401 no /me) mantém o estado de Visitante', async () => {
    mockApi([
      { url: '/api/auth/me', response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401) },
      // Refresh também expirado: sem renovação, cai direto a Visitante.
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    renderApp()

    expect(await screen.findAllByRole('link', { name: /criar conta/i })).not.toHaveLength(0)
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  })

  it('corpo malformado no /me resolve para Visitante em vez de travar carregando', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('não é json', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )
    renderApp(['/salas/criar'])

    expect(await screen.findByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/entre para acessar esta funcionalidade/i)
  })
})

describe('rotas protegidas', () => {
  it('redireciona visitante para /login com mensagem orientativa', async () => {
    mockApi([
      { url: '/api/auth/me', response: () => jsonResponse({}, 401) },
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    renderApp(['/salas/criar'])

    expect(await screen.findByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/entre para acessar esta funcionalidade/i)
    expect(screen.queryByRole('heading', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  it('não redireciona enquanto a sessão está sendo reidratada', async () => {
    let resolveMe!: (response: Response) => void
    const pendingMe = new Promise<Response>((resolve) => {
      resolveMe = resolve
    })
    mockApi([{ url: '/api/auth/me', response: () => pendingMe }])
    renderApp(['/salas/criar'])

    expect(screen.queryByRole('heading', { name: /^entrar$/i })).not.toBeInTheDocument()

    resolveMe(jsonResponse(jogador))
    expect(await screen.findByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
  })
})

describe('sessão expirada durante o uso', () => {
  it('401 em chamada de API devolve o Jogador ao estado de Visitante', async () => {
    mockApi([
      { url: '/api/auth/me', response: () => jsonResponse(jogador) },
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      // Refresh expirado: o 401 confirma a morte da Sessão → Visitante.
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    renderApp()

    expect(await screen.findByText('Ana')).toBeInTheDocument()

    await apiFetch('/api/salas')

    expect(await screen.findAllByRole('link', { name: /criar conta/i })).not.toHaveLength(0)
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  })
})

describe('logout', () => {
  it('Sair encerra a sessão e volta à página principal como Visitante', async () => {
    const calls = mockApi([
      { url: '/api/auth/me', response: () => jsonResponse(jogador) },
      { url: '/api/auth/logout', method: 'POST', response: () => new Response(null, { status: 204 }) },
    ])
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: /sair/i }))

    expect(calls).toContain('POST /api/auth/logout')
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /criar conta/i })).not.toHaveLength(0)
  })
})
