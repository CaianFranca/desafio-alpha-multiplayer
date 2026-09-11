import { describe, expect, it } from 'vitest'
import { formatarCronometroDaPartida } from '../web/src/components/partida/useCronometroDaPartida'

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
