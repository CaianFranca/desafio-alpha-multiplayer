import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  reduzirEventos,
} from '../web/src/game/tabuleiro/reducao'
import { criarReservaInicial, TOTAL_RESERVA } from '../web/src/game/tabuleiro/contrato'
import type { TabuleiroEventoDoServidor } from '@flicker/shared'

describe('redução do tabuleiro no cliente — deltas por evento (issue #85)', () => {
  it('estado inicial é determinístico: reserva completa e grade vazia', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.reserva).toEqual(criarReservaInicial())
    expect(inicial.reserva).toHaveLength(TOTAL_RESERVA)
    expect(inicial.posicionadas).toEqual([])
    expect(inicial.pecaSelecionadaId).toBeNull()
    expect(inicial.pecaEmManipulacaoId).toBeNull()
  })

  it('PECA_SELECIONADA marca a peça como selecionada', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_SELECIONADA',
      pecaId: 'inicial-1',
    })
    expect(estado.pecaSelecionadaId).toBe('inicial-1')
  })

  it('PECA_DESELECIONADA limpa apenas a seleção vigente', () => {
    const selecionado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_SELECIONADA',
      pecaId: 'inicial-1',
    })
    const deselecionado = reduzirEvento(selecionado, {
      type: 'PECA_DESELECIONADA',
      pecaId: 'inicial-1',
    })
    expect(deselecionado.pecaSelecionadaId).toBeNull()
    // Deseleção de peça não selecionada não altera o estado.
    const intocado = reduzirEvento(selecionado, {
      type: 'PECA_DESELECIONADA',
      pecaId: 'reta-1',
    })
    expect(intocado.pecaSelecionadaId).toBe('inicial-1')
  })

  it('PECA_GIRADA gira a peça na reserva quando não posicionada', () => {
    const girada = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_GIRADA',
      pecaId: 't-3',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    })
    const peca = girada.reserva.find((p) => p.pecaId === 't-3')
    expect(peca?.orientacao).toBe(90)
  })

  it('PECA_GIRADA gira a peça posicionada quando há manipulação aberta', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
      orientacao: 0,
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_GIRADA',
      pecaId: 'inicial-1',
      orientacaoAnterior: 0,
      orientacao: 180,
      sentido: 'horario',
    })
    expect(estado.posicionadas.find((p) => p.pecaId === 'inicial-1')?.orientacao).toBe(180)
    // A peça não pode estar na reserva depois de posicionada.
    expect(estado.reserva.some((p) => p.pecaId === 'inicial-1')).toBe(false)
  })

  it('PECA_POSICIONADA consome da reserva, preserva o tipo e abre manipulação', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-2',
      celula: { linha: 2, coluna: 4 },
      orientacao: 90,
    })
    // PECA_POSICIONADA não traz 'tipo'; o reducer preserva o tipo da reserva.
    expect(estado.posicionadas).toHaveLength(1)
    const posicionada = estado.posicionadas[0]!
    expect(posicionada).toEqual({
      pecaId: 'inicial-2',
      tipo: 'inicial',
      orientacao: 90,
      celula: { linha: 2, coluna: 4 },
    })
    expect(estado.reserva.some((p) => p.pecaId === 'inicial-2')).toBe(false)
    expect(estado.pecaSelecionadaId).toBeNull()
    expect(estado.pecaEmManipulacaoId).toBe('inicial-2')
  })

  it('MANIPULACAO_FINALIZADA fecha a janela aberta', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
      orientacao: 0,
    })
    expect(estado.pecaEmManipulacaoId).toBe('inicial-1')
    estado = reduzirEvento(estado, {
      type: 'MANIPULACAO_FINALIZADA',
      pecaId: 'inicial-1',
    })
    expect(estado.pecaEmManipulacaoId).toBeNull()
  })

  it('ERRO_DO_TABULEIRO não altera o estado do cliente', () => {
    const estado = criarEstadoInicialDoCliente()
    const erro: TabuleiroEventoDoServidor = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'PECA_NAO_RECEBIDA',
      mensagem: 'Peças de caminho só entram pelo Recebimento.',
    }
    expect(reduzirEvento(estado, erro)).toBe(estado)
  })

  it('lote sequencial aplica deltas em ordem (manipulação aberta + nova seleção)', () => {
    // O broadcast preserva a ordem [manipulacao_finalizada, peca_selecionada].
    const eventos: TabuleiroEventoDoServidor[] = [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' },
      { type: 'PECA_SELECIONADA', pecaId: 'reta-1' },
    ]
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), eventos)
    expect(estado.posicionadas).toHaveLength(1)
    expect(estado.pecaEmManipulacaoId).toBeNull()
    expect(estado.pecaSelecionadaId).toBe('reta-1')
  })

  it('sequência de posicionamentos acumula e remove da reserva', () => {
    const eventos: TabuleiroEventoDoServidor[] = [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 0 }, orientacao: 0 },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' },
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-2' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-2', celula: { linha: 3, coluna: 6 }, orientacao: 0 },
    ]
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), eventos)
    expect(estado.posicionadas).toHaveLength(2)
    expect(estado.reserva).toHaveLength(TOTAL_RESERVA - 2)
    expect(estado.posicionadas.some((p) => p.pecaId === 'inicial-1')).toBe(true)
    expect(estado.posicionadas.some((p) => p.pecaId === 'inicial-2')).toBe(true)
    expect(estado.pecaEmManipulacaoId).toBe('inicial-2')
  })
})
