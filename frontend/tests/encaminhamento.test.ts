import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGameRedirectHref, buildGameWsUrl, urlsDoAlvo } from '../web/src/api/encaminhamento'

describe('encaminhamento: redirect para /partida (issue #329)', () => {
  it('sem código mantém o formato anterior (compat com links antigos)', () => {
    expect(buildGameRedirectHref('s', 'p')).toBe('/partida?serverId=s&partidaId=p')
    expect(buildGameRedirectHref('s', 'p', null)).toBe('/partida?serverId=s&partidaId=p')
    expect(buildGameRedirectHref('s', 'p', undefined)).toBe('/partida?serverId=s&partidaId=p')
  })

  it('com código anexa ?codigoDeSala= como fallback do Retorno à Sala', () => {
    const href = buildGameRedirectHref('s', 'p', 'A3K9M2')
    expect(href).toBe('/partida?serverId=s&partidaId=p&codigoDeSala=A3K9M2')
    // Contrato com a PartidaPage (searchParams.get('codigoDeSala')).
    expect(href).toContain('codigoDeSala=')
  })

  it('urlsDoAlvo repassa o código ao href', () => {
    const { href } = urlsDoAlvo('s', 'p', 'A3K9M2')
    expect(href).toContain('codigoDeSala=A3K9M2')
    expect(urlsDoAlvo('s', 'p').href).not.toContain('codigoDeSala')
  })
})

describe('encaminhamento: WS respeita o subpath (VITE_BASE_PATH)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('com base / mantém /ws/game/... na raiz (sem regressão)', () => {
    const url = buildGameWsUrl('s', 'p')
    expect(url).toContain('/ws/game/s?partida-id=p')
    expect(url).not.toContain('/server01/')
  })

  it('com base /server01/ prefixa o path do WS uma única vez', () => {
    vi.stubEnv('BASE_URL', '/server01/')
    const url = buildGameWsUrl('s', 'p')
    expect(url).toContain('/server01/ws/game/s?partida-id=p')
    // Sem barra dupla vinda da concatenação host + base.
    expect(url).not.toContain('//ws/game')
  })

  it('href do redirect carrega o base (window.location.assign ignora o basename)', () => {
    vi.stubEnv('BASE_URL', '/server01/')
    expect(buildGameRedirectHref('s', 'p', 'A3K9M2')).toBe(
      '/server01/partida?serverId=s&partidaId=p&codigoDeSala=A3K9M2',
    )
    expect(buildGameRedirectHref('s', 'p')).toBe('/server01/partida?serverId=s&partidaId=p')
    // Sem barra dupla vinda da concatenação do base.
    expect(buildGameRedirectHref('s', 'p')).not.toContain('//partida')
  })
})
