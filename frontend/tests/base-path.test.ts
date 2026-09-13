import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseDoApp, baseParaRouter, comBase } from '../web/src/api/basePath'

// Subpath (VITE_BASE_PATH): o app roda hoje na raiz e nada pode mudar nesse
// cenário; sob `/server01/`, todo caminho absoluto ganha o prefixo. As funções
// aceitam o base por parâmetro — testadas aqui sem depender do build.
describe('basePath — normalização e prefixo', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('base `/` mantém os caminhos como estão (sem regressão na raiz)', () => {
    expect(baseDoApp('/')).toBe('/')
    expect(comBase('/api/auth/me', '/')).toBe('/api/auth/me')
    expect(comBase('/media/som.mp3', '/')).toBe('/media/som.mp3')
    expect(baseParaRouter('/')).toBe('')
  })

  it('base `/server01/` prefixa caminhos absolutos uma única vez', () => {
    expect(baseDoApp('/server01/')).toBe('/server01/')
    expect(comBase('/api/bots/adicionar', '/server01/')).toBe('/server01/api/bots/adicionar')
    expect(comBase('/ws/lobby', '/server01/')).toBe('/server01/ws/lobby')
    expect(baseParaRouter('/server01/')).toBe('/server01')
  })

  it('normaliza base sem barra final e sem barra inicial', () => {
    expect(baseDoApp('/server01')).toBe('/server01/')
    expect(comBase('/assets/favicon.png', '/server01')).toBe('/server01/assets/favicon.png')
    expect(baseDoApp('server01')).toBe('/server01/')
  })

  it('não prefixa caminho relativo nem URL absoluta', () => {
    expect(comBase('assets/local.png', '/server01/')).toBe('assets/local.png')
    expect(comBase('https://exemplo.org/x', '/server01/')).toBe('https://exemplo.org/x')
    expect(comBase('ws://host/socket', '/server01/')).toBe('ws://host/socket')
  })

  it('default lê import.meta.env.BASE_URL (injetado pelo Vite)', () => {
    vi.stubEnv('BASE_URL', '/server01/')
    expect(baseDoApp()).toBe('/server01/')
    expect(comBase('/api/x')).toBe('/server01/api/x')
    expect(baseParaRouter()).toBe('/server01')
  })
})
