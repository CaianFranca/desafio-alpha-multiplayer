// Testes do gatilho do Modo Desenvolvedor (issue #340): 5 cliques ≤3s no
// logo Ginga do footer, preventDefault, idempotência e persistência em
// sessionStorage. O coletor é singleton — cada teste reimporta os módulos
// com `vi.resetModules()` para começar com o modo desligado.

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let coletor: typeof import('../web/src/utils/coletorDeDepuracao')
let Footer: typeof import('../web/src/components/home/Footer')['Footer']
let ModoDesenvolvedorProvider: typeof import('../web/src/state/ModoDesenvolvedorProvider')['ModoDesenvolvedorProvider']

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  coletor = await import('../web/src/utils/coletorDeDepuracao')
  Footer = (await import('../web/src/components/home/Footer')).Footer
  ModoDesenvolvedorProvider = (await import('../web/src/state/ModoDesenvolvedorProvider')).ModoDesenvolvedorProvider
})

afterEach(() => {
  coletor.desinstalarColetorDeDepuracao()
})

function montar() {
  return render(
    <ModoDesenvolvedorProvider>
      <Footer />
    </ModoDesenvolvedorProvider>,
  )
}

function logoGinga(): HTMLElement {
  return screen.getByRole('link', { name: 'Ginga' })
}

describe('gatilho — 5 cliques em até 3s', () => {
  it('5 cliques na janela ativam o modo: surge o botão flutuante', async () => {
    montar()
    expect(coletor.estaModoAtivo()).toBe(false)

    for (let i = 0; i < 5; i++) {
      fireEvent.click(logoGinga())
    }

    expect(coletor.estaModoAtivo()).toBe(true)
    expect(window.sessionStorage.getItem('flicker:modo-desenvolvedor')).toBe('1')
    expect(screen.getByRole('button', { name: 'Depuração' })).toBeInTheDocument()
  })

  it('preventDefault: o `<a>` do Ginga nunca navega', async () => {
    montar()
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true })
    logoGinga().dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(true)
  })

  it('idempotência: cliques extra em modo ativo não fazem nada (nem desligam)', async () => {
    montar()
    for (let i = 0; i < 5; i++) fireEvent.click(logoGinga())
    for (let i = 0; i < 10; i++) fireEvent.click(logoGinga())

    expect(coletor.estaModoAtivo()).toBe(true)
    expect(window.sessionStorage.getItem('flicker:modo-desenvolvedor')).toBe('1')
  })

  it('janela de 3s: 4 cliques, pausa além da janela, e o gesto recomeça', async () => {
    const agora = vi.spyOn(Date, 'now')
    let instante = 0
    agora.mockImplementation(() => instante)

    montar()
    for (let i = 0; i < 4; i++) {
      fireEvent.click(logoGinga())
      instante += 100
    }
    // Fora da janela (>3s do primeiro clique): o gesto recomeça.
    instante += 4000
    fireEvent.click(logoGinga())
    instante += 100
    fireEvent.click(logoGinga())

    expect(coletor.estaModoAtivo()).toBe(false)

    for (let i = 0; i < 3; i++) {
      fireEvent.click(logoGinga())
      instante += 100
    }
    expect(coletor.estaModoAtivo()).toBe(true)
    agora.mockRestore()
  })

  it('menos de 5 cliques não ativam', () => {
    montar()
    for (let i = 0; i < 4; i++) fireEvent.click(logoGinga())
    expect(coletor.estaModoAtivo()).toBe(false)
  })

  it('modo persistido em sessionStorage sobrevive a reload (remonta com botão flutuante)', async () => {
    // Simula o reload: grava o flag e reimporta os módulos com o storage já
    // preenchido — o coletor lê o sessionStorage no boot do módulo.
    window.sessionStorage.setItem('flicker:modo-desenvolvedor', '1')
    vi.resetModules()
    coletor = await import('../web/src/utils/coletorDeDepuracao')
    Footer = (await import('../web/src/components/home/Footer')).Footer
    ModoDesenvolvedorProvider = (await import('../web/src/state/ModoDesenvolvedorProvider')).ModoDesenvolvedorProvider
    montar()
    expect(coletor.estaModoAtivo()).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Depuração' })).toBeInTheDocument())
  })

  it('botão flutuante alterna só a VISIBILIDADE do painel', async () => {
    const usuario = userEvent.setup()
    montar()
    for (let i = 0; i < 5; i++) fireEvent.click(logoGinga())

    await usuario.click(screen.getByRole('button', { name: 'Depuração' }))
    expect(screen.getByTestId('painel-de-depuracao')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Fechar depuração' }))
    expect(screen.queryByTestId('painel-de-depuracao')).not.toBeInTheDocument()
    // Captura e stream continuam: o modo segue ativo.
    expect(coletor.estaModoAtivo()).toBe(true)
  })

  it('botão flutuante fica ACIMA do overlay do painel (clicável com o painel aberto)', async () => {
    const usuario = userEvent.setup()
    montar()
    for (let i = 0; i < 5; i++) fireEvent.click(logoGinga())

    await usuario.click(screen.getByRole('button', { name: 'Depuração' }))
    // Regressão do review: botão em z-70 > painel z-60 — mesmo z-index deixaria
    // o botão atrás do overlay (posterior no DOM) e inclicável no navegador.
    expect(screen.getByRole('button', { name: 'Fechar depuração' }).className).toContain('z-[70]')
  })

  it('controle Desligar encerra o modo, limpa o storage e some com os controles', async () => {
    const usuario = userEvent.setup()
    montar()
    for (let i = 0; i < 5; i++) fireEvent.click(logoGinga())
    expect(coletor.estaModoAtivo()).toBe(true)

    await usuario.click(screen.getByRole('button', { name: 'Desligar' }))

    expect(coletor.estaModoAtivo()).toBe(false)
    expect(window.sessionStorage.getItem('flicker:modo-desenvolvedor')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desligar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Depuração' })).not.toBeInTheDocument()
  })
})
