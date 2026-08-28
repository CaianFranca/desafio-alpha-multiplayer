export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function stubAuthFetch(handlers: {
  register?: FetchStub
  login?: FetchStub
  me?: FetchStub
  fallback?: FetchStub
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/auth/register') && handlers.register) return handlers.register(input, init)
    if (url.includes('/api/auth/login') && handlers.login) return handlers.login(input, init)
    if (url.includes('/api/auth/me') && handlers.me) return handlers.me(input, init)
    if (handlers.fallback) return handlers.fallback(input, init)
    return new Response(null, { status: 404 })
  })
}

export function stubAuthSuccess(jogador: unknown, status = 201) {
  return stubAuthFetch({
    register: async () => jsonResponse(jogador, status),
    login: async () => jsonResponse(jogador, 200),
    me: async () => jsonResponse(jogador, 200),
  })
}
