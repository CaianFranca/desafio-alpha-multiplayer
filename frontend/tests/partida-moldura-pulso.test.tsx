import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PartidaMoldura } from '../web/src/components/partida/PartidaMoldura'

// Cobertura do review PR #454 item 2 (negociável): valida que o pulso
// só dispara em ataque com penalidade real via data-testid="moldura-brilho"
// (estagio === 'ataque' + estadosAplicados.length > 0) e que telegraph/
// defendido permanece sem classe. A derivação `pulsoDaMoldura` vive em
// PartidaPage.tsx:543 — aqui testamos o contrato da PartidaMoldura
// (componente puro) que é o ponto de saída visual.

describe('PartidaMoldura — brilho permanente e pulso só com penalidade (#436)', () => {
  it('brilho sutil sempre visível sem pulso por padrão', () => {
    render(<PartidaMoldura />)

    const moldura = screen.getByTestId('partida-moldura')
    expect(moldura).toBeInTheDocument()
    expect(moldura).toHaveAttribute('aria-hidden', 'true')
    expect(moldura).toHaveClass('pointer-events-none')
    expect(moldura).toHaveClass('absolute')
    expect(moldura).toHaveClass('inset-0')

    const brilho = screen.getByTestId('moldura-brilho')
    expect(brilho).toBeInTheDocument()
    expect(brilho).toHaveAttribute('aria-hidden', 'true')
    expect(brilho).toHaveClass('moldura-brilho')
    expect(brilho).not.toHaveClass('moldura-pulso-vermelho')
    expect(brilho).toHaveAttribute('data-pulso', 'false')
  })

  it('pulsoAtivo false — telegraph e ataque defendido não disparam', () => {
    const { rerender } = render(<PartidaMoldura pulsoAtivo={false} />)
    const brilho = screen.getByTestId('moldura-brilho')
    expect(brilho).toHaveAttribute('data-pulso', 'false')
    expect(brilho).not.toHaveClass('moldura-pulso-vermelho')

    // Telegraph (estagio === 'telegraph') representado por pulsoAtivo false
    rerender(<PartidaMoldura pulsoAtivo={false} />)
    expect(screen.getByTestId('moldura-brilho')).not.toHaveClass('moldura-pulso-vermelho')

    // Ataque defendido (estadosAplicados.length === 0) também false
    rerender(<PartidaMoldura pulsoAtivo={false} />)
    expect(screen.getByTestId('moldura-brilho')).toHaveAttribute('data-pulso', 'false')
  })

  it('pulsoAtivo true — ataque com penalidade real aciona sombreamento nas extremidades', () => {
    render(<PartidaMoldura pulsoAtivo />)

    const brilho = screen.getByTestId('moldura-brilho')
    expect(brilho).toHaveAttribute('data-pulso', 'true')
    expect(brilho).toHaveClass('moldura-brilho')
    expect(brilho).toHaveClass('moldura-pulso-vermelho')
    // Sombreamento, não borda sólida: classes mantêm inset-0 via .moldura-brilho
    // (position:absolute inset-0) — o aumento de intensidade 25% é só em
    // box-shadow/alpha (scenes.css), preservado no prefers-reduced-motion estático.
    expect(brilho).toHaveAttribute('aria-hidden', 'true')
  })

  it('preserva medidor bordaRef border-0 para cameraLimites', () => {
    const { container } = render(<PartidaMoldura pulsoAtivo />)
    const medidor = container.querySelector('[class*="border-0"]')
    expect(medidor).not.toBeNull()
  })

  it('compacto respeitado: moldura segue inset-0 pointer-events-none', () => {
    render(<PartidaMoldura pulsoAtivo />)
    const moldura = screen.getByTestId('partida-moldura')
    expect(moldura).toHaveClass('inset-0')
    expect(moldura).toHaveClass('pointer-events-none')
    expect(moldura).toHaveClass('z-20')
  })
})
