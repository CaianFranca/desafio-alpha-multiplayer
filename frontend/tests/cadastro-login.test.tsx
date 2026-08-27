import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider, type AuthState } from '../web/src/state/AuthProvider'
import { visitorState } from '../web/src/state/auth-context'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderWithRouter(initialEntries: string[] = ['/'], authState: AuthState = visitorState) {
  const router = createMemoryRouter(routes, { initialEntries })
  return {
    router,
    ...render(
      <AuthProvider initialState={authState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  }
}

const jogadorCadastro = {
  id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
  apelido: 'NovoJogador',
  email: 'novo@exemplo.com',
}

const jogadorLogin = {
  id: '5f0b6d4e-1c2a-4f3e-9a7b-2c8d1e4f6a90',
  apelido: 'JogadorLogado',
  email: 'logado@exemplo.com',
}

describe('CadastroPage', () => {
  it('renderiza 3 campos e CTA CADASTRAR-SE no estilo do card', async () => {
    renderWithRouter(['/cadastro'])

    expect(screen.getByRole('heading', { name: /crie seu cadastro/i })).toBeInTheDocument()
    expect(screen.getByText(/junte-se ao flicker of sanity/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^apelido$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Escolha um apelido')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('seu@email.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mínimo 8 caracteres')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar-se/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /entre/i })).toHaveAttribute('href', '/login')
  })

  it('validação client-side: Informe o apelido.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('Informe o apelido.')).toBeInTheDocument()
    expect(screen.getByText('Informe o apelido.')).toHaveAttribute('role', 'alert')
  })

  it('validação client-side: O apelido deve ter entre 3 e 20 caracteres.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'ab')
    await user.type(screen.getByLabelText(/^email$/i), 'a@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('O apelido deve ter entre 3 e 20 caracteres.')).toBeInTheDocument()
  })

  it('validação client-side: Informe um email válido. e Informe a senha.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'apeli')
    await user.type(screen.getByLabelText(/^email$/i), 'invalido')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('Informe um email válido.')).toBeInTheDocument()
    expect(screen.getByText('Informe a senha.')).toBeInTheDocument()
  })

  it('validação client-side: Informe o email. quando vazio no cadastro', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'apeli')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('Informe o email.')).toBeInTheDocument()
  })

  it('validação client-side: A senha deve ter no mínimo 8 caracteres.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'apeli')
    await user.type(screen.getByLabelText(/^email$/i), 'a@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'curta')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('A senha deve ter no mínimo 8 caracteres.')).toBeInTheDocument()
  })

  it('erro 409 Apelido já está em uso. vindo do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/auth/register') && (init?.method ?? 'GET') === 'POST') {
          return jsonResponse({ erros: [{ campo: 'apelido', mensagem: 'Apelido já está em uso.' }] }, 409)
        }
        return new Response(null, { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'jaexiste')
    await user.type(screen.getByLabelText(/^email$/i), 'novo@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('Apelido já está em uso.')).toBeInTheDocument()
    expect(screen.getByText('Apelido já está em uso.')).toHaveAttribute('role', 'alert')
  })

  it('erro 409 Email já está em uso. vindo do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/auth/register')) {
          return jsonResponse({ erros: [{ campo: 'email', mensagem: 'Email já está em uso.' }] }, 409)
        }
        return new Response(null, { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'novonick')
    await user.type(screen.getByLabelText(/^email$/i), 'usado@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    expect(await screen.findByText('Email já está em uso.')).toBeInTheDocument()
  })

  it('erro 400 por campo vindo do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ erros: [{ campo: 'apelido', mensagem: 'Informe o apelido.' }] }, 400)),
    )
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'abc')
    await user.type(screen.getByLabelText(/^email$/i), 'a@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    // mesmo passando validação local válida, o servidor pode devolver 400
    expect(await screen.findByText('Informe o apelido.')).toBeInTheDocument()
  })

  it('cadastro sucesso auto-login mostra apelido no header e navega para /', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/auth/register') && (init?.method ?? 'POST')?.toUpperCase() === 'POST') {
          return jsonResponse(jogadorCadastro, 201)
        }
        return new Response(null, { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(['/cadastro'])

    await user.type(screen.getByLabelText(/^apelido$/i), 'NovoJogador')
    await user.type(screen.getByLabelText(/^email$/i), 'novo@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /cadastrar-se/i }))

    // header exibe apelido após auto-login
    expect(await screen.findByText('NovoJogador')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('NovoJogador')).toBeInTheDocument()
    // navegou para home
    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
  })
})

describe('LoginPage', () => {
  it('renderiza email+senha e CTA ENTRAR (não CADASTRAR-SE)', async () => {
    renderWithRouter(['/login'])

    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('seu@email.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Senha')).toBeInTheDocument()
    const entrar = screen.getByRole('button', { name: /^entrar$/i })
    expect(entrar).toBeInTheDocument()
    expect(entrar).toHaveTextContent('ENTRAR')
    expect(screen.getByRole('link', { name: /crie seu cadastro/i })).toHaveAttribute('href', '/cadastro')
  })

  it('validação client-side: Informe o email.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/login'])

    await user.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText('Informe o email.')).toBeInTheDocument()
  })

  it('validação client-side: Informe a senha.', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/login'])

    await user.type(screen.getByLabelText(/^email$/i), 'a@exemplo.com')
    await user.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText('Informe a senha.')).toBeInTheDocument()
  })

  it('erro 401 genérico Credenciais inválidas. sem expor campo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/auth/login')) {
          return jsonResponse({ erros: [{ mensagem: 'Credenciais inválidas.' }] }, 401)
        }
        return new Response(null, { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(['/login'])

    await user.type(screen.getByLabelText(/^email$/i), 'a@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-errada')
    await user.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText('Credenciais inválidas.')).toBeInTheDocument()
    const alerta = screen.getByText('Credenciais inválidas.')
    expect(alerta).toHaveAttribute('role', 'alert')
    // não deve haver erro por campo específico visível além do genérico
    expect(screen.queryByText('Informe o email.')).not.toBeInTheDocument()
  })

  it('login sucesso auto-login mostra apelido no header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/auth/login')) {
          return jsonResponse(jogadorLogin, 200)
        }
        return new Response(null, { status: 404 })
      }),
    )
    const user = userEvent.setup()
    renderWithRouter(['/login'])

    await user.type(screen.getByLabelText(/^email$/i), 'logado@exemplo.com')
    await user.type(screen.getByLabelText(/^senha$/i), 'senha-segura-1')
    await user.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText('JogadorLogado')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
  })

  it('renderiza notice de rota protegida com role=status', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [{ pathname: '/login', state: { reason: 'Entre para acessar esta funcionalidade.' } }],
    })
    render(
      <AuthProvider initialState={visitorState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent(/entre para acessar esta funcionalidade/i)
    expect(screen.getByRole('heading', { name: /^entrar$/i })).toBeInTheDocument()
  })
})
