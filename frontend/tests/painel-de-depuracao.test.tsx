// Testes do PainelDeDepuração (issue #340): render, filtro por nível,
// Limpar e Copiar últimos N logs (entradas completas, respeitando o filtro),
// fundo de fase por linha da paleta e legibilidade (borda por fonte, divisória
// multi-linha, wrap sem break-all, auto-scroll condicional, pill de novas
// linhas e contador do buffer). O painel lê do coletor singleton — cada teste
// reimporta os módulos para começar com o buffer vazio.

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let coletor: typeof import('../web/src/utils/coletorDeDepuracao')
let PainelDeDepuracao: typeof import('../web/src/components/depuracao/PainelDeDepuracao')['PainelDeDepuracao']
let estaNoFundo: typeof import('../web/src/components/depuracao/rolagemDaLista')['estaNoFundo']

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  coletor = await import('../web/src/utils/coletorDeDepuracao')
  PainelDeDepuracao = (await import('../web/src/components/depuracao/PainelDeDepuracao')).PainelDeDepuracao
  estaNoFundo = (await import('../web/src/components/depuracao/rolagemDaLista')).estaNoFundo
})

afterEach(() => {
  coletor.desinstalarColetorDeDepuracao()
})

function semear() {
  coletor.coletar('console', 'info', 'linha info')
  coletor.coletar('console', 'warn', 'linha warn')
  coletor.coletar('erro', 'error', 'linha erro')
  coletor.coletar('backend', 'info', 'linha backend', 'lobby')
  coletor.definirFase('sala')
  coletor.coletar('ws→', 'info', 'linha com fundo de sala', 'sala')
}

function clipboardFake() {
  const copiado: string[] = []
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (texto: string) => { copiado.push(texto) } },
  })
  return copiado
}

// jsdom não faz layout: stuba as propriedades de scroll do elemento.
// scrollTop tem getter/setter para capturar o valor atribuído pelo painel.
function stubScroll(
  elemento: HTMLElement,
  valores: { scrollTop?: number; scrollHeight?: number; clientHeight?: number },
) {
  let scrollTop = valores.scrollTop ?? 0
  Object.defineProperty(elemento, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (valor: number) => { scrollTop = valor },
  })
  Object.defineProperty(elemento, 'scrollHeight', { configurable: true, value: valores.scrollHeight ?? 0 })
  Object.defineProperty(elemento, 'clientHeight', { configurable: true, value: valores.clientHeight ?? 0 })
}

describe('painel — render e filtro por nível', () => {
  it('renderiza todas as linhas com fonte e contexto no formato do painel', () => {
    semear()
    render(<PainelDeDepuracao />)

    const linhas = screen.getAllByTestId('linha-de-depuracao')
    expect(linhas.length).toBe(6)
    expect(screen.getByText(/linha backend/)).toBeInTheDocument()
    // Formato canônico preservado no DOM (prefixo e mensagem em spans separados):
    // [timestamp] [fonte] [contexto] mensagem.
    const linhaBackend = screen.getByText(/linha backend/).closest('li')
    expect(linhaBackend?.textContent).toMatch(/\[backend\] \[lobby\] linha backend/)
  })

  it('filtro por nível esconde as linhas dos outros níveis', () => {
    semear()
    render(<PainelDeDepuracao />)

    fireEvent.change(screen.getByLabelText('Filtro por nível'), { target: { value: 'warn' } })

    expect(screen.getAllByTestId('linha-de-depuracao').length).toBe(1)
    expect(screen.getByText(/linha warn/)).toBeInTheDocument()
    expect(screen.queryByText(/linha info/)).not.toBeInTheDocument()
    expect(screen.queryByText(/linha erro/)).not.toBeInTheDocument()
  })

  it('entradas novas aparecem em tempo real (assinatura do coletor)', async () => {
    render(<PainelDeDepuracao />)
    coletor.coletar('backend', 'info', 'chegou depois do render', 'partida')
    await waitFor(() => expect(screen.getByText(/chegou depois do render/)).toBeInTheDocument())
  })
})

describe('painel — Limpar', () => {
  it('limpa o buffer e o painel esvazia', () => {
    semear()
    render(<PainelDeDepuracao />)

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }))

    expect(coletor.entradas()).toEqual([])
    expect(screen.queryByTestId('linha-de-depuracao')).not.toBeInTheDocument()
  })
})

describe('painel — Copiar últimos N logs', () => {
  it('campo vazio copia tudo (respeitando o filtro)', async () => {
    semear()
    const copiado = clipboardFake()
    render(<PainelDeDepuracao />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(copiado.length).toBe(1))

    const linhas = copiado[0]?.split('\n') ?? []
    expect(linhas.length).toBe(6)
    expect(linhas[0]).toMatch(/^\[[\d:.]+\] \[console\] linha info$/)
  })

  it('N=3 copia só as 3 últimas', async () => {
    semear()
    const copiado = clipboardFake()
    render(<PainelDeDepuracao />)

    fireEvent.change(screen.getByLabelText('Últimos N logs a copiar'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(copiado.length).toBe(1))

    expect((copiado[0]?.split('\n').length) ?? 0).toBe(3)
    expect(copiado[0]).toContain('linha backend')
    expect(copiado[0]).toContain('linha com fundo de sala')
  })

  it('cópia respeita o filtro de nível ativo', async () => {
    semear()
    const copiado = clipboardFake()
    render(<PainelDeDepuracao />)

    fireEvent.change(screen.getByLabelText('Filtro por nível'), { target: { value: 'error' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(copiado.length).toBe(1))

    const linhas = copiado[0]?.split('\n') ?? []
    expect(linhas.length).toBe(1)
    expect(linhas[0]).toContain('linha erro')
  })

  it('N=0 (ou vazio) copia tudo', async () => {
    semear()
    const copiado = clipboardFake()
    render(<PainelDeDepuracao />)

    fireEvent.change(screen.getByLabelText('Últimos N logs a copiar'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(copiado.length).toBe(1))

    expect((copiado[0]?.split('\n').length) ?? 0).toBe(6)
  })
})

describe('painel — fundo de fase por linha (paleta)', () => {
  it('cada linha carrega o fundo da fase vigente no registro', () => {
    semear()
    render(<PainelDeDepuracao />)

    const comFundo = screen.getByText(/linha com fundo de sala/).closest('li') as HTMLElement
    // Paleta: sala = amarelo (#eab308) com transparência (alpha 0x33 ≈ 0.2).
    expect(comFundo.style.backgroundColor).toBe('rgba(234, 179, 8, 0.2)')

    const semFundo = screen.getByText(/linha info/).closest('li') as HTMLElement
    expect(semFundo.style.backgroundColor).toBe('')
  })
})

describe('painel — legibilidade (borda por fonte, divisória e wrap)', () => {
  it('cada entrada tem borda esquerda na cor da fonte', () => {
    semear()
    render(<PainelDeDepuracao />)

    const linhaBackend = screen.getByText(/linha backend/).closest('li') as HTMLElement
    // Paleta: backend = roxo (jsdom normaliza hex para rgb).
    expect(linhaBackend.style.borderLeftColor).toBe('rgb(167, 139, 250)')
    const linhaErro = screen.getByText(/linha erro/).closest('li') as HTMLElement
    // Paleta: erro = vermelho.
    expect(linhaErro.style.borderLeftColor).toBe('rgb(239, 68, 68)')
  })

  it('prefixo é neutro e o badge da fonte tem a cor dela', () => {
    semear()
    render(<PainelDeDepuracao />)

    const linha = screen.getByText(/linha backend/).closest('li') as HTMLElement
    const badge = Array.from(linha.querySelectorAll('span')).find(
      (span) => span.textContent === '[backend]',
    )
    expect(badge?.style.color).toBe('rgb(167, 139, 250)')
    const prefixo = Array.from(linha.querySelectorAll('span')).find(
      (span) => span.className.includes('text-slate-500'),
    )
    expect(prefixo?.textContent).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/)
  })

  it('entrada multi-linha ganha divisória; single-linha não', () => {
    coletor.coletar('console', 'info', 'primeira linha\nsegunda linha')
    coletor.coletar('console', 'info', 'single')
    render(<PainelDeDepuracao />)

    const multi = screen.getByText(/primeira linha/).closest('li') as HTMLElement
    expect(multi.className).toContain('border-b')
    const single = screen.getByText(/single/).closest('li') as HTMLElement
    expect(single.className).not.toContain('border-b')
  })

  it('linhas usam pre-wrap com quebra por palavra (sem break-all)', () => {
    semear()
    render(<PainelDeDepuracao />)

    const linha = screen.getByText(/linha info/).closest('li') as HTMLElement
    expect(linha.className).toContain('whitespace-pre-wrap')
    expect(linha.className).toContain('[overflow-wrap:anywhere]')
    expect(linha.className).not.toContain('break-all')
  })
})

describe('painel — auto-scroll condicional, pill e contador', () => {
  it('rola ao fim quando o usuário já estava no fundo', async () => {
    semear()
    render(<PainelDeDepuracao />)
    const lista = screen.getByTestId('linhas-do-painel')
    // 900 + 100 >= 1000 - 20 → no fundo.
    stubScroll(lista, { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })

    coletor.coletar('console', 'info', 'chegou no fundo')

    await waitFor(() => expect(lista.scrollTop).toBe(1000))
    expect(screen.queryByTestId('pill-novas-linhas')).not.toBeInTheDocument()
  })

  it('scrolado para cima: pill aparece, contador do buffer reflete e o clique rola', async () => {
    semear() // 6 entradas (5 coletar + 1 "fase mudou para sala")
    render(<PainelDeDepuracao />)
    const lista = screen.getByTestId('linhas-do-painel')
    // 0 + 100 < 1000 - 20 → fora do fundo.
    stubScroll(lista, { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 })

    coletor.coletar('console', 'info', 'chegou fora de vista')

    const pill = await screen.findByTestId('pill-novas-linhas')
    expect(pill).toHaveTextContent('1 nova linha')
    expect(screen.getByTestId('contador-do-buffer')).toHaveTextContent(`7/${coletor.CAPACIDADE_DO_BUFFER}`)

    fireEvent.click(pill)
    expect(lista.scrollTop).toBe(1000)
    await waitFor(() => expect(screen.queryByTestId('pill-novas-linhas')).not.toBeInTheDocument())
  })

  it('voltar ao fundo manualmente zera a pill', async () => {
    semear()
    render(<PainelDeDepuracao />)
    const lista = screen.getByTestId('linhas-do-painel')
    stubScroll(lista, { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 })

    coletor.coletar('console', 'info', 'nova enquanto inspecionava')
    await screen.findByTestId('pill-novas-linhas')

    // Usuário rola de volta ao fim: 880 + 100 >= 1000 - 20.
    stubScroll(lista, { scrollTop: 880, scrollHeight: 1000, clientHeight: 100 })
    fireEvent.scroll(lista)

    await waitFor(() => expect(screen.queryByTestId('pill-novas-linhas')).not.toBeInTheDocument())
  })

  it('contador do toolbar reflete o buffer (e zera no Limpar)', () => {
    semear()
    render(<PainelDeDepuracao />)

    expect(screen.getByTestId('contador-do-buffer')).toHaveTextContent(`6/${coletor.CAPACIDADE_DO_BUFFER}`)

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(screen.getByTestId('contador-do-buffer')).toHaveTextContent(`0/${coletor.CAPACIDADE_DO_BUFFER}`)
  })

  it('estaNoFundo: considera fundo dentro da margem de ~20px', () => {
    const elemento = document.createElement('ol')
    // jsdom sem layout: 0 + 0 >= 0 - 20 → fundo.
    expect(estaNoFundo(elemento)).toBe(true)
    expect(estaNoFundo(null)).toBe(true)

    stubScroll(elemento, { scrollTop: 850, scrollHeight: 1000, clientHeight: 100 })
    // 950 < 980 → fora do fundo.
    expect(estaNoFundo(elemento)).toBe(false)

    stubScroll(elemento, { scrollTop: 975, scrollHeight: 1000, clientHeight: 100 })
    // 1075 >= 980 → fundo (margem).
    expect(estaNoFundo(elemento)).toBe(true)
  })
})
