import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../web/src/api/client'

// Subpath (VITE_BASE_PATH): o apiFetch prefixa só strings que começam com `/`.
// Base `/` = comportamento atual intacto; base `/server01/` = chamadas /api
// servidas sob o prefixo.

function mockFetch() {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('apiFetch — base path nas chamadas de API', () => {
  it('sob /server01/ prefixa a URL da chamada', async () => {
    vi.stubEnv('BASE_URL', '/server01/')
    const fetchMock = mockFetch()

    await apiFetch('/api/bots/adicionar', { method: 'POST' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/server01/api/bots/adicionar',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('com base / mantém a URL como está (sem regressão na raiz)', async () => {
    const fetchMock = mockFetch()

    await apiFetch('/api/auth/me')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include' }))
  })

  it('Request/URL e URLs absolutas não são reescritos', async () => {
    vi.stubEnv('BASE_URL', '/server01/')
    const fetchMock = mockFetch()
    const url = new URL('https://exemplo.org/api/x')

    await apiFetch(url)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
  })

  it('string relativa (sem barra inicial) não é prefixada', async () => {
    vi.stubEnv('BASE_URL', '/server01/')
    const fetchMock = mockFetch()

    await apiFetch('api/x')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/x')
  })
})
