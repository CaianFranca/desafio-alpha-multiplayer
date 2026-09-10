import { describe, expect, it } from 'vitest'
import { buildGameRedirectHref, urlsDoAlvo } from '../web/src/api/encaminhamento'

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
