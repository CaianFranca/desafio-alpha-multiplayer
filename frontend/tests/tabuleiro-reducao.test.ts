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

describe('redução do ciclo do peão — espelho do engine (issue #91)', () => {
  it('estado inicial seeda os 4 peões com ids por cor, sobre a Mesa', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.peoes).toEqual([
      { peaoId: 'peao-branco', cor: 'branco', celula: null },
      { peaoId: 'peao-vermelho', cor: 'vermelho', celula: null },
      { peaoId: 'peao-azul', cor: 'azul', celula: null },
      { peaoId: 'peao-amarelo', cor: 'amarelo', celula: null },
    ])
    expect(inicial.peaoSelecionadoId).toBeNull()
    expect(inicial.recebidasPendentes).toEqual([])
  })

  it('PEAO_SELECIONADO marca o peão selecionado', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_SELECIONADO',
      peaoId: 'peao-branco',
    })
    expect(estado.peaoSelecionadoId).toBe('peao-branco')
  })

  it('RECEBIMENTO_GERADO carrega as pendências com pecaId null (campo client-side)', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        { recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    expect(estado.recebidasPendentes).toEqual([
      { recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 }, pecaId: null },
    ])
  })

  it('PEAO_POSICIONADO atualiza a célula e re-seleciona o peão (Primeiro Turno)', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    const peao = estado.peoes.find((p) => p.peaoId === 'peao-branco')
    expect(peao?.celula).toEqual({ linha: 3, coluna: 3 })
    expect(estado.peaoSelecionadoId).toBe('peao-branco')
  })

  it('TIPO_DA_PECA_RECEBIDA_ESCOLHIDO consome a peça da Reserva, tipa a pendência e a MANTÉM na lista', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, {
      type: 'PEAO_SELECIONADO',
      peaoId: 'peao-branco',
    })
    estado = reduzirEvento(estado, {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        { recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    estado = reduzirEvento(estado, {
      type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO',
      recebidaId: 'r1',
      pecaId: 'reta-1',
      tipoDaPeca: 'reta',
    })
    // Peça consumida da Reserva (espelha peoes.ts:367 do engine).
    expect(estado.reserva.some((p) => p.pecaId === 'reta-1')).toBe(false)
    // Pendência PERMANECE, agora tipada com o pecaId client-side.
    expect(estado.recebidasPendentes).toHaveLength(1)
    expect(estado.recebidasPendentes[0]).toEqual({
      recebidaId: 'r1',
      bordaGeradora: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
      pecaId: 'reta-1',
    })
    // Seleção passa para a Recebida (encaixe em foco).
    expect(estado.pecaSelecionadaId).toBe('reta-1')
    expect(estado.pecasDeRecebimento['reta-1']).toBe('reta')
  })

  it('PECA_POSICIONADA remove a pendência do alvo (por célula) e mantém as demais', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        { recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        { recebidaId: 'r2', bordaGeradora: 'leste', celulaAlvo: { linha: 3, coluna: 4 } },
      ],
    })
    estado = reduzirEvento(estado, {
      type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO',
      recebidaId: 'r1',
      pecaId: 'reta-1',
      tipoDaPeca: 'reta',
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      orientacao: 0,
    })
    // Encaixe na célula-alvo (2,3) resolve APENAS a pendência daquele alvo.
    expect(estado.recebidasPendentes.map((r) => r.recebidaId)).toEqual(['r2'])
    expect(estado.posicionadas.some((p) => p.pecaId === 'reta-1')).toBe(true)
  })

  it('PEAO_MOVIDO atualiza a posição e limpa a seleção (sem seleção fantasma)', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, { type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
    const peao = estado.peoes.find((p) => p.peaoId === 'peao-branco')
    expect(peao?.celula).toEqual({ linha: 2, coluna: 3 })
    expect(estado.peaoSelecionadoId).toBeNull()
  })

  it('PEAO_PERMANECEU limpa a seleção sem alterar a posição', () => {
    let estado = criarEstadoInicialDoCliente()
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    estado = reduzirEvento(estado, {
      type: 'PEAO_PERMANECEU',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
    })
    const peao = estado.peoes.find((p) => p.peaoId === 'peao-branco')
    expect(peao?.celula).toEqual({ linha: 3, coluna: 3 })
    expect(estado.peaoSelecionadoId).toBeNull()
  })

  it('lote encadeado do Primeiro Turno: pendências zeradas e peça fora da Reserva ao final', () => {
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PEAO_POSICIONADO', peaoId: 'peao-branco', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { type: 'RECEBIMENTO_GERADO', recebidas: [{ recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } }] },
      { type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO', recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta' },
      { type: 'PECA_POSICIONADA', pecaId: 'reta-1', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
    ])
    expect(estado.recebidasPendentes).toEqual([])
    expect(estado.reserva.some((p) => p.pecaId === 'reta-1')).toBe(false)
    expect(estado.posicionadas).toHaveLength(2)
    expect(estado.pecaSelecionadaId).toBeNull()
    expect(estado.pecaEmManipulacaoId).toBe('reta-1')
  })
})
