import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'
import { AuthProvider } from '../web/src/state/AuthProvider'
import { mockAuthenticatedState } from '../web/src/state/mock-auth'
import { PartidaPage } from '../web/src/pages/PartidaPage'
import { MockWebSocket } from './helpers/mockWebSocket'
import {
  __redefinirRefreshEmVooParaTestes,
  apiFetch,
  calcularIntervaloSlide,
  lerResultadoRefresh,
  lerTtlDeAcessoSegundos,
  onSessionExpired,
  TEMPO_LIMITE_REFRESH_MS,
} from '../web/src/api/client'
import { fetchCurrentPlayer, refreshSession } from '../web/src/api/auth'

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
  vi.unstubAllEnvs()
  __redefinirRefreshEmVooParaTestes()
  MockWebSocket.clean()
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

  it('falha de rede no refresh devolve o 401 original sem notificar (transiente)', async () => {
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
      expect(expirada).not.toHaveBeenCalled()
    } finally {
      desinscrever()
    }
  })

  it('refresh com 500 devolve o 401 original sem notificar (transiente)', async () => {
    const calls = mockApi([
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 500) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).not.toHaveBeenCalled()
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      expect(contarChamadas(calls, 'GET', '/api/salas')).toBe(1)
    } finally {
      desinscrever()
    }
  })

  it('rede cai entre refresh e retry: devolve o 401 original sem notificar', async () => {
    let salas = 0
    mockApi([
      {
        url: '/api/salas',
        response: () => {
          salas += 1
          // Primeira chamada: 401 com access expirado. Retry (após refresh
          // válido): a rede cai — o stub rejeita como o fetch real faria.
          if (salas >= 2) throw new TypeError('rede fora')
          return jsonResponse({}, 401)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).not.toHaveBeenCalled()
    } finally {
      desinscrever()
    }
  })

  it('transiente em /salas não contamina o 401 legítimo posterior em /me (review PR #383)', async () => {
    let refreshes = 0
    mockApi([
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      // A sonda crua do caminho `invalida` também bate aqui e recebe 401 —
      // Sessão morta de verdade, sem interferência do transiente anterior.
      { url: '/api/auth/me', response: () => jsonResponse({}, 401) },
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => {
          refreshes += 1
          // Primeira chamada (do /salas): rede/5xx — transiente. Segunda (do
          // /me): refresh rejeitado — Sessão inválida de verdade.
          return refreshes === 1 ? jsonResponse({}, 500) : jsonResponse({}, 401)
        },
      },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const primeira = await apiFetch('/api/salas')
      expect(primeira.status).toBe(401)
      expect(expirada).not.toHaveBeenCalled()
      const resultado = await fetchCurrentPlayer()
      expect(resultado).toEqual({ ok: false, reason: 'invalid-session' })
      expect(expirada).toHaveBeenCalledTimes(1)
    } finally {
      desinscrever()
    }
  })

  it('refresh 401 com Sessão viva (multi-aba) não notifica (review PR #383)', async () => {
    mockApi([
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 401) },
      // Sonda crua GET /me: a outra aba já rotacionou e a Sessão segue viva.
      { url: '/api/auth/me', response: () => jsonResponse(jogador) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).not.toHaveBeenCalled()
      expect(lerResultadoRefresh(response)).toBe('transiente')
    } finally {
      desinscrever()
    }
  })

  it('fetchCurrentPlayer com refresh 401 + /me 200 não invalida (review PR #383)', async () => {
    let me = 0
    mockApi([
      {
        url: '/api/auth/me',
        response: () => {
          me += 1
          // 1ª: 401 do apiFetch original. 2ª: sonda crua — Sessão viva.
          return me === 1 ? jsonResponse({}, 401) : jsonResponse(jogador)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 401) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      await expect(fetchCurrentPlayer()).resolves.toEqual({
        ok: false,
        reason: 'unknown-failure',
        transiente: true,
      })
      expect(expirada).not.toHaveBeenCalled()
    } finally {
      desinscrever()
    }
  })

  it('refresh 401 com sonda 401 mantém invalida e notifica (review PR #383)', async () => {
    const calls = mockApi([
      { url: '/api/salas', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/me', response: () => jsonResponse({}, 401) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).toHaveBeenCalledTimes(1)
      expect(lerResultadoRefresh(response)).toBeUndefined()
      expect(contarChamadas(calls, 'GET', '/api/auth/me')).toBe(1)
    } finally {
      desinscrever()
    }
  })

  it('refresh envia sinal com timeout e aborto vira transiente (review PR #383)', async () => {
    expect(TEMPO_LIMITE_REFRESH_MS).toBeGreaterThanOrEqual(5000)
    expect(TEMPO_LIMITE_REFRESH_MS).toBeLessThanOrEqual(10000)
    let sinal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/auth/refresh')) {
          sinal = init?.signal as AbortSignal | undefined
          throw new DOMException('Timeout', 'TimeoutError')
        }
        return jsonResponse({}, 401)
      }),
    )
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      const response = await apiFetch('/api/salas')
      expect(response.status).toBe(401)
      expect(expirada).not.toHaveBeenCalled()
      expect(sinal).toBeDefined()
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

  it('/me 401 com refresh transitório vira unknown-failure (não invalida)', async () => {
    mockApi([
      { url: '/api/auth/me', response: () => jsonResponse({}, 401) },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 500) },
    ])
    const expirada = vi.fn()
    const desinscrever = onSessionExpired(expirada)
    try {
      await expect(fetchCurrentPlayer()).resolves.toEqual({ ok: false, reason: 'unknown-failure', transiente: true })
      expect(expirada).not.toHaveBeenCalled()
    } finally {
      desinscrever()
    }
  })

  it('reidratação retenta ante transiente e autentica quando a rede volta', async () => {
    let me = 0
    const calls = mockApi([
      {
        url: '/api/auth/me',
        response: () => {
          me += 1
          // Primeira tentativa cai no refresh 500 (transiente); a segunda,
          // após o backoff, encontra a Sessão válida.
          return me === 1 ? jsonResponse({}, 401) : jsonResponse(jogador)
        },
      },
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse({}, 500) },
    ])
    vi.useFakeTimers()
    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/'] })
      render(
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500)
      })
      expect(screen.getByText('Ana')).toBeInTheDocument()
      expect(contarChamadas(calls, 'GET', '/api/auth/me')).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('calibragem do slide (issue #376)', () => {
  it('TTL 900 → 600s; TTL 3600 respeita o teto; TTL curto respeita o piso', () => {
    expect(calcularIntervaloSlide(900)).toBe(600_000)
    expect(calcularIntervaloSlide(3600)).toBe(600_000)
    expect(calcularIntervaloSlide(300)).toBe(60_000)
    expect(calcularIntervaloSlide(120)).toBe(60_000)
  })

  it('lê VITE_SESSION_ACCESS_TTL_SECONDS com fallback 900', () => {
    expect(lerTtlDeAcessoSegundos()).toBe(900)
    vi.stubEnv('VITE_SESSION_ACCESS_TTL_SECONDS', '300')
    expect(lerTtlDeAcessoSegundos()).toBe(300)
    vi.stubEnv('VITE_SESSION_ACCESS_TTL_SECONDS', 'banana')
    expect(lerTtlDeAcessoSegundos()).toBe(900)
  })
})

describe('slide proativo (issue #376)', () => {
  it('dispara POST /refresh a cada intervalo sem fazer logout', async () => {
    const calls = mockApi([
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <AuthProvider initialState={mockAuthenticatedState}>
          <div>autenticado</div>
        </AuthProvider>,
      )
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(0)
      act(() => {
        vi.advanceTimersByTime(600_000)
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      act(() => {
        vi.advanceTimersByTime(600_000)
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(2)
      expect(screen.getByText('autenticado')).toBeInTheDocument()
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('voltar à aba respeita o throttle de 1 min', async () => {
    const calls = mockApi([
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    const descritor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <AuthProvider initialState={mockAuthenticatedState}>
          <div>autenticado</div>
        </AuthProvider>,
      )
      act(() => {
        vi.advanceTimersByTime(61_000)
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      // Segunda volta imediata: throttle segura.
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      unmount()
    } finally {
      if (descritor !== undefined) Object.defineProperty(document, 'visibilityState', descritor)
      vi.useRealTimers()
    }
  })

  it('falha transitória não suprime o próximo visibility (review PR #383)', async () => {
    let refreshes = 0
    const calls = mockApi([
      {
        url: '/api/auth/refresh',
        method: 'POST',
        response: () => {
          refreshes += 1
          return refreshes === 1 ? jsonResponse({}, 500) : jsonResponse(jogador)
        },
      },
    ])
    const descritor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <AuthProvider initialState={mockAuthenticatedState}>
          <div>autenticado</div>
        </AuthProvider>,
      )
      act(() => {
        vi.advanceTimersByTime(61_000)
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      // Primeira tentativa falhou: a volta imediata tenta de novo.
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {})
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(2)
      unmount()
    } finally {
      if (descritor !== undefined) Object.defineProperty(document, 'visibilityState', descritor)
      vi.useRealTimers()
    }
  })
})

describe('retry manual da Partida (issue #376)', () => {
  it('duplo clique no Tentar novamente abre uma única Conexão à Partida', async () => {
    let resolverRefresh!: (response: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      resolverRefresh = resolve
    })
    const calls = mockApi([{ url: '/api/auth/refresh', method: 'POST', response: () => refreshGate }])
    MockWebSocket.clean()
    const router = createMemoryRouter([{ path: '/partida', element: <PartidaPage /> }], {
      initialEntries: ['/partida?serverId=server-1&partidaId=partida-1'],
    })
    render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    act(() => {
      MockWebSocket.last()!.onerror!(new Event('error'))
    })
    const retry = await screen.findByTestId('partida-tentar-novamente')
    fireEvent.click(retry)
    fireEvent.click(retry)
    // Guard anti-duplo: um único refresh em voo apesar dos dois cliques.
    expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
    await act(async () => {
      resolverRefresh(jsonResponse(jogador))
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
  })

  it('reconexão automática da Partida aguarda o refresh lento (review PR #383)', async () => {
    let resolverRefresh!: (response: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      resolverRefresh = resolve
    })
    mockApi([{ url: '/api/auth/refresh', method: 'POST', response: () => refreshGate }])
    MockWebSocket.clean()
    const router = createMemoryRouter([{ path: '/partida', element: <PartidaPage /> }], {
      initialEntries: ['/partida?serverId=server-1&partidaId=partida-1'],
    })
    render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    vi.useFakeTimers()
    try {
      act(() => {
        MockWebSocket.last()!.simulateClose()
      })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {})
      // Refresh ainda pende: sem segunda conexão.
      expect(MockWebSocket.instances).toHaveLength(1)
      await act(async () => {
        resolverRefresh(jsonResponse(jogador))
      })
      await act(async () => {})
      expect(MockWebSocket.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reconexão do lobby (issue #376)', () => {
  it('fechamento da conexão tenta renovar a Sessão antes de reconectar', async () => {
    const calls = mockApi([
      { url: '/api/auth/refresh', method: 'POST', response: () => jsonResponse(jogador) },
    ])
    MockWebSocket.clean()
    const router = createMemoryRouter(routes, { initialEntries: ['/salas/criar'] })
    render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    vi.useFakeTimers()
    try {
      act(() => {
        MockWebSocket.last()!.simulateClose()
      })
      expect(contarChamadas(calls, 'POST', '/api/auth/refresh')).toBe(1)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {})
      expect(MockWebSocket.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refresh lento (>1s) segura a reconexão até assentar (review PR #383)', async () => {
    let resolverRefresh!: (response: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      resolverRefresh = resolve
    })
    mockApi([{ url: '/api/auth/refresh', method: 'POST', response: () => refreshGate }])
    MockWebSocket.clean()
    const router = createMemoryRouter(routes, { initialEntries: ['/salas/criar'] })
    render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    vi.useFakeTimers()
    try {
      act(() => {
        MockWebSocket.last()!.simulateClose()
      })
      // Timer de 1s correu, mas o refresh ainda pende: sem segunda conexão.
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {})
      expect(MockWebSocket.instances).toHaveLength(1)
      await act(async () => {
        resolverRefresh(jsonResponse(jogador))
      })
      await act(async () => {})
      expect(MockWebSocket.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('desmonte durante o slide não abre conexão órfã (review PR #383)', async () => {
    let resolverRefresh!: (response: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      resolverRefresh = resolve
    })
    mockApi([{ url: '/api/auth/refresh', method: 'POST', response: () => refreshGate }])
    MockWebSocket.clean()
    const router = createMemoryRouter(routes, { initialEntries: ['/salas/criar'] })
    const { unmount } = render(
      <AuthProvider initialState={mockAuthenticatedState}>
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
    vi.useFakeTimers()
    try {
      act(() => {
        MockWebSocket.last()!.simulateClose()
      })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      await act(async () => {})
      // Timer correu, mas o slide pende: sem segunda conexão.
      expect(MockWebSocket.instances).toHaveLength(1)
      // Desmonta com o slide em voo; só então o refresh assenta.
      unmount()
      await act(async () => {
        resolverRefresh(jsonResponse(jogador))
      })
      await act(async () => {})
      expect(MockWebSocket.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
