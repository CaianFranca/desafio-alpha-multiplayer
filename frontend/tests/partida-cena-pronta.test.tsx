import { describe, expect, it, vi, afterEach } from 'vitest'
import { useEffect, useState } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { DefaultLoadingManager } from 'three'
import {
  CENA_PRONTA_QUIET_MS,
  CENA_PRONTA_TETO_MS,
  useCenaPronta,
} from '../web/src/hooks/useCenaPronta'

afterEach(() => {
  vi.useRealTimers()
})

function renderSemConteudo() {
  return renderHook(({ conteudo }: { conteudo: boolean }) => useCenaPronta(conteudo), {
    initialProps: { conteudo: false },
  })
}

function disparaInicio() {
  act(() => {
    DefaultLoadingManager.onStart?.('textura.jpg', 0, 1)
  })
}

function disparaCargaCompleta() {
  act(() => {
    DefaultLoadingManager.onLoad?.()
  })
}

function avanca(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useCenaPronta (gate dos dots até a cena 3D completa)', () => {
  it('começa pronta para não segurar os testes sem loader real', () => {
    const { result } = renderSemConteudo()
    expect(result.current).toBe(true)
  })

  it('inicio derruba, carga completa + silêncio libera', () => {
    vi.useFakeTimers()
    const { result } = renderSemConteudo()

    disparaInicio()
    expect(result.current).toBe(false)

    disparaCargaCompleta()
    expect(result.current).toBe(false)
    avanca(CENA_PRONTA_QUIET_MS)
    expect(result.current).toBe(true)
  })

  it('novo inicio dentro do silêncio reinicia a espera', () => {
    vi.useFakeTimers()
    const { result } = renderSemConteudo()

    disparaInicio()
    disparaCargaCompleta()
    avanca(CENA_PRONTA_QUIET_MS - 100)
    disparaInicio()
    disparaCargaCompleta()
    avanca(CENA_PRONTA_QUIET_MS - 100)
    expect(result.current).toBe(false)
    avanca(100)
    expect(result.current).toBe(true)
  })

  it('chegada do conteúdo re-arma o gate (loads das peças começam aí)', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderSemConteudo()
    expect(result.current).toBe(true)

    // Snapshot chegou: mesmo sem loads ainda, o gate fecha...
    rerender({ conteudo: true })
    expect(result.current).toBe(false)

    // ...e os loads das peças disparam na sequência, segurando os dots.
    disparaInicio()
    disparaCargaCompleta()
    avanca(CENA_PRONTA_QUIET_MS - 100)
    expect(result.current).toBe(false)
    avanca(100)
    expect(result.current).toBe(true)
  })

  it('chegada do conteúdo com tudo em cache libera no quiet sem travar', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderSemConteudo()

    rerender({ conteudo: true })
    expect(result.current).toBe(false)
    // Nenhum onStart/onLoad (cache): só o quiet do re-arme.
    avanca(CENA_PRONTA_QUIET_MS)
    expect(result.current).toBe(true)
  })

  it('teto libera mesmo sem carga completa (anti-travamento)', () => {
    vi.useFakeTimers()
    const { result } = renderSemConteudo()

    disparaInicio()
    expect(result.current).toBe(false)
    avanca(CENA_PRONTA_TETO_MS)
    expect(result.current).toBe(true)
  })

  it('erro de asset não trava: segue para a liberação', () => {
    vi.useFakeTimers()
    const { result } = renderSemConteudo()

    disparaInicio()
    act(() => {
      DefaultLoadingManager.onError?.('textura.jpg')
    })
    avanca(CENA_PRONTA_QUIET_MS)
    expect(result.current).toBe(true)
  })

  it('não libera no mesmo flush da chegada do conteúdo com loads em voo (race do latch)', () => {
    vi.useFakeTimers()

    // Sonda que replica o latch da PartidaPage: revela quando
    // disponivel + pronta no mesmo flush.
    function Sonda({ conteudo, disponivel }: { conteudo: boolean; disponivel: boolean }) {
      const pronta = useCenaPronta(conteudo)
      const [revelada, setRevelada] = useState(false)
      useEffect(() => {
        if (disponivel && pronta && !revelada) setRevelada(true)
      }, [disponivel, pronta, revelada])
      return <div data-testid="revelacao">{revelada ? 'tabuleiro' : 'dots'}</div>
    }

    // Quiet da Mesa já esvaziou antes do snapshot (cena ainda vazia).
    const { rerender } = render(<Sonda conteudo={false} disponivel={false} />)
    disparaInicio()
    disparaCargaCompleta()
    avanca(CENA_PRONTA_QUIET_MS)
    expect(screen.getByTestId('revelacao')).toHaveTextContent('dots')

    // Snapshot + disponivel + loads das peças no MESMO flush: os dots seguram.
    act(() => {
      DefaultLoadingManager.onStart?.('peca.jpg', 0, 2)
      rerender(<Sonda conteudo={true} disponivel={true} />)
    })
    expect(screen.getByTestId('revelacao')).toHaveTextContent('dots')

    // Fim dos loads + silêncio: aí sim revela, uma vez só.
    act(() => {
      DefaultLoadingManager.onLoad?.()
    })
    avanca(CENA_PRONTA_QUIET_MS)
    expect(screen.getByTestId('revelacao')).toHaveTextContent('tabuleiro')
  })

  it('desmontar restaura os handlers anteriores do manager', () => {
    const antesInicio = DefaultLoadingManager.onStart
    const antesCarga = DefaultLoadingManager.onLoad
    const antesProgresso = DefaultLoadingManager.onProgress
    const antesErro = DefaultLoadingManager.onError
    const { unmount } = renderSemConteudo()
    unmount()
    expect(DefaultLoadingManager.onStart).toBe(antesInicio)
    expect(DefaultLoadingManager.onLoad).toBe(antesCarga)
    expect(DefaultLoadingManager.onProgress).toBe(antesProgresso)
    expect(DefaultLoadingManager.onError).toBe(antesErro)
  })
})
