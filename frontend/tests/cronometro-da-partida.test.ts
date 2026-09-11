import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatarCronometroDaPartida,
  useCronometroDaPartida,
} from '../web/src/components/partida/useCronometroDaPartida'

describe('formatarCronometroDaPartida (#259)', () => {
  it('abaixo de 1h mantém MM:SS', () => {
    expect(formatarCronometroDaPartida(3599)).toBe('59:59')
  })

  it('a partir de 1h usa H:MM:SS sem zero à esquerda', () => {
    expect(formatarCronometroDaPartida(3600)).toBe('1:00:00')
    expect(formatarCronometroDaPartida(3661)).toBe('1:01:01')
    expect(formatarCronometroDaPartida(3900)).toBe('1:05:00')
  })

  it('acima de 24h mantém as horas corridas', () => {
    expect(formatarCronometroDaPartida(86399)).toBe('23:59:59')
    expect(formatarCronometroDaPartida(86400)).toBe('24:00:00')
  })
})

describe('useCronometroDaPartida — marco tardio (issue #259)', () => {
  const T0 = new Date('2026-09-11T12:00:00.000Z').getTime()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sincroniza o relógio quando iniciadaEm chega depois do mount', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const { result, rerender } = renderHook(
      ({ iniciadaEm }: { iniciadaEm: number | null }) =>
        useCronometroDaPartida({ emAndamento: true, emResultado: false, iniciadaEm }),
      { initialProps: { iniciadaEm: null as number | null } },
    )
    // Sem marco: permanece em 00:00 (nunca conta do mount local).
    expect(result.current.segundos).toBe(0)
    expect(result.current.texto).toBe('00:00')

    // PARTIDA_INICIADA tardio chega 65,5s depois do mount, com o marco no
    // passado (T0). O refresh imediato do efeito sincroniza o relógio sem
    // esperar o próximo tick de 1s — o `agora` de mount estaria stale.
    act(() => {
      vi.setSystemTime(T0 + 65_500)
    })
    rerender({ iniciadaEm: T0 })
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(result.current.segundos).toBe(65)
    expect(result.current.texto).toBe('01:05')
  })

  it('com o marco presente já no mount, mantém a contagem por intervalo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const { result } = renderHook(() =>
      useCronometroDaPartida({ emAndamento: true, emResultado: false, iniciadaEm: T0 }),
    )
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(result.current.segundos).toBe(0)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(result.current.segundos).toBe(65)
  })
})
