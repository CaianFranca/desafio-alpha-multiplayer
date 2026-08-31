import {
  deveSuprimirCliquePorArrasto,
  haRecebidasPendentes,
  mapearCliqueNaPecaInicial,
  mapearCliqueNoPeao,
  mapearEscolhaDeTipoDaRecebida,
  mapearEventoPeaoParaFeedback,
  mapearGirarRecebida,
  mapearMovimentacao,
  mapearPermanencia,
  mapearPosicionarRecebida,
  tiposDeCaminhoDisponiveisNaReserva,
} from '../web/src/game/tabuleiro/interacaoPeoes'
import { FLASH_BRANCO, FLASH_VERMELHO } from '../web/src/game/tabuleiro/interacao'
import type {
  EstadoInteracaoPeoes,
  EventoDoCicloDoPeao,
} from '../web/src/game/tabuleiro/interacaoPeoes'
import { criarEstadoExibicaoMock } from '../web/src/game/tabuleiro/mockExibicao'
import type { Celula, PecaPosicionada, PeaoDaExibicao } from '../web/src/game/tabuleiro/contrato'
import type { ErroDoTabuleiroEvento } from '@flicker/shared'

// ── Helpers de estado ──

function pecaPosicionada(
  pecaId: string,
  tipo: PecaPosicionada['tipo'],
  orientacao: PecaPosicionada['orientacao'],
  linha: number,
  coluna: number,
): PecaPosicionada {
  return { pecaId, tipo, orientacao, celula: { linha, coluna } }
}

function peao(peaoId: string, celula: Celula | null): PeaoDaExibicao {
  return { peaoId, cor: 'branco', celula }
}

const INICIAL = { linha: 3, coluna: 3 }

function estadoBase(opts: Partial<EstadoInteracaoPeoes> = {}): EstadoInteracaoPeoes {
  return {
    peoes: [peao('peao-branco', null), peao('peao-vermelho', null)],
    posicionadas: [pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)],
    recebidasPendentes: [],
    peaoSelecionadoId: null,
    pecaSelecionadaId: null,
    reserva: [
      { pecaId: 'reta-1', tipo: 'reta' },
      { pecaId: 't-1', tipo: 'T' },
      { pecaId: 'cruz-1', tipo: 'cruz' },
    ],
    ...opts,
  }
}

function comPeaoSelecionado(
  posicionadas: readonly PecaPosicionada[],
  opts: Partial<EstadoInteracaoPeoes> = {},
): EstadoInteracaoPeoes {
  return {
    ...estadoBase({ posicionadas, ...opts }),
    peoes: [
      peao('peao-1-branco', INICIAL),
      peao('peao-2-vermelho', null),
      peao('peao-3-azul', null),
      peao('peao-4-amarelo', null),
    ],
    peaoSelecionadoId: 'peao-1-branco',
  }
}

function estadoComMock(opts: Partial<EstadoInteracaoPeoes> = {}): EstadoInteracaoPeoes {
  const mock = criarEstadoExibicaoMock()
  return {
    peoes: mock.peoes,
    posicionadas: mock.posicionadas,
    recebidasPendentes: [],
    peaoSelecionadoId: 'peao-1-branco',
    pecaSelecionadaId: null,
    reserva: [],
    ...opts,
  }
}

describe('interação do ciclo do peão — mapeamento puro (issue #92)', () => {
  // ── AC 1: clique simples seleciona; peão posicionado dispara o comando ──

  it('clique simples no peão seleciona (emite SELECIONAR_PEAO)', () => {
    const estado = estadoBase()
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' },
    })
  })

  it('selecionar peão posicionado dispara o comando (SELECIONAR_PEAO; RECEBIMENTO_GERADO é reação do servidor)', () => {
    const estado = estadoBase({
      peoes: [peao('peao-branco', INICIAL), peao('peao-vermelho', null)],
    })
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' },
    })
  })

  it('peão sobre a Mesa também é selecionável (mesmo comando)', () => {
    const estado = estadoBase()
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-vermelho' },
    })
  })

  it('clique no próprio peão já selecionado emite PERMANECER (AC 5)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      peoes: [peao('peao-branco', INICIAL), peao('peao-vermelho', null)],
    })
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toEqual({
      tipo: 'comando',
      comando: { type: 'PERMANECER', peaoId: 'peao-branco' },
    })
  })

  it('peão inexistente não reage (null)', () => {
    expect(mapearCliqueNoPeao(estadoBase(), 'peao-inexistente')).toBeNull()
  })

  // ── AC 2: primeiro posicionamento sobre a Peça Inicial ──

  it('clique na Peça Inicial posiciona o peão selecionado (POSICIONAR_PEAO)', () => {
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(mapearCliqueNaPecaInicial(estado, INICIAL)).toEqual({
      type: 'POSICIONAR_PEAO',
      peaoId: 'peao-branco',
      celula: INICIAL,
    })
  })

  it('cliques em outras peças não emitem o comando de posicionamento inicial', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('reta-1', 'reta', 90, 3, 4),
      ],
    })
    expect(mapearCliqueNaPecaInicial(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('célula sem peça não emite o comando de posicionamento inicial', () => {
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(mapearCliqueNaPecaInicial(estado, { linha: 5, coluna: 5 })).toBeNull()
  })

  it('sem peão selecionado não emite o primeiro posicionamento', () => {
    expect(mapearCliqueNaPecaInicial(estadoBase(), INICIAL)).toBeNull()
  })

  it('peão já posicionado (primeiro posicionamento concluído) não reposiciona', () => {
    const estado = estadoBase({
      peoes: [peao('peao-branco', INICIAL)],
      peaoSelecionadoId: 'peao-branco',
    })
    expect(mapearCliqueNaPecaInicial(estado, INICIAL)).toBeNull()
  })

  // ── AC 3: escolha do tipo de cada Recebida a partir da Reserva ──

  it('escolher o tipo de uma Recebida pendente emite ESCOLHER_TIPO_DA_PECA_RECEBIDA', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        { recebidaId: 'recebida-leste', bordaGeradora: 'leste', celulaAlvo: { linha: 3, coluna: 4 } },
      ],
    })
    expect(mapearEscolhaDeTipoDaRecebida(estado, 'recebida-norte', 'reta')).toEqual({
      type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA',
      recebidaId: 'recebida-norte',
      tipoDaPeca: 'reta',
    })
  })

  it('tipo sem peça disponível na Reserva não gera comando (null)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
      reserva: [
        { pecaId: 'reta-1', tipo: 'reta' },
        { pecaId: 't-1', tipo: 'T' },
      ],
    })
    expect(mapearEscolhaDeTipoDaRecebida(estado, 'recebida-norte', 'cruz')).toBeNull()
    expect(mapearEscolhaDeTipoDaRecebida(estado, 'recebida-norte', 'reta')).not.toBeNull()
  })

  it('Recebida inexistente não gera comando', () => {
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(mapearEscolhaDeTipoDaRecebida(estado, 'recebida-inexistente', 'T')).toBeNull()
  })

  it('escolha sem peão em sequência não gera comando', () => {
    const estado = estadoBase()
    expect(mapearEscolhaDeTipoDaRecebida(estado, 'recebida-norte', 'reta')).toBeNull()
  })

  it('tipos ofertados derivam da Reserva (dedupe, ordem canônica reta→T→cruz)', () => {
    expect(
      tiposDeCaminhoDisponiveisNaReserva([
        { pecaId: 'a', tipo: 'inicial' },
        { pecaId: 'b', tipo: 'T' },
        { pecaId: 'c', tipo: 'reta' },
        { pecaId: 'd', tipo: 'cruz' },
        { pecaId: 'e', tipo: 'cruz' },
      ]),
    ).toEqual(['reta', 'T', 'cruz'])
    expect(tiposDeCaminhoDisponiveisNaReserva([{ pecaId: 'a', tipo: 'inicial' }])).toEqual([])
  })

  // ── AC 4: girar e posicionar a Recebida na célula vizinha, orientação livre ──

  it('girar a Recebida emite GIRAR_PECA nos dois sentidos (orientação livre)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'reta-2',
    })
    expect(mapearGirarRecebida(estado, 'horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-2',
      sentido: 'horario',
    })
    expect(mapearGirarRecebida(estado, 'anti_horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-2',
      sentido: 'anti_horario',
    })
  })

  it('posicionar a Recebida emite POSICIONAR_PECA para a célula vizinha correspondente', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
      pecaSelecionadaId: 'reta-2',
    })
    // A célula-alvo fixada no Recebimento é a vizinha correspondente.
    expect(mapearPosicionarRecebida(estado, { linha: 2, coluna: 3 })).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-2',
      celula: { linha: 2, coluna: 3 },
    })
  })

  it('posicionar em célula que não é alvo de nenhuma Recebida pendente não reage (null)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
      pecaSelecionadaId: 'reta-2',
    })
    expect(mapearPosicionarRecebida(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('girar/posicionar sem Recebida em foco não gera comando', () => {
    const estado = estadoBase()
    expect(mapearGirarRecebida(estado, 'horario')).toBeNull()
    expect(mapearPosicionarRecebida(estado, { linha: 2, coluna: 3 })).toBeNull()
  })

  // ── AC 5: permanência no próprio peão/peça sob ele; movimentação na vizinha conectada ──

  it('clique no próprio peão emite PERMANECER', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    expect(mapearPermanencia(estado, INICIAL)).toEqual({
      type: 'PERMANECER',
      peaoId: 'peao-1-branco',
    })
  })

  it('clique na Peça sob o peão emite PERMANECER (mesma célula do peão)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    // Clique no mesh da Peça: mesma célula (3,3) da Peça sob o peão.
    expect(mapearPermanencia(estado, { linha: 3, coluna: 3 })).toEqual({
      type: 'PERMANECER',
      peaoId: 'peao-1-branco',
    })
  })

  it('clique fora da célula do peão não emite permanência (null)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    expect(mapearPermanencia(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('peão selecionado ainda sobre a Mesa não emite permanência (null)', () => {
    // estadoBase(): peao-branco está com celula null (sobre a Mesa).
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toBeNull()
  })

  it('com Recebidas pendentes, permanência não emite comando (tudo posicionado antes)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    expect(mapearPermanencia(estado, INICIAL)).toBeNull()
    expect(mapearCliqueNoPeao(estado, 'peao-1-branco')).toBeNull()
  })

  it('clique em Peça vizinha conectada destacada emite MOVER_PEAO', () => {
    // Cenário do mock: inicial(3,3)@0 conecta com reta(3,4)@90 → destino destacado.
    const estado = estadoComMock()
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toEqual({
      type: 'MOVER_PEAO',
      peaoId: 'peao-1-branco',
      celula: { linha: 3, coluna: 4 },
    })
  })

  it('clique em Peça não conectada não reage (null)', () => {
    const estado = estadoComMock()
    // cruz(3,5) não é vizinha ortogonal da inicial(3,3).
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 5 })).toBeNull()
  })

  it('destino conectado ocupado por outro peão não gera movimentação (null)', () => {
    const mock = criarEstadoExibicaoMock()
    const estado = estadoComMock({
      peoes: [
        ...mock.peoes.filter((p) => p.peaoId !== 'peao-3-azul'),
        peao('peao-3-azul', { linha: 3, coluna: 4 }),
      ],
    })
    // reta(3,4) conectada, mas ocupada pelo peão azul → não é destino válido.
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('com Recebidas pendentes, movimentação não emite comando (tudo posicionado antes)', () => {
    const estado = estadoComMock({
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    // reta(3,4) é vizinha conectada, mas a pendência bloqueia mover (US 15).
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('movimentação sem peão em sequência não reage (null)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    const semSelecao: EstadoInteracaoPeoes = { ...estado, peaoSelecionadoId: null }
    expect(mapearMovimentacao(semSelecao, { linha: 3, coluna: 3 })).toBeNull()
    expect(mapearPermanencia(semSelecao, { linha: 3, coluna: 3 })).toBeNull()
  })

  // ── AC 6: pendências bloqueiam outro peão com rejeição local ──

  it('com Recebidas pendentes, clicar em outro peão não emite comando e rejeita (flash vermelho)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    expect(haRecebidasPendentes(estado)).toBe(true)
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'rejeicao',
      rejeicao: { motivo: 'pendencia_nao_resolvida', feedback: FLASH_VERMELHO },
    })
  })

  it('com Recebidas pendentes, clicar no próprio peão não emite comando (permanência exige tudo posicionado)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        { recebidaId: 'recebida-norte', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toBeNull()
  })

  it('sem pendências o bloqueio não dispara', () => {
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(haRecebidasPendentes(estado)).toBe(false)
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-vermelho' },
    })
  })

  // ── AC 7: feedback branco (aprovação) vs vermelho (rejeição), distinto ──

  it('eventos de sucesso do ciclo produzem flash branco perceptível', () => {
    const eventosDeSucesso: EventoDoCicloDoPeao[] = [
      { type: 'PEAO_SELECIONADO', peaoId: 'peao-1' },
      {
        type: 'RECEBIMENTO_GERADO',
        recebidas: [
          { recebidaId: 'r1', bordaGeradora: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        ],
      },
      { type: 'PEAO_POSICIONADO', peaoId: 'peao-1', pecaId: 'inicial-1', celula: INICIAL },
      { type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO', recebidaId: 'r1', pecaId: 'reta-2', tipoDaPeca: 'reta' },
      { type: 'PEAO_MOVIDO', peaoId: 'peao-1', pecaIdDe: 'inicial-1', pecaIdPara: 'reta-2', celula: { linha: 3, coluna: 4 } },
      { type: 'PEAO_PERMANECEU', peaoId: 'peao-1', pecaId: 'inicial-1' },
      { type: 'PECA_POSICIONADA', pecaId: 'reta-2', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_GIRADA', pecaId: 'reta-2', orientacaoAnterior: 0, orientacao: 90, sentido: 'horario' },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'reta-2' },
    ]
    for (const evento of eventosDeSucesso) {
      const flash = mapearEventoPeaoParaFeedback(evento)
      expect(flash).toBe(FLASH_BRANCO)
      expect(flash.cor).toBe('branco')
      expect(flash.hex).toBe('#ffffff')
    }
  })

  it('rejeição do servidor produz flash vermelho distinto do branco', () => {
    const erro: ErroDoTabuleiroEvento = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'PENDENCIA_NAO_RESOLVIDA',
      mensagem: 'Há Peças Recebidas pendentes.',
    }
    const flashVermelho = mapearEventoPeaoParaFeedback(erro)
    const flashBranco = mapearEventoPeaoParaFeedback({ type: 'PEAO_SELECIONADO', peaoId: 'peao-1' })

    expect(flashVermelho).toBe(FLASH_VERMELHO)
    expect(flashVermelho.cor).toBe('vermelho')
    expect(flashVermelho.hex).toBe('#ff3b30')
    expect(flashVermelho.duracaoMs).toBeGreaterThan(flashBranco.duracaoMs)
    expect(flashVermelho.hex).not.toBe(flashBranco.hex)
    expect(flashVermelho.cor).not.toBe(flashBranco.cor)
    expect(FLASH_VERMELHO.motivo).not.toBe(FLASH_BRANCO.motivo)
  })

  // ── AC 8: arrasto reservado à câmera, sem conflito com o clique simples ──

  it('arrasto abaixo do limiar não suprime clique; acima suprime (reuso de deveSuprimirCliquePorArrasto)', () => {
    // LIMIAR_ARRASTO_PX = 6 (cameraLimites.ts:11), reusado do módulo do ciclo.
    expect(deveSuprimirCliquePorArrasto(0, 0)).toBe(false)
    expect(deveSuprimirCliquePorArrasto(5, 0)).toBe(false)
    expect(deveSuprimirCliquePorArrasto(6, 0)).toBe(true)
    expect(deveSuprimirCliquePorArrasto(0, 6)).toBe(true)
    expect(deveSuprimirCliquePorArrasto(10, 10)).toBe(true)
  })

  it('clique simples sem arrasto engatado permanece mapeado; arrasto não gera comando', () => {
    // Simula guarda na camada de input: se suprime, não chama mapeadores.
    const suprime = deveSuprimirCliquePorArrasto(10, 0)
    expect(suprime).toBe(true)
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    const comandoSeNaoSuprimido = mapearCliqueNaPecaInicial(estado, INICIAL)
    expect(comandoSeNaoSuprimido).not.toBeNull()
    const comandoComSupressao = suprime ? null : comandoSeNaoSuprimido
    expect(comandoComSupressao).toBeNull()
  })
})