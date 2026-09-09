// Testes do PainelDeDepuração (issue #340): render, filtro por nível,
// Limpar e Copiar últimos N logs (entradas completas, respeitando o filtro),
// mais o fundo de fase por linha da paleta. O painel lê do coletor
// singleton — cada teste reimporta os módulos para começar com o buffer vazio.

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let coletor: typeof import('../web/src/utils/coletorDeDepuracao')
let PainelDeDepuracao: typeof import('../web/src/components/depuracao/PainelDeDepuracao')['PainelDeDepuracao']

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  coletor = await import('../web/src/utils/coletorDeDepuracao')
  PainelDeDepuracao = (await import('../web/src/components/depuracao/PainelDeDepuracao')).PainelDeDepuracao
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

describe('painel — render e filtro por nível', () => {
  it('renderiza todas as linhas com fonte e contexto no formato do painel', () => {
    semear()
    render(<PainelDeDepuracao />)

    const linhas = screen.getAllByTestId('linha-de-depuracao')
    expect(linhas.length).toBe(6)
    expect(screen.getByText(/linha backend/)).toBeInTheDocument()
    // Formato: [timestamp] [fonte] [contexto] mensagem.
    expect(screen.getByText(/\[backend\] \[lobby\] linha backend/)).toBeInTheDocument()
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
