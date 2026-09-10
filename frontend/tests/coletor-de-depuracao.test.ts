// Testes do coletor de depuração (issue #340, "Modo Desenvolvedor").
//
// O coletor é um singleton com estado de módulo — cada teste reimporta com
// `vi.resetModules()` para começar limpo (buffer, fase, modo, flag de
// instalação). O console restaurado no afterEach evita vazar o hijack para
// o relatório do Vitest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Coletor = typeof import('../web/src/utils/coletorDeDepuracao')

let coletor: Coletor

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  coletor = await import('../web/src/utils/coletorDeDepuracao')
})

afterEach(() => {
  coletor.desinstalarColetorDeDepuracao()
})

describe('coletor — captura de console e erros', () => {
  it('captura console.log/warn/error a partir do boot com nível certo', () => {
    coletor.instalarColetorDeDepuracao()

    console.log('olá')
    console.warn('cuidado')
    console.error('quebrou')

    const lista = coletor.entradas()
    expect(lista.map((e) => e.fonte)).toEqual(['console', 'console', 'console'])
    expect(lista.map((e) => e.nivel)).toEqual(['info', 'warn', 'error'])
    expect(lista[1]?.mensagem).toBe('cuidado')
  })

  it('preserva a saída original do console ao capturar', () => {
    const espião = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    coletor.instalarColetorDeDepuracao()

    console.log('idempotente')

    // O hijack chama o original (aqui o spy) exatamente uma vez.
    expect(espião).toHaveBeenCalledTimes(1)
    espião.mockRestore()
  })

  it('captura erros não tratados (window error e unhandledrejection)', () => {
    coletor.instalarColetorDeDepuracao()

    window.dispatchEvent(new ErrorEvent('error', { message: 'explosão global' }))

    const rejeitada = Promise.reject(new Error('promessa perdida'))
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: rejeitada,
      reason: new Error('promessa perdida'),
    }))

    const lista = coletor.entradas()
    expect(lista[0]?.fonte).toBe('erro')
    expect(lista[0]?.mensagem).toContain('explosão global')
    expect(lista[1]?.mensagem).toContain('promessa perdida')
    // Evita unhandledrejection real do Node após o teste.
    rejeitada.catch(() => undefined)
  })

  it('trunca a mensagem a ~2000 chars', () => {
    coletor.instalarColetorDeDepuracao()
    console.log('x'.repeat(3000))

    const entrada = coletor.entradas()[0]
    expect(entrada?.mensagem.length).toBe(2001) // 2000 + reticências
  })

  it('buffer anelado: acima de ~500 entradas descarta as mais antigas', () => {
    for (let i = 0; i < 505; i++) {
      coletor.coletar('console', 'info', `linha ${i}`)
    }
    const lista = coletor.entradas()
    expect(lista.length).toBe(500)
    expect(lista[0]?.mensagem).toBe('linha 5')
    expect(lista[lista.length - 1]?.mensagem).toBe('linha 504')
  })
})

describe('coletor — formatação de objetos (formatarValor)', () => {
  it('console.log com objeto registra JSON indentado, não [object Object]', () => {
    coletor.instalarColetorDeDepuracao()

    console.log('estado', { a: 1, b: { c: [2, 3] } })

    const mensagem = coletor.entradas()[0]?.mensagem ?? ''
    expect(mensagem).toContain('estado {')
    expect(mensagem).toContain('"a": 1')
    expect(mensagem).toContain('  "b": {')
    expect(mensagem).toContain('    "c": [')
    expect(mensagem).not.toContain('[object Object]')
  })

  it('objeto com ciclo referencial cai em String() sem lançar', () => {
    coletor.instalarColetorDeDepuracao()
    const ciclico: { self?: unknown } = {}
    ciclico.self = ciclico

    expect(() => console.log(ciclico)).not.toThrow()

    // Fallback String(): o ciclo não serializa, mas a linha registra algo.
    expect(coletor.entradas()[0]?.mensagem).toBe('[object Object]')
  })

  it('formatarValor: string como está, primitivo via String(), Error como "Nome: mensagem"', () => {
    expect(coletor.formatarValor('texto')).toBe('texto')
    expect(coletor.formatarValor(42)).toBe('42')
    expect(coletor.formatarValor(null)).toBe('null')
    expect(coletor.formatarValor(new TypeError('boom'))).toBe('TypeError: boom')
  })

  it('coletar aceita thunk e só resolve/memoiza na leitura da mensagem', () => {
    let avaliacoes = 0
    coletor.coletar('console', 'info', () => {
      avaliacoes += 1
      return 'sob demanda'
    })

    expect(avaliacoes).toBe(0)
    expect(coletor.entradas()[0]?.mensagem).toBe('sob demanda')
    expect(avaliacoes).toBe(1)

    // Memoização: leituras seguintes não reavaliam o thunk.
    expect(coletor.entradas()[0]?.mensagem).toBe('sob demanda')
    expect(avaliacoes).toBe(1)
  })

  it('a serialização do payload só ocorre na leitura da mensagem (lazy)', () => {
    const stringify = vi.spyOn(JSON, 'stringify')

    coletor.coletar('ws←', 'info', () =>
      coletor.resumirPayload({ type: 'ESTADO', grande: 'x'.repeat(10) }),
    )

    // Nada foi formatado no registro; só a leitura dispara JSON.stringify.
    expect(stringify).not.toHaveBeenCalled()
    const mensagem = coletor.entradas()[0]?.mensagem ?? ''
    expect(stringify).toHaveBeenCalled()
    expect(mensagem).toContain('"type": "ESTADO"')

    stringify.mockRestore()
  })

  it('objeto do console só é serializado quando a mensagem é lida (mutação refletida)', () => {
    coletor.instalarColetorDeDepuracao()
    const estado: { valor: number } = { valor: 1 }

    console.log(estado)
    // A mutação posterior aparece na leitura: prova que a serialização foi
    // adiada até aqui, não feita no registro.
    estado.valor = 2

    const mensagem = coletor.entradas()[0]?.mensagem ?? ''
    expect(mensagem).toContain('"valor": 2')
    expect(mensagem).not.toContain('[object Object]')
  })
})

describe('coletor — marcadores de fase (fundos históricos)', () => {
  it('definirFase enxerta registro e estampa a fase nas entradas seguintes', () => {
    coletor.coletar('ws←', 'info', 'antes da fase', 'sala')

    coletor.definirFase('sala')
    coletor.coletar('ws→', 'info', 'durante a sala', 'sala')

    coletor.definirFase('turno-2')
    coletor.coletar('console', 'error', 'durante o turno 2')

    const lista = coletor.entradas()
    expect(lista[0]?.fase).toBeNull()
    const marcadorSala = lista.find((e) => e.fonte === 'fase' && e.mensagem === 'fase mudou para sala')
    expect(marcadorSala).toBeDefined()
    expect(lista.find((e) => e.mensagem === 'durante a sala')?.fase).toBe('sala')
    expect(lista.find((e) => e.mensagem === 'durante o turno 2')?.fase).toBe('turno-2')
  })

  it('definirFase é idempotente para a mesma fase', () => {
    coletor.definirFase('login')
    coletor.definirFase('login')
    expect(coletor.entradas().filter((e) => e.fonte === 'fase').length).toBe(1)
  })
})

describe('coletor — formato das linhas', () => {
  it('formata [HH:mm:ss.mmm] [fonte] [contexto] mensagem', () => {
    coletor.definirFase('sala')
    coletor.coletar('backend', 'warn', 'encaminhamento recusado: teste', 'encaminhamento')

    const entrada = coletor.entradas().find((e) => e.fonte === 'backend')
    expect(entrada).toBeDefined()
    expect(coletor.formatarLinha(entrada!)).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[backend\] \[encaminhamento\] encaminhamento recusado: teste$/)
  })

  it('linha sem contexto omite o colchete', () => {
    coletor.coletar('console', 'info', 'mensagem')

    const entrada = coletor.entradas().find((e) => e.fonte === 'console')
    expect(entrada).toBeDefined()
    expect(coletor.formatarLinha(entrada!)).toMatch(/^\[[\d:.]+\] \[console\] mensagem$/)
  })
})

describe('coletor — modo desenvolvedor', () => {
  it('ativarModo é idempotente e persiste em sessionStorage', () => {
    expect(coletor.estaModoAtivo()).toBe(false)

    coletor.ativarModoDoDesenvolvedor()
    coletor.ativarModoDoDesenvolvedor()

    expect(coletor.estaModoAtivo()).toBe(true)
    expect(window.sessionStorage.getItem('flicker:modo-desenvolvedor')).toBe('1')
  })

  it('notifica assinantes de aoAtivarModo exatamente uma vez', () => {
    const chamadas: number[] = []
    const desinscrever = coletor.aoAtivarModo(() => chamadas.push(1))

    coletor.ativarModoDoDesenvolvedor()
    coletor.ativarModoDoDesenvolvedor()
    desinscrever()

    expect(chamadas).toEqual([1])
  })

  it('desativarModo limpa o sessionStorage e é idempotente', () => {
    coletor.ativarModoDoDesenvolvedor()
    expect(coletor.estaModoAtivo()).toBe(true)

    coletor.desativarModoDoDesenvolvedor()
    expect(coletor.estaModoAtivo()).toBe(false)
    expect(window.sessionStorage.getItem('flicker:modo-desenvolvedor')).toBeNull()

    // Idempotente: repetir não renotifica (a notificação é coberta abaixo).
    expect(() => coletor.desativarModoDoDesenvolvedor()).not.toThrow()
    expect(coletor.estaModoAtivo()).toBe(false)
  })

  it('aoDesativarModo notifica uma vez e para após unsubscribe', () => {
    const chamadas: number[] = []
    const desinscrever = coletor.aoDesativarModo(() => chamadas.push(1))

    coletor.ativarModoDoDesenvolvedor()
    coletor.desativarModoDoDesenvolvedor()
    coletor.desativarModoDoDesenvolvedor()
    expect(chamadas).toEqual([1])

    desinscrever()
    coletor.ativarModoDoDesenvolvedor()
    coletor.desativarModoDoDesenvolvedor()
    expect(chamadas).toEqual([1])
  })

  it('modo lido do sessionStorage sobrevive a reimport (reload)', async () => {
    coletor.ativarModoDoDesenvolvedor()

    vi.resetModules()
    const reiniciado = await import('../web/src/utils/coletorDeDepuracao')
    expect(reiniciado.estaModoAtivo()).toBe(true)
    coletor = reiniciado
  })
})

describe('coletor — utilidades do painel', () => {
  it('ultimas(n) recorta as N mais recentes; n <= 0 devolve tudo', () => {
    for (let i = 0; i < 10; i++) coletor.coletar('console', 'info', `e${i}`)
    expect(coletor.ultimas(3).map((e) => e.mensagem)).toEqual(['e7', 'e8', 'e9'])
    expect(coletor.ultimas(0).length).toBe(10)
    expect(coletor.ultimas(-1).length).toBe(10)
  })

  it('limpar esvazia o buffer', () => {
    coletor.coletar('console', 'info', 'algo')
    coletor.limpar()
    expect(coletor.entradas()).toEqual([])
  })

  it('subscrever entrega novas entradas e o unsubscribe para', () => {
    const recebidas: string[] = []
    const desinscrever = coletor.subscrever((e) => recebidas.push(e.mensagem))

    coletor.coletar('console', 'info', 'primeira')
    desinscrever()
    coletor.coletar('console', 'info', 'segunda')

    expect(recebidas).toEqual(['primeira'])
  })
})
