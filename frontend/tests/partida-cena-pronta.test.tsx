import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { DefaultLoadingManager } from 'three'
import {
  CENA_PRONTA_QUIET_MS,
  CENA_PRONTA_TETO_MS,
  useCenaPronta,
} from '../web/src/hooks/useCenaPronta'

afterEach(() => {
  vi.useRealTimers()
})

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

describe('useCenaPronta (gate dos dots até a cena 3D completa)', () => {
  it('começa pronta para não segurar os testes sem loader real', () => {
    const { result } = renderHook(() => useCenaPronta())
    expect(result.current).toBe(true)
  })

  it('inicio derruba, carga completa + silêncio libera', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCenaPronta())

    disparaInicio()
    expect(result.current).toBe(false)

    disparaCargaCompleta()
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(CENA_PRONTA_QUIET_MS)
    })
    expect(result.current).toBe(true)
  })

  it('novo inicio dentro do silêncio reinicia a espera', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCenaPronta())

    disparaInicio()
    disparaCargaCompleta()
    act(() => {
      vi.advanceTimersByTime(CENA_PRONTA_QUIET_MS - 100)
    })
    disparaInicio()
    disparaCargaCompleta()
    act(() => {
      vi.advanceTimersByTime(CENA_PRONTA_QUIET_MS - 100)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(true)
  })

  it('teto libera mesmo sem carga completa (anti-travamento)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCenaPronta())

    disparaInicio()
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(CENA_PRONTA_TETO_MS)
    })
    expect(result.current).toBe(true)
  })

  it('erro de asset não trava: segue para a liberação', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCenaPronta())

    disparaInicio()
    act(() => {
      DefaultLoadingManager.onError?.('textura.jpg')
    })
    act(() => {
      vi.advanceTimersByTime(CENA_PRONTA_QUIET_MS)
    })
    expect(result.current).toBe(true)
  })

  it('desmontar restaura os handlers anteriores do manager', () => {
    const antesInicio = DefaultLoadingManager.onStart
    const antesCarga = DefaultLoadingManager.onLoad
    const antesErro = DefaultLoadingManager.onError
    const { unmount } = renderHook(() => useCenaPronta())
    unmount()
    expect(DefaultLoadingManager.onStart).toBe(antesInicio)
    expect(DefaultLoadingManager.onLoad).toBe(antesCarga)
    expect(DefaultLoadingManager.onError).toBe(antesErro)
  })
})
