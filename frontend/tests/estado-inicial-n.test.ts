import { describe, expect, it } from 'vitest'
import { criarEstadoInicialDoCliente } from '../web/src/game/tabuleiro/reducao'

// Seed do estado inicial com N real (#284): a mesa nasce com N peões e N
// Peças Iniciais em vez de sempre 4 — o snapshot continua sendo a autoridade
// e corrige qualquer divergência em seguida.

describe('criarEstadoInicialDoCliente com N (#284)', () => {
  it('sem N usa o fallback 4 por compatibilidade', () => {
    const estado = criarEstadoInicialDoCliente()
    expect(estado.peoes).toHaveLength(4)
    expect(estado.iniciais).toHaveLength(4)
    expect(estado.quantidadeParaLayout).toBe(4)
  })

  it('com N=2 semeia 2 peões e 2 iniciais', () => {
    const estado = criarEstadoInicialDoCliente(2)
    expect(estado.peoes.map((p) => p.peaoId)).toEqual(['peao-branco', 'peao-vermelho'])
    expect(estado.iniciais.map((p) => p.pecaId)).toEqual(['inicial-1', 'inicial-2'])
    expect(estado.quantidadeParaLayout).toBe(2)
  })

  it('com N=3 semeia 3 peões e 3 iniciais', () => {
    const estado = criarEstadoInicialDoCliente(3)
    expect(estado.peoes).toHaveLength(3)
    expect(estado.iniciais).toHaveLength(3)
    expect(estado.quantidadeParaLayout).toBe(3)
  })
})
