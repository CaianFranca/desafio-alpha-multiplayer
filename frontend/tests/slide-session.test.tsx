import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'
import {
  __redefinirRefreshEmVooParaTestes,
  apiFetch,
  onSessionExpired,
} from '../web/src/api/client'
import { refreshSession } from '../web/src/api/auth'

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

function contarChamadas(calls: string[], method: string, url: string) {
  return calls.filter((c) => c === `${method} ${url}`).length
}

beforeEach(() => {
  __redefinirRefreshEmVooParaTestes()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __redefinirRefreshEmVooParaTestes()
})

describe('slide-session no apiFetch (issue #376)', () => {
  it('401 com refresh válido repete a requisição e não notifica expiração', async () => {
    let salas = 0
    const calls = mockApi([
      {
        url: '/api/salas',
        response: () => {
          salas += 1
          return jsonResponse(salas === 1 ? {} : [{ id: 'sala-1' }], salas === 1 ? 401 : 200)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(200)
      expect(expirada).not.toHaveBeenCalled()
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      expect(contarChamadas(calls, 'GET', '/api/salas')).toBe(2)
    } finally {
      desinscrever()
    }
  })

  it('401 com refresh inválido devolve o 401 original e notifica uma vez', async () => {
    const calls = mockApi([
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).toHaveBeenCalledTimes(1)
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      expect(contarChamadas(calls, 'GET', '/api/salas')).toBe(1)
    } finally {
      desinscrever()
    }
  })

  it('401s concorrentes compartilham um único POST /refresh', async () => {
    let salas = 0
    const calls = mockApi([
      {
        url: '/api/salas',
        response: () => {
          salas += 1
          return jsonResponse({}, salas <= 2 ? 401 : 200)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const [primeira, segunda] = await Promise.all([apiFetch('/api/salas'), apiFetch('/api/salas')])
      expect(primeira.status).toBe(200)
      expect(segunda.status).toBe(200)
      expect(expirada).not.toHaveBeenCalled()
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
    } finally {
      desinscrever()
    }
  })

  it('login, register e refresh nunca disparam renovação', async () => {
    const calls = mockApi([
      { url: '/api/auth/login', method: 'POST', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/register', method: 'POST', response: () => jsonResponse({}, 401) },
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      await apiFetch('/api/auth/login', { method: 'POST' })
      await apiFetch('/api/auth/register', { method: 'POST' })
      // Chamada direta ao refresh com 401: sem retry, sem loop.
      await apiFetch('/api/auth/refresh', { method: 'POST' })
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      expect(expirada).toHaveBeenCalledTimes(3)
    } finally {
      desinscrever()
    }
  })

  it('falha de rede no refresh mantém o 401 original e notifica', async () => {
    const calls = mockApi([{ url: '/api/salas', response: () => jsonResponse({}, 401) }])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.includes('/api/auth/refresh')) throw new TypeError('rede fora')
        return jsonResponse({}, 401)
      }),
    )
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).toHaveBeenCalledTimes(1)
    } finally {
      desinscrever()
    }
  })
})

describe('refreshSession (issue #376)', () => {
  it('retorna true quando o servidor renova', async () => {
    mockApi([{ url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) }])
    await expect(refreshSession()).resolves.toBe(true)
  })

  it('retorna false quando o refresh expira (401)', async () => {
    mockApi([
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401),
      },
    ])
    await expect(refreshSession()).resolves.toBe(false)
  })

  it('retorna false em falha de rede sem jogar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('rede fora')
      }),
    )
    await expect(refreshSession()).resolves.toBe(false)
  })
})

describe('reidratação com access expirado e refresh válido (issue #376)', () => {
  it('GET /me 401 seguido de refresh válido mantém o Jogador autenticado', async () => {
    let me = 0
    mockApi([
      {
        url: '/api/auth/me',
        response: () => {
          me += 1
          return me === 1
            ? jsonResponse({ erros: [{ mensagem: 'Sessão inválida ou expirada.' }] }, 401)
            : jsonResponse(jogador)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^entrar$/i })).not.toBeInTheDocument()
  })
})
