import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  reduzirEventos,
} from '../web/src/game/tabuleiro/reducao'
import { aplicarSnapshot } from '../web/src/game/tabuleiro/snapshot'
import { criarIniciaisDaMesa, QUANTIDADE_INICIAIS } from '../web/src/game/tabuleiro/contrato'
import { mapearCliqueNaCelula } from '../web/src/game/tabuleiro/interacao'
import type {
  EstadoDaPartidaSnapshot,
  PecaPosicionadaNoSnapshot,
  TabuleiroEventoDoServidor,
} from '@flicker/shared'

// Pendência sorteada (#138) compartilhada nos cenários do ciclo.
function pendenciaSorteada(
  recebidaId: string,
  pecaId: string,
  tipoDaPeca: 'reta' | 'T' | 'cruz',
  vaga: 'norte' | 'leste' | 'sul' | 'oeste' | null,
  celulaAlvo: { linha: number; coluna: number } | null,
) {
  return { recebidaId, pecaId, tipoDaPeca, vaga, celulaAlvo }
}

describe('redução do tabuleiro no cliente — deltas por evento (issue #85)', () => {
  it('estado inicial é determinístico: 4 iniciais na mesa e grade vazia (issue #143)', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.iniciais).toEqual(criarIniciaisDaMesa())
    expect(inicial.iniciais).toHaveLength(QUANTIDADE_INICIAIS)
    expect(inicial.iniciais.map((p) => p.pecaId)).toEqual([
      'inicial-1',
      'inicial-2',
      'inicial-3',
      'inicial-4',
    ])
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

  it('PECA_GIRADA gira a Peça Inicial na mesa quando não posicionada (issue #143)', () => {
    const girada = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_GIRADA',
      pecaId: 'inicial-2',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    })
    const peca = girada.iniciais.find((p) => p.pecaId === 'inicial-2')
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
    // A peça não pode estar na mesa depois de posicionada.
    expect(estado.iniciais.some((p) => p.pecaId === 'inicial-1')).toBe(false)
  })

  it('PECA_GIRADA gira a pendência sorteada em foco (peça na bandeja, #143)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [pendenciaSorteada('r1', 'reta-1', 'reta', null, null)],
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_GIRADA',
      pecaId: 'reta-1',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    })
    expect(estado.recebidasPendentes[0]?.orientacao).toBe(90)
  })

  it('PECA_GIRADA de peça desconhecida (fora da mesa/posicionadas/pendências) é no-op', () => {
    const estado = criarEstadoInicialDoCliente()
    const girada = reduzirEvento(estado, {
      type: 'PECA_GIRADA',
      pecaId: 'peca-inexistente',
      orientacaoAnterior: 0,
      orientacao: 90,
      sentido: 'horario',
    })
    expect(girada).toBe(estado)
  })

  it('PECA_POSICIONADA consome da mesa (inicial), preserva o tipo e abre manipulação', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-2',
      celula: { linha: 2, coluna: 4 },
      orientacao: 90,
    })
    // PECA_POSICIONADA não traz 'tipo'; o reducer preserva o tipo da mesa.
    expect(estado.posicionadas).toHaveLength(1)
    const posicionada = estado.posicionadas[0]!
    expect(posicionada).toEqual({
      pecaId: 'inicial-2',
      tipo: 'inicial',
      orientacao: 90,
      celula: { linha: 2, coluna: 4 },
    })
    expect(estado.iniciais.some((p) => p.pecaId === 'inicial-2')).toBe(false)
    expect(estado.iniciais).toHaveLength(QUANTIDADE_INICIAIS - 1)
    expect(estado.pecaSelecionadaId).toBeNull()
    expect(estado.pecaEmManipulacaoId).toBe('inicial-2')
  })

  it('PECA_POSICIONADA de peça sorteada usa o tipo da pendência e não toca as iniciais', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [pendenciaSorteada('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 })],
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
      orientacao: 0,
    })
    expect(estado.posicionadas.map((p) => [p.pecaId, p.tipo])).toEqual([['reta-1', 'reta']])
    expect(estado.iniciais).toHaveLength(QUANTIDADE_INICIAIS)
    expect(estado.recebidasPendentes).toEqual([])
    expect(estado.pecaEmManipulacaoId).toBe('reta-1')
  })

  it('PECA_POSICIONADA de Especial não abre a janela de Manipulação (revisão #199)', () => {
    // Espelha o engine posicionarRecebida (peoes.ts:683-689): Especiais e
    // Monstros NÃO têm janela. O delta também não pode abrir — antes abria
    // para qualquer tipo (a janela que o giro da bandeja/botões consome).
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        {
          recebidaId: 'r1',
          pecaId: 'gerador-1',
          tipoDaPeca: 'gerador',
          vaga: 'norte',
          celulaAlvo: { linha: 2, coluna: 3 },
        },
      ],
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'gerador-1',
      celula: { linha: 2, coluna: 3 },
      orientacao: 0,
    })
    // A peça entra no tabuleiro e resolve a pendência normalmente…
    expect(estado.posicionadas.map((p) => [p.pecaId, p.tipo])).toEqual([['gerador-1', 'gerador']])
    expect(estado.recebidasPendentes).toEqual([])
    // …mas a janela de Manipulação permanece fechada.
    expect(estado.pecaEmManipulacaoId).toBeNull()
  })

  it('PECA_POSICIONADA de Monstro não abre a janela; de caminho abre (revisão #199)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_SORTEADA',
      pecaId: 'vulto-1',
      tipoDaPeca: 'vulto',
      orientacao: 0,
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'vulto-1',
      celula: { linha: 1, coluna: 1 },
      orientacao: 0,
    })
    expect(estado.posicionadas.map((p) => p.tipo)).toEqual(['vulto'])
    expect(estado.pecaEmManipulacaoId).toBeNull()
    // Contraste: peça de caminho (cruz) abre a janela no mesmo caminho de delta.
    estado = reduzirEvento(estado, {
      type: 'PECA_SORTEADA',
      pecaId: 'cruz-1',
      tipoDaPeca: 'cruz',
      orientacao: 0,
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'cruz-1',
      celula: { linha: 1, coluna: 2 },
      orientacao: 0,
    })
    expect(estado.pecaEmManipulacaoId).toBe('cruz-1')
  })

  it('PECA_POSICIONADA de peça sem tipo conhecido é no-op', () => {
    const estado = criarEstadoInicialDoCliente()
    const depois = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'reta-9',
      celula: { linha: 1, coluna: 1 },
      orientacao: 0,
    })
    expect(depois).toBe(estado)
    expect(depois.posicionadas).toEqual([])
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
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-2' },
    ]
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), eventos)
    expect(estado.posicionadas).toHaveLength(1)
    expect(estado.pecaEmManipulacaoId).toBeNull()
    expect(estado.pecaSelecionadaId).toBe('inicial-2')
  })

  it('sequência de posicionamentos acumula e remove da mesa (iniciais)', () => {
    const eventos: TabuleiroEventoDoServidor[] = [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 0 }, orientacao: 0 },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' },
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-2' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-2', celula: { linha: 3, coluna: 6 }, orientacao: 0 },
    ]
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), eventos)
    expect(estado.posicionadas).toHaveLength(2)
    expect(estado.iniciais).toHaveLength(QUANTIDADE_INICIAIS - 2)
    expect(estado.posicionadas.some((p) => p.pecaId === 'inicial-1')).toBe(true)
    expect(estado.posicionadas.some((p) => p.pecaId === 'inicial-2')).toBe(true)
    expect(estado.pecaEmManipulacaoId).toBe('inicial-2')
  })
})

describe('redução do ciclo do peão — espelho do engine (issue #91, forma #138)', () => {
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

  it('RECEBIMENTO_GERADO (#138) passa as pendências sorteadas e semeia os tipos', () => {
    const recebidas = [
      pendenciaSorteada('r1', 'reta-1', 'reta', null, null),
      pendenciaSorteada('r2', 't-1', 'T', null, null),
    ]
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas,
    })
    expect(estado.recebidasPendentes).toEqual(recebidas)
    expect(estado.pecasDeRecebimento['reta-1']).toBe('reta')
    expect(estado.pecasDeRecebimento['t-1']).toBe('T')
  })

  it('RECEBIMENTO_GERADO parcial (2 recebidas onde 3 eram plausíveis): modelo reflete o que chegou (rebate #199)', () => {
    // A contagem é autoridade do engine (Esgotamento da Caixa — quando a
    // Caixa tem menos peças que bordas abertas, o Recebimento vem truncado).
    // O cliente não valida expectativa local: renderiza exatamente as
    // pendências recebidas, sem erro e sem inventar a terceira.
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        pendenciaSorteada('r1', 'reta-1', 'reta', null, null),
        pendenciaSorteada('r2', 't-1', 'T', null, null),
      ],
    })
    expect(estado.recebidasPendentes).toHaveLength(2)
    expect(estado.recebidasPendentes.map((r) => r.recebidaId)).toEqual(['r1', 'r2'])
    // O fluxo segue com as que chegaram: a corrente é a primeira delas.
    expect(estado.recebidasPendentes.find((r) => r.vaga === null)?.recebidaId).toBe('r1')
  })

  it('VAGA_DA_PECA_RECEBIDA_ESCOLHIDO fixa vaga/célula-alvo, seleciona a peça e mantém as demais', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        pendenciaSorteada('r1', 'reta-1', 'reta', null, null),
        pendenciaSorteada('r2', 't-1', 'T', null, null),
      ],
    })
    estado = reduzirEvento(estado, {
      type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
      recebidaId: 'r1',
      borda: 'norte',
      celulaAlvo: { linha: 2, coluna: 3 },
    })
    expect(estado.recebidasPendentes[0]).toEqual(
      pendenciaSorteada('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 }),
    )
    // A segunda pendência permanece intacta (sem vaga).
    expect(estado.recebidasPendentes[1]).toEqual(pendenciaSorteada('r2', 't-1', 'T', null, null))
    // A escolha da vaga seleciona a Peça sorteada (encaixe em foco, #138).
    expect(estado.pecaSelecionadaId).toBe('reta-1')
  })

  it('PECA_POSICIONADA remove a pendência do alvo (por célula) e mantém as demais', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'RECEBIMENTO_GERADO',
      recebidas: [
        pendenciaSorteada('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 }),
        pendenciaSorteada('r2', 't-1', 'T', 'leste', { linha: 3, coluna: 4 }),
      ],
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

  it('PECA_SORTEADA semeia o tipo da peça sorteada sem duplicar entrada existente', () => {
    const inicial = criarEstadoInicialDoCliente()
    const estado = reduzirEvento(inicial, {
      type: 'PECA_SORTEADA',
      pecaId: 'cruz-1',
      tipoDaPeca: 'cruz',
      orientacao: 90,
    })
    expect(estado.pecasDeRecebimento['cruz-1']).toBe('cruz')
    // Repetição do sorteio não produz novo objeto (no-op por igualdade).
    expect(reduzirEvento(estado, { type: 'PECA_SORTEADA', pecaId: 'cruz-1', tipoDaPeca: 'cruz', orientacao: 90 })).toBe(estado)
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

  it('lote encadeado do Primeiro Turno (#138): pendências zeradas e iniciais consumidas ao final', () => {
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PEAO_POSICIONADO', peaoId: 'peao-branco', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } },
      { type: 'RECEBIMENTO_GERADO', recebidas: [pendenciaSorteada('r1', 'reta-1', 'reta', null, null)] },
      { type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO', recebidaId: 'r1', borda: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      { type: 'PECA_POSICIONADA', pecaId: 'reta-1', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
    ])
    expect(estado.recebidasPendentes).toEqual([])
    expect(estado.iniciais.map((p) => p.pecaId)).toEqual(['inicial-2', 'inicial-3', 'inicial-4'])
    expect(estado.posicionadas).toHaveLength(2)
    expect(estado.pecaSelecionadaId).toBeNull()
    expect(estado.pecaEmManipulacaoId).toBe('reta-1')
  })
})

describe('iluminação e limpeza no cliente — espelho do estado compartilhado (issue #151)', () => {
  it('estado inicial nasce sem células iluminadas', () => {
    expect(criarEstadoInicialDoCliente().celulasIluminadas).toEqual([])
  })

  it('CELULAS_ILUMINADAS substitui a lista inteira (motor é a autoridade)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'CELULAS_ILUMINADAS',
      celulas: [
        { linha: 1, coluna: 2 },
        { linha: 3, coluna: 4 },
      ],
    })
    expect(estado.celulasIluminadas).toEqual([
      { linha: 1, coluna: 2 },
      { linha: 3, coluna: 4 },
    ])
    // O evento seguinte NÃO acumula: substitui o conjunto anterior por inteiro.
    estado = reduzirEvento(estado, {
      type: 'CELULAS_ILUMINADAS',
      celulas: [{ linha: 0, coluna: 6 }],
    })
    expect(estado.celulasIluminadas).toEqual([{ linha: 0, coluna: 6 }])
    // Lista vazia apaga a iluminação.
    estado = reduzirEvento(estado, { type: 'CELULAS_ILUMINADAS', celulas: [] })
    expect(estado.celulasIluminadas).toEqual([])
  })

  it('LIMPEZA_APLICADA remove apenas as peças indicadas de posicionadas', () => {
    let estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_SORTEADA', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 },
      { type: 'PECA_SELECIONADA', pecaId: 'reta-1' },
      { type: 'PECA_POSICIONADA', pecaId: 'reta-1', celula: { linha: 3, coluna: 4 }, orientacao: 0 },
    ])
    expect(estado.posicionadas).toHaveLength(2)
    estado = reduzirEvento(estado, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['reta-1'] })
    expect(estado.posicionadas.map((p) => p.pecaId)).toEqual(['inicial-1'])
    // A peça removida NÃO volta para a mesa (decisão do plano: só sai da cena).
    expect(estado.iniciais.some((p) => p.pecaId === 'reta-1')).toBe(false)
  })

  it('célula liberada pela Limpeza volta a ser alvo de posicionamento', () => {
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] },
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-2' },
    ])
    // Sem a Limpeza a célula estaria ocupada (nenhum comando); liberada, o
    // clique na mesma célula mapeia POSICIONAR_PECA — ocupação é derivada de
    // `posicionadas`, sem código extra.
    const comando = mapearCliqueNaCelula(estado, { linha: 3, coluna: 3 })
    expect(comando).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'inicial-2',
      celula: { linha: 3, coluna: 3 },
    })
  })

  it('Limpeza limpa Seleção e Manipulação quando a peça removida era a focada', () => {
    // Manipulação aberta na peça removida (encaixe sem finalização).
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_POSICIONADA',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
      orientacao: 0,
    })
    expect(estado.pecaEmManipulacaoId).toBe('inicial-1')
    estado = reduzirEvento(estado, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] })
    expect(estado.pecaEmManipulacaoId).toBeNull()

    // Seleção ativa apontando para peça removida.
    let selecionado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-1' },
    ])
    expect(selecionado.pecaSelecionadaId).toBe('inicial-1')
    selecionado = reduzirEvento(selecionado, {
      type: 'LIMPEZA_APLICADA',
      pecasRemovidas: ['inicial-1'],
    })
    expect(selecionado.pecaSelecionadaId).toBeNull()
  })

  it('seleção/manipulação de peça NÃO removida é preservada pela Limpeza', () => {
    let estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-2' },
    ])
    estado = reduzirEvento(estado, { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] })
    expect(estado.pecaSelecionadaId).toBe('inicial-2')
    // Manipulação de outra peça permanece.
    let comManipulacao = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_SORTEADA', pecaId: 'reta-2', tipoDaPeca: 'reta', orientacao: 0 },
    ])
    comManipulacao = reduzirEvento(comManipulacao, {
      type: 'PECA_POSICIONADA',
      pecaId: 'reta-2',
      celula: { linha: 2, coluna: 2 },
      orientacao: 0,
    })
    comManipulacao = reduzirEvento(comManipulacao, {
      type: 'LIMPEZA_APLICADA',
      pecasRemovidas: ['inicial-1'],
    })
    expect(comManipulacao.pecaEmManipulacaoId).toBe('reta-2')
    expect(comManipulacao.posicionadas.map((p) => p.pecaId)).toEqual(['reta-2'])
  })

  it('LIMPEZA_APLICADA com lista vazia de removidas é no-op', () => {
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 1, coluna: 1 }] },
    ])
    expect(reduzirEvento(estado, { type: 'LIMPEZA_APLICADA', pecasRemovidas: [] })).toBe(estado)
  })

  it('iluminação e limpeza coexistem no mesmo lote sem interferência', () => {
    const estado = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 0, coluna: 0 }] },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['inicial-1'] },
      { type: 'CELULAS_ILUMINADAS', celulas: [{ linha: 6, coluna: 6 }] },
    ])
    expect(estado.posicionadas).toEqual([])
    expect(estado.celulasIluminadas).toEqual([{ linha: 6, coluna: 6 }])
  })
})

describe('redução dos turnos no cliente — fase, rodada e mapa aprendido (issue #118)', () => {
  const TURNO_1_J1 = { type: 'TURNO_INICIADO', jogadorId: 'jogador-1', rodada: 1 } as const

  it('estado inicial sem vez, sem rodada e sem mapa aprendido', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.jogadorAtivoId).toBeNull()
    expect(inicial.rodada).toBeNull()
    expect(inicial.movimentouNoTurno).toBe(false)
    expect(inicial.posicaoConfirmadaNoTurno).toBe(false)
    expect(inicial.peaoPorJogador).toEqual({})
  })

  it('TURNO_INICIADO seta jogadorAtivoId/rodada e reseta a fase do turno', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1)
    expect(estado.jogadorAtivoId).toBe('jogador-1')
    expect(estado.rodada).toBe(1)
    expect(estado.movimentouNoTurno).toBe(false)
    expect(estado.posicaoConfirmadaNoTurno).toBe(false)

    // Fase suja de um turno anterior é zerada pelo próximo TURNO_INICIADO.
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
    expect(estado.movimentouNoTurno).toBe(true)
    estado = reduzirEvento(estado, { type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 1 })
    expect(estado.jogadorAtivoId).toBe('jogador-2')
    expect(estado.movimentouNoTurno).toBe(false)
    expect(estado.posicaoConfirmadaNoTurno).toBe(false)
  })

  it('PEAO_MOVIDO dentro do turno marca movimentouNoTurno; fora de turno não marca', () => {
    // Sem vez ativa: movimento de outro contexto não marca a fase.
    const foraDeTurno = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
    expect(foraDeTurno.movimentouNoTurno).toBe(false)

    // Dentro da janela do turno: marca a fase.
    const dentro = reduzirEvento(
      reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1),
      {
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'inicial-1',
        pecaIdPara: 'reta-1',
        celula: { linha: 2, coluna: 3 },
      },
    )
    expect(dentro.movimentouNoTurno).toBe(true)
  })

  it('POSICAO_CONFIRMADA marca posicaoConfirmadaNoTurno', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1)
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      pecaId: 'reta-1',
    })
    expect(estado.posicaoConfirmadaNoTurno).toBe(true)
  })

  it('TURNO_ENCERRADO limpa a vez (limpeza mínima) e preserva rodada e mapa', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1)
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    estado = reduzirEvento(estado, { type: 'TURNO_ENCERRADO', jogadorId: 'jogador-1' })
    expect(estado.jogadorAtivoId).toBeNull()
    expect(estado.movimentouNoTurno).toBe(false)
    expect(estado.posicaoConfirmadaNoTurno).toBe(false)
    expect(estado.rodada).toBe(1)
    expect(estado.peaoPorJogador).toEqual({ 'jogador-1': 'peao-branco' })
  })

  it('mapa peaoPorJogador é aprendido na janela do turno (posicionado, movido e permanecido)', () => {
    // TURNO_INICIADO(jogador-1) → eventos de peão → atribuídos a jogador-1.
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1)
    estado = reduzirEvento(estado, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    expect(estado.peaoPorJogador['jogador-1']).toBe('peao-branco')

    // Turno de jogador-2: evento atribui o peão dele, preservando o de 1.
    estado = reduzirEvento(estado, { type: 'TURNO_INICIADO', jogadorId: 'jogador-2', rodada: 1 })
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-vermelho',
      pecaIdDe: 'inicial-2',
      pecaIdPara: 'reta-1',
      celula: { linha: 3, coluna: 4 },
    })
    expect(estado.peaoPorJogador['jogador-1']).toBe('peao-branco')
    expect(estado.peaoPorJogador['jogador-2']).toBe('peao-vermelho')

    // PEAO_PERMANECEU também atribui (permanência em turno próprio).
    estado = reduzirEvento(estado, { type: 'TURNO_INICIADO', jogadorId: 'jogador-3', rodada: 2 })
    estado = reduzirEvento(estado, {
      type: 'PEAO_PERMANECEU',
      peaoId: 'peao-azul',
      pecaId: 'inicial-3',
    })
    expect(estado.peaoPorJogador['jogador-3']).toBe('peao-azul')
  })

  it('eventos de peão anteriores ao primeiro TURNO_INICIADO não atribuem mapa', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
    expect(estado.peaoPorJogador).toEqual({})
  })

  it('ERRO_DO_TABULEIRO não altera o estado de turno', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), TURNO_1_J1)
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
    const antes = estado
    estado = reduzirEvento(estado, {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'FORA_DA_VEZ',
      mensagem: 'Não é a sua vez.',
    })
    expect(estado).toBe(antes)
  })
})

describe('snapshot no modelo do cliente — projeção autoritativa (issue #156, PR #189)', () => {
  function snapshotBase(overrides: Partial<EstadoDaPartidaSnapshot> = {}): EstadoDaPartidaSnapshot {
    return {
      tabuleiro: {
        posicionadas: [],
        iniciais: [],
        peoes: [],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        pecasRestantesNaCaixa: 83,
      },
      jogadores: [],
      jogadorAtivoId: 'jogador-1',
      rodada: 2,
      pecaDoInicioDoTurnoId: null,
      posicaoConfirmada: false,
      celulasIluminadas: [],
      estado: 'em_andamento',
      // Explícito: o spread de overrides é Partial e pode não cobrir o campo,
      // deixando `resultado` undefined na cópia (quebra o typecheck em tsc -b).
      resultado: null,
      geradoresLigados: [],
      cartaoDeAcessoObtido: false,
      ...overrides,
    }
  }

  it('aplicarSnapshot mapeia recebidas à forma #138 com a orientação da peça sorteada', () => {
    const snapshot = snapshotBase({
      tabuleiro: {
        posicionadas: [],
        iniciais: [],
        peoes: [],
        recebidas: [
          {
            recebidaId: 'r1',
            pecaId: 'reta-1',
            tipo: 'reta',
            orientacao: 90,
            vaga: null,
            celulaAlvo: null,
          },
        ],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        pecasRestantesNaCaixa: 83,
      },
    })
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    // PendenciaDaPecaSorteada + orientacao copiada: a bandeja reexibe a
    // corrente com a rotação correta ao recarregar (issue #143).
    expect(estado.recebidasPendentes).toEqual([
      {
        recebidaId: 'r1',
        pecaId: 'reta-1',
        tipoDaPeca: 'reta',
        vaga: null,
        celulaAlvo: null,
        orientacao: 90,
      },
    ])
    expect(estado.pecasDeRecebimento['reta-1']).toBe('reta')
  })

  it('aplicarSnapshot reconstrói as iniciais da mesa a partir do snapshot (issue #143)', () => {
    const snapshot = snapshotBase({
      tabuleiro: {
        posicionadas: [
          { pecaId: 'inicial-1', tipo: 'inicial', orientacao: 0, celula: { linha: 3, coluna: 3 } },
        ],
        iniciais: [
          { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
          { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 90 },
        ],
        peoes: [],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: null,
        peaoSelecionadoId: null,
        // Conteúdo da Caixa não é alvo deste teste (#143); baseline neutra.
        pecasRestantesNaCaixa: 83,
      },
    })
    // O seed local (4 iniciais, orientação 0) é SUBSTITUÍDO pela autoridade:
    // inicial-1 saiu da mesa (posicionada) e inicial-4 sumiu (rejeitada no
    // posicionamento de outro jogador — apenas o snapshot governa).
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    expect(estado.iniciais).toEqual([
      { pecaId: 'inicial-2', tipo: 'inicial', orientacao: 0 },
      { pecaId: 'inicial-3', tipo: 'inicial', orientacao: 90 },
    ])
    expect(estado.posicionadas.map((p) => p.pecaId)).toEqual(['inicial-1'])
  })

  it('aplicarSnapshot preserva movimentouNoTurno (late-join no meio do turno)', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'TURNO_INICIADO',
      jogadorId: 'jogador-1',
      rodada: 2,
    })
    estado = reduzirEvento(estado, {
      type: 'PEAO_MOVIDO',
      peaoId: 'peao-branco',
      pecaIdDe: 'inicial-1',
      pecaIdPara: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
    expect(estado.movimentouNoTurno).toBe(true)
    // Snapshot não carrega a fase de movimento: re-sincronizar não pode
    // sobrescrevê-la (senão o cliente perde 'confirmar' na fase do turno).
    const reaplicado = aplicarSnapshot(estado, snapshotBase())
    expect(reaplicado.movimentouNoTurno).toBe(true)
    // posicaoConfirmada vem do snapshot (o campo existe na wire).
    expect(reaplicado.posicaoConfirmadaNoTurno).toBe(false)
  })

  it('aplicarSnapshot com posição confirmada fixa movimentouNoTurno (revisão #199)', () => {
    // A wire não transporta `movimentouNoTurno`, mas confirmar pressupõe
    // movimento: reconectar com posicaoConfirmada=true sobre um local que
    // ainda não aprendeu o movimento (late-join/reload) não pode resultar no
    // estado contraditório — o guard âmbar pós-confirmação derivaria dele.
    const estado = criarEstadoInicialDoCliente()
    expect(estado.movimentouNoTurno).toBe(false)
    const reaplicado = aplicarSnapshot(
      estado,
      snapshotBase({ posicaoConfirmada: true }),
    )
    expect(reaplicado.posicaoConfirmadaNoTurno).toBe(true)
    expect(reaplicado.movimentouNoTurno).toBe(true)
  })
})

describe('objetivos globais no modelo do cliente — baseline + derivação (issue #145)', () => {
  function snapshotObjetivos(
    opts: {
      pecasRestantes?: number
      geradores?: readonly string[]
      cartao?: boolean
      posicionadas?: readonly PecaPosicionadaNoSnapshot[]
      pecaEmManipulacaoId?: string | null
    } = {},
  ): EstadoDaPartidaSnapshot {
    return {
      tabuleiro: {
        posicionadas: opts.posicionadas ?? [],
        iniciais: [],
        peoes: [],
        recebidas: [],
        pecaSelecionadaId: null,
        pecaEmManipulacaoId: opts.pecaEmManipulacaoId ?? null,
        peaoSelecionadoId: null,
        pecasRestantesNaCaixa: opts.pecasRestantes ?? 57,
      },
      jogadores: [],
      jogadorAtivoId: 'jogador-1',
      rodada: 2,
      pecaDoInicioDoTurnoId: null,
      posicaoConfirmada: false,
      celulasIluminadas: [],
      estado: 'em_andamento',
      resultado: null,
      geradoresLigados: opts.geradores ?? [],
      cartaoDeAcessoObtido: opts.cartao ?? false,
    }
  }

  function comBaseline(opts: Parameters<typeof snapshotObjetivos>[0] = {}) {
    return aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotObjetivos(opts))
  }

  it('seed do modelo: contagem oculta (null) e chips zerados', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.pecasRestantesNaCaixa).toBeNull()
    expect(inicial.geradoresLigados).toEqual([])
    expect(inicial.cartaoDeAcessoObtido).toBe(false)
  })

  it('PECA_SORTEADA inédito decrementa a contagem; id repetido não decrementa 2×', () => {
    let estado = comBaseline({ pecasRestantes: 57 })
    estado = reduzirEvento(estado, {
      type: 'PECA_SORTEADA',
      pecaId: 'reta-1',
      tipoDaPeca: 'reta',
      orientacao: 0,
    })
    expect(estado.pecasRestantesNaCaixa).toBe(56)
    // Mesmo pecaId reentregue (repetição do broadcast): o gate de
    // pecasDeRecebimento segura o regrava E o segundo decremento.
    estado = reduzirEvento(estado, {
      type: 'PECA_SORTEADA',
      pecaId: 'reta-1',
      tipoDaPeca: 'reta',
      orientacao: 0,
    })
    expect(estado.pecasRestantesNaCaixa).toBe(56)
  })

  it('PECA_SORTEADA sem baseline do snapshot mantém a contagem null', () => {
    const estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_SORTEADA',
      pecaId: 'reta-1',
      tipoDaPeca: 'reta',
      orientacao: 0,
    })
    // Nunca se conta a partir do nada: a HUD permanece oculta até o snapshot.
    expect(estado.pecasRestantesNaCaixa).toBeNull()
  })

  it('contagem da Caixa tem clamp em 0 (nunca negativa)', () => {
    let estado = comBaseline({ pecasRestantes: 0 })
    estado = reduzirEvento(estado, {
      type: 'PECA_SORTEADA',
      pecaId: 't-1',
      tipoDaPeca: 'T',
      orientacao: 0,
    })
    expect(estado.pecasRestantesNaCaixa).toBe(0)
  })

  it('POSICAO_CONFIRMADA de gerador liga com dedupe por pecaId', () => {
    let estado = comBaseline({
      posicionadas: [
        { pecaId: 'gerador-1', tipo: 'gerador', orientacao: 0, celula: { linha: 1, coluna: 2 } },
      ],
    })
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      pecaId: 'gerador-1',
    })
    expect(estado.geradoresLigados).toEqual(['gerador-1'])
    // Reconfirmar o MESMO gerador não conta 2× (dedupe por id, espelho do
    // gate `includes` do engine).
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      pecaId: 'gerador-1',
    })
    expect(estado.geradoresLigados).toEqual(['gerador-1'])
    // Um segundo gerador (chegando por deltas) incrementa.
    estado = reduzirEventos(estado, [
      { type: 'PECA_SORTEADA', pecaId: 'gerador-2', tipoDaPeca: 'gerador', orientacao: 0 },
      { type: 'PECA_POSICIONADA', pecaId: 'gerador-2', celula: { linha: 5, coluna: 2 }, orientacao: 0 },
      { type: 'POSICAO_CONFIRMADA', jogadorId: 'jogador-2', peaoId: 'peao-vermelho', pecaId: 'gerador-2' },
    ])
    expect(estado.geradoresLigados).toEqual(['gerador-1', 'gerador-2'])
  })

  it('POSICAO_CONFIRMADA resolve tipo via pecasDeRecebimento quando a peça saiu do tabuleiro', () => {
    let estado = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_SORTEADA',
      pecaId: 'gerador-9',
      tipoDaPeca: 'gerador',
      orientacao: 0,
    })
    // A peça não está em `posicionadas` (fallback do derivador).
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      pecaId: 'gerador-9',
    })
    expect(estado.geradoresLigados).toEqual(['gerador-9'])
  })

  it('cartão de acesso é monotônico: sala_do_diretor obtém e confirmações seguintes não revogam', () => {
    let estado = comBaseline({
      posicionadas: [
        { pecaId: 'sala-do-diretor-1', tipo: 'sala_do_diretor', orientacao: 0, celula: { linha: 4, coluna: 4 } },
        { pecaId: 'reta-1', tipo: 'reta', orientacao: 0, celula: { linha: 4, coluna: 5 } },
      ],
    })
    expect(estado.cartaoDeAcessoObtido).toBe(false)
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-1',
      peaoId: 'peao-branco',
      pecaId: 'sala-do-diretor-1',
    })
    expect(estado.cartaoDeAcessoObtido).toBe(true)
    // Confirmar peça de caminho depois não revoga (e não conta gerador).
    estado = reduzirEvento(estado, {
      type: 'POSICAO_CONFIRMADA',
      jogadorId: 'jogador-2',
      peaoId: 'peao-vermelho',
      pecaId: 'reta-1',
    })
    expect(estado.cartaoDeAcessoObtido).toBe(true)
    expect(estado.geradoresLigados).toEqual([])
  })

  it('ordem do lote: posicao_confirmada antes de limpeza mantém a conquista', () => {
    let estado = comBaseline({
      posicionadas: [
        { pecaId: 'gerador-1', tipo: 'gerador', orientacao: 0, celula: { linha: 1, coluna: 2 } },
      ],
    })
    // Ordem real do lote do engine: posicao_confirmada é o PRIMEIRO evento e
    // a limpeza chega depois no mesmo lote — o tipo precisa ser resolvido no
    // estado anterior, com a peça ainda em posicionadas.
    estado = reduzirEventos(estado, [
      { type: 'POSICAO_CONFIRMADA', jogadorId: 'jogador-1', peaoId: 'peao-branco', pecaId: 'gerador-1' },
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['gerador-1'] },
    ])
    expect(estado.geradoresLigados).toEqual(['gerador-1'])
    // A peça saiu do tabuleiro local, mas a conquista sobrevive.
    expect(estado.posicionadas).toEqual([])
  })

  it('aplicarSnapshot substitui a baseline local (autoridade, sem merge)', () => {
    let estado = comBaseline({
      pecasRestantes: 50,
      geradores: ['gerador-1', 'gerador-2'],
      cartao: true,
    })
    estado = reduzirEvento(estado, {
      type: 'PECA_SORTEADA',
      pecaId: 'cruz-1',
      tipoDaPeca: 'cruz',
      orientacao: 0,
    })
    expect(estado.pecasRestantesNaCaixa).toBe(49)
    // Reconexão com snapshot do engine: substitui, não acumula decremento nem
    // faz merge de listas.
    const reconciliado = aplicarSnapshot(
      estado,
      snapshotObjetivos({ pecasRestantes: 83, geradores: [], cartao: false }),
    )
    expect(reconciliado.pecasRestantesNaCaixa).toBe(83)
    expect(reconciliado.geradoresLigados).toEqual([])
    expect(reconciliado.cartaoDeAcessoObtido).toBe(false)
  })

  it('AC1: especial encaixa sem janela de Manipulação; peça de caminho abre (regressão)', () => {
    const gerador = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_SORTEADA', pecaId: 'gerador-1', tipoDaPeca: 'gerador', orientacao: 0 },
      { type: 'PECA_POSICIONADA', pecaId: 'gerador-1', celula: { linha: 2, coluna: 2 }, orientacao: 0 },
    ])
    expect(gerador.posicionadas.find((p) => p.pecaId === 'gerador-1')?.tipo).toBe('gerador')
    expect(gerador.pecaEmManipulacaoId).toBeNull()

    const salaMedica = reduzirEventos(criarEstadoInicialDoCliente(), [
      { type: 'PECA_SORTEADA', pecaId: 'sala-medica-1', tipoDaPeca: 'sala_medica', orientacao: 0 },
      { type: 'PECA_POSICIONADA', pecaId: 'sala-medica-1', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
    ])
    expect(salaMedica.posicionadas.find((p) => p.pecaId === 'sala-medica-1')?.tipo).toBe('sala_medica')
    expect(salaMedica.pecaEmManipulacaoId).toBeNull()

    // Regressão ST-09: peça de caminho da Reserva abre a janela como antes.
    const caminho = reduzirEvento(criarEstadoInicialDoCliente(), {
      type: 'PECA_POSICIONADA',
      pecaId: 'reta-1',
      celula: { linha: 3, coluna: 4 },
      orientacao: 0,
    })
    expect(caminho.pecaEmManipulacaoId).toBe('reta-1')
  })
})
