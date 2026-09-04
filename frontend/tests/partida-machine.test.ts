import { describe, expect, it } from 'vitest'
import {
  estadoInicial,
  isEstadoDaTela,
  transicao,
  type EstadoDaTela,
} from '../web/src/components/partida/partidaTelaMachine'

describe('partidaTelaMachine', () => {
  it('estado inicial é carregando', () => {
    expect(estadoInicial).toBe('carregando')
  })

  it('isEstadoDaTela valida valores', () => {
    expect(isEstadoDaTela('carregando')).toBe(true)
    expect(isEstadoDaTela('aguardando')).toBe(true)
    expect(isEstadoDaTela('disponivel')).toBe(true)
    expect(isEstadoDaTela('falha')).toBe(true)
    expect(isEstadoDaTela('resultado')).toBe(true)
    expect(isEstadoDaTela('invalido')).toBe(false)
    expect(isEstadoDaTela(null)).toBe(false)
    expect(isEstadoDaTela(undefined)).toBe(false)
  })

  it('transicao carregar => carregando', () => {
    expect(transicao('falha', { type: 'carregar' })).toBe('carregando')
    expect(transicao('disponivel', { type: 'carregar' })).toBe('carregando')
  })

  it('partidaPreparada => aguardando', () => {
    expect(transicao('carregando', { type: 'partidaPreparada' })).toBe('aguardando')
    expect(transicao('falha', { type: 'partidaPreparada' })).toBe('aguardando')
  })

  it('partidaEmAndamento => disponivel', () => {
    expect(transicao('carregando', { type: 'partidaEmAndamento' })).toBe('disponivel')
    expect(transicao('aguardando', { type: 'partidaEmAndamento' })).toBe('disponivel')
  })

  it('falhar => falha', () => {
    expect(transicao('carregando', { type: 'falhar' })).toBe('falha')
    expect(transicao('aguardando', { type: 'falhar' })).toBe('falha')
  })

  it('tentarNovamente => carregando', () => {
    expect(transicao('falha', { type: 'tentarNovamente' })).toBe('carregando')
    expect(transicao('carregando', { type: 'tentarNovamente' })).toBe('carregando')
  })

  it('forcar transita para estado alvo idempotente', () => {
    const estados: EstadoDaTela[] = ['carregando', 'aguardando', 'disponivel', 'falha', 'resultado']
    for (const alvo of estados) {
      for (const origem of estados) {
        expect(transicao(origem, { type: 'forcar', estado: alvo })).toBe(alvo)
      }
    }
  })

  it('forcar é idempotente quando já no mesmo estado', () => {
    expect(transicao('carregando', { type: 'forcar', estado: 'carregando' })).toBe('carregando')
    expect(transicao('falha', { type: 'forcar', estado: 'falha' })).toBe('falha')
    expect(transicao('resultado', { type: 'forcar', estado: 'resultado' })).toBe('resultado')
  })

  it('partidaTerminada => resultado a partir de qualquer estado', () => {
    expect(transicao('disponivel', { type: 'partidaTerminada', resultado: 'vitoria' })).toBe('resultado')
    expect(transicao('disponivel', { type: 'partidaTerminada', resultado: 'derrota' })).toBe('resultado')
    expect(transicao('aguardando', { type: 'partidaTerminada', resultado: 'vitoria' })).toBe('resultado')
    expect(transicao('carregando', { type: 'partidaTerminada', resultado: 'derrota' })).toBe('resultado')
  })

  it('tentarNovamente em resultado permanece em resultado', () => {
    expect(transicao('resultado', { type: 'tentarNovamente' })).toBe('resultado')
  })
})
