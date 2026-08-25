import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'

const jogador = {
  id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
  apelido: 'Ana',
  email: 'ana@exemplo.com',
}

function respostaJson(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface RotaSimulada {
  url: string
  metodo?: string
  resposta: () => Response | Promise<Response>
}

function simularApi(rotas: RotaSimulada[]) {
  const chamadas: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const metodo = (init?.method ?? 'GET').toUpperCase()
      chamadas.push(`${metodo} ${url}`)
      const rota = rotas.find((r) => url.includes(r.url) && (r.metodo ?? 'GET').toUpperCase() === metodo)
      return rota ? rota.resposta() : new Response(null, { status: 404 })
    }),
  )
  return chamadas
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
  afterEach(() => vi.unstubAllGlobals())

  it('reidrata o Jogador via /api/auth/me e exibe o apelido no cabeçalho', async () => {
    simularApi([{ url: '/api/auth/me', resposta: () => respostaJson(jogador) }])
    renderApp()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByRole('link', { name: /criar sala/i })).toHaveAttribute('href', '/salas/criar')
  })

  it('sessão expirada (401 no /me) mantém o estado de Visitante', async () => {
    simularApi([
      { url: '/api/auth/me', resposta: () => respostaJson({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401) },
    ])
    renderApp()

    expect(await screen.findAllByRole('link', { name: /criar conta/i })).not.toHaveLength(0)
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  })
})

describe('rotas protegidas', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('redireciona visitante para /login com mensagem orientativa', async () => {
    simularApi([{ url: '/api/auth/me', resposta: () => respostaJson({}, 401) }])
    renderApp(['/salas/criar'])

    expect(await screen.findByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/entre para acessar esta funcionalidade/i)
    expect(screen.queryByRole('heading', { name: /criar sala/i })).not.toBeInTheDocument()
  })

  it('não redireciona enquanto a sessão está sendo reidratada', async () => {
    let resolver!: (resposta: Response) => void
    const mePendente = new Promise<Response>((resolve) => {
      resolver = resolve
    })
    simularApi([{ url: '/api/auth/me', resposta: () => mePendente }])
    renderApp(['/salas/criar'])

    expect(screen.queryByRole('heading', { name: /^entrar$/i })).not.toBeInTheDocument()

    resolver(respostaJson(jogador))
    expect(await screen.findByRole('heading', { name: /criar sala/i })).toBeInTheDocument()
  })
})

describe('logout', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Sair encerra a sessão e volta à página principal como Visitante', async () => {
    const chamadas = simularApi([
      { url: '/api/auth/me', resposta: () => respostaJson(jogador) },
      { url: '/api/auth/logout', metodo: 'POST', resposta: () => new Response(null, { status: 204 }) },
    ])
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: /sair/i }))

    expect(chamadas).toContain('POST /api/auth/logout')
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /criar conta/i })).not.toHaveLength(0)
  })
})
