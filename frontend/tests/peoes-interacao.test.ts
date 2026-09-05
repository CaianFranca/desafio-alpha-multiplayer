import {
  deveSuprimirCliquePorArrasto,
  cicloAtivo,
  despacharCliqueDeCelula,
  despacharCliqueNaPecaDaBandeja,
  ehComandoDePeao,
  haRecebidasPendentes,
  mapearCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaMesa,
  mapearCliqueNaPecaInicial,
  mapearCliqueNoPeao,
  mapearDesselecaoDePeao,
  mapearEscolhaDeVagaDaRecebida,
  mapearGirarRecebida,
  mapearMovimentacao,
  mapearPermanencia,
  mapearPosicionarRecebida,
  peaoSobreAMesa,
  podeSelecionarPeao,
  puxadaVigenteNaBandeja,
  rotearCliqueDeCelula,
  vagasDisponiveisDoPeao,
} from '../web/src/game/tabuleiro/interacaoPeoes'
import type { PendenciaNoCliente } from '../web/src/game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../web/src/game/tabuleiro/interacaoPeoes'
import { chaveDeComandoPendente, consumirAck } from '../web/src/game/tabuleiro/pendentes'
import { motivoDeRecusaDoEvento } from '../web/src/components/partida/somDeRecusa'
import type { EventoDoCanalDaPartida } from '../web/src/hooks/usePartidaWebSocket'
import type { Celula, PecaPosicionada, PeaoDaExibicao } from '../web/src/game/tabuleiro/contrato'
import { criarEstadoExibicaoMock } from './helpers/mockExibicao'
import type { EstadoInteracaoTabuleiro } from '../web/src/game/tabuleiro/interacao'
import type { BordaCardinal, ErroDoTabuleiroEvento } from '@flicker/shared'

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

/**
 * Pendência na forma sorteada (#138): o wire já traz pecaId + tipoDaPeca; a
 * vaga e a célula-alvo são fixadas pela escolha sequencial (issue #143).
 */
function pendencia(
  recebidaId: string,
  pecaId: string,
  tipoDaPeca: 'reta' | 'T' | 'cruz',
  vaga: BordaCardinal | null,
  celulaAlvo: Celula | null,
): PendenciaNoCliente {
  return { recebidaId, pecaId, tipoDaPeca, vaga, celulaAlvo }
}

const INICIAL = { linha: 3, coluna: 3 }

function estadoBase(opts: Partial<EstadoInteracaoPeoes> = {}): EstadoInteracaoPeoes {
  return {
    peoes: [peao('peao-branco', null), peao('peao-vermelho', null)],
    posicionadas: [pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)],
    recebidasPendentes: [],
    peaoSelecionadoId: null,
    pecaSelecionadaId: null,
    posicaoConfirmadaNoTurno: false,
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
    posicaoConfirmadaNoTurno: false,
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
    // Gate "Inicial primeiro" (#249): peao-vermelho exige inicial-2
    // posicionada — o estadoBase só tem a inicial-1 (do branco).
    const estado = estadoBase({
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('inicial-2', 'inicial', 0, 3, 4),
      ],
    })
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-vermelho' },
    })
  })

  it('gate Inicial primeiro: sem a própria Inicial posicionada a seleção é silenciosa (#249)', () => {
    // estadoBase só tem inicial-1: o branco passa, o vermelho não.
    const estado = estadoBase()
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' },
    })
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toBeNull()
    expect(podeSelecionarPeao(estado, 'peao-branco')).toBe(true)
    expect(podeSelecionarPeao(estado, 'peao-vermelho')).toBe(false)
    // Id sem cor inferível não trava além do silêncio existente.
    expect(podeSelecionarPeao(estado, 'peao-sintetico')).toBe(true)
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

  // ── AC 3 (forma #138): escolha da vaga da peça sorteada (sequencial, #143) ──

  it('vagas disponíveis do peão selecionado: bordas abertas com vizinha vazia (ordem canônica)', () => {
    // inicial(3,3)@0 abre norte/leste; vizinhas (2,3) e (3,4) vazias.
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    expect(vagasDisponiveisDoPeao(estado)).toEqual([
      { borda: 'norte', celula: { linha: 2, coluna: 3 } },
      { borda: 'leste', celula: { linha: 3, coluna: 4 } },
    ])
  })

  it('vagas excluem borda já escolhida por outra pendência (escolha sequencial #143)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 }),
        pendencia('r2', 't-1', 'T', null, null),
      ],
    })
    expect(vagasDisponiveisDoPeao(estado)).toEqual([
      { borda: 'leste', celula: { linha: 3, coluna: 4 } },
    ])
  })

  it('vagas excluem vizinha ocupada por outra peça', () => {
    const estado = comPeaoSelecionado([
      pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
      pecaPosicionada('reta-9', 'reta', 0, 2, 3),
    ])
    // (2,3) ocupada → só a leste (3,4) resta.
    expect(vagasDisponiveisDoPeao(estado)).toEqual([
      { borda: 'leste', celula: { linha: 3, coluna: 4 } },
    ])
  })

  it('escolher a vaga de uma pendência sem vaga emite ESCOLHER_VAGA_DA_PECA_RECEBIDA', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    expect(mapearEscolhaDeVagaDaRecebida(estado, 'r1', 'norte')).toEqual({
      type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
      recebidaId: 'r1',
      borda: 'norte',
    })
  })

  it('pendência com vaga já definida não aceita nova escolha (null)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 }),
      ],
    })
    expect(mapearEscolhaDeVagaDaRecebida(estado, 'r1', 'leste')).toBeNull()
  })

  it('borda que não é vaga válida não gera comando (null)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    // sul/oeste não são bordas abertas da inicial@0.
    expect(mapearEscolhaDeVagaDaRecebida(estado, 'r1', 'sul')).toBeNull()
  })

  it('pendência inexistente não gera comando', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    expect(mapearEscolhaDeVagaDaRecebida(estado, 'r-inexistente', 'norte')).toBeNull()
  })

  it('escolha de vaga sem peão selecionado não gera comando', () => {
    const estado = estadoBase({
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    expect(mapearEscolhaDeVagaDaRecebida(estado, 'r1', 'norte')).toBeNull()
  })

  // ── AC 4: girar e posicionar a Recebida na célula vizinha, orientação livre ──

  it('girar a Recebida emite GIRAR_PECA nos dois sentidos (orientação livre)', () => {
    // Operação pós-vaga: a pendência tem vaga escolhida e o engine moveu a
    // peça para pecaSelecionadaId (guard #199: peça operável do ciclo).
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        pendencia('r1', 'reta-2', 'reta', 'norte', { linha: 2, coluna: 3 }),
      ],
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

  it('corrente PUXADA sem vaga também é operável (giro na bandeja, fluxo #199)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [pendencia('r1', 'reta-2', 'reta', null, null)],
      recebidaPuxadaId: 'r1',
      pecaSelecionadaId: 'reta-2',
    })
    expect(mapearGirarRecebida(estado, 'horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-2',
      sentido: 'horario',
    })
  })

  it('guard de coerência: com duas pendências, peça divergente não emite comando (#199)', () => {
    // r1: reta-1 travada na vaga norte (alvo 2:3); r2: t-1 sem vaga e SEM
    // pull. Foco em t-1 (divergente do ciclo operável):
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', { linha: 2, coluna: 3 }),
        pendencia('r2', 't-1', 'T', null, null),
      ],
      pecaSelecionadaId: 't-1',
    })
    // Giro de peça intocada (sem vaga, sem pull) → silencioso.
    expect(mapearGirarRecebida(estado, 'horario')).toBeNull()
    // Encaixe do alvo DE r1 com foco em t-1 → match pecaId↔alvo falha.
    expect(mapearPosicionarRecebida(estado, { linha: 2, coluna: 3 })).toBeNull()
    // ...e a peça operável de verdade (foco em reta-1) segue funcionando.
    const coerente: EstadoInteracaoPeoes = { ...estado, pecaSelecionadaId: 'reta-1' }
    expect(mapearGirarRecebida(coerente, 'horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-1',
      sentido: 'horario',
    })
    expect(mapearPosicionarRecebida(coerente, { linha: 2, coluna: 3 })).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'reta-1',
      celula: { linha: 2, coluna: 3 },
    })
  })

  it('posicionar a Recebida emite POSICIONAR_PECA para a célula-alvo da vaga escolhida', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        pendencia('r1', 'reta-2', 'reta', 'norte', { linha: 2, coluna: 3 }),
      ],
      pecaSelecionadaId: 'reta-2',
    })
    // A célula-alvo deriva da vaga escolhida (a vizinha correspondente à borda).
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
        pendencia('r1', 'reta-2', 'reta', 'norte', { linha: 2, coluna: 3 }),
      ],
      pecaSelecionadaId: 'reta-2',
    })
    expect(mapearPosicionarRecebida(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('pendência sem vaga não tem alvo encaixável (null)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [pendencia('r1', 'reta-2', 'reta', null, null)],
      pecaSelecionadaId: 'reta-2',
    })
    expect(mapearPosicionarRecebida(estado, { linha: 2, coluna: 3 })).toBeNull()
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
      tipo: 'comando',
      comando: { type: 'PERMANECER', peaoId: 'peao-1-branco' },
    })
  })

  it('clique na Peça sob o peão emite PERMANECER (mesma célula do peão)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    // Clique no mesh da Peça: mesma célula (3,3) da Peça sob o peão.
    expect(mapearPermanencia(estado, { linha: 3, coluna: 3 })).toEqual({
      tipo: 'comando',
      comando: { type: 'PERMANECER', peaoId: 'peao-1-branco' },
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
        pendencia('r1', 'reta-1', 'reta', null, null),
      ],
    })
    expect(mapearPermanencia(estado, INICIAL)).toBeNull()
    expect(mapearCliqueNoPeao(estado, 'peao-1-branco')).toBeNull()
  })

  it('clique em Peça vizinha conectada destacada emite MOVER_PEAO', () => {
    // Cenário do mock: inicial(3,3)@0 conecta com reta(3,4)@90 → destino destacado.
    const estado = estadoComMock()
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toEqual({
      tipo: 'comando',
      comando: { type: 'MOVER_PEAO', peaoId: 'peao-1-branco', celula: { linha: 3, coluna: 4 } },
    })
  })

  it('clique em Peça não conectada não reage (null)', () => {
    const estado = estadoComMock()
    // cruz(3,5) não é vizinha ortogonal da inicial(3,3).
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 5 })).toBeNull()
  })

  it('destino conectado ocupado por peão NÃO-afetado não gera movimentação (teto 1 em peça comum — espelho do engine)', () => {
    const mock = criarEstadoExibicaoMock()
    const estado = estadoComMock({
      peoes: [
        ...mock.peoes.filter((p) => p.peaoId !== 'peao-3-azul'),
        peao('peao-3-azul', { linha: 3, coluna: 4 }),
      ],
    })
    // reta(3,4) conectada e ocupada pelo peão azul sem estados (afetados
    // vazio): teto 1 atingido → não é destino (mesma regra do engine).
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toBeNull()
  })

  it('destino de RESGATE sobre peão AFETADO emite o mesmo MOVER_PEAO (exceção #171 espelhada; nenhum comando novo no wire)', () => {
    const estado: EstadoInteracaoPeoes = {
      ...estadoBase(),
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('reta-1', 'reta', 90, 3, 4),
      ],
      peoes: [
        peao('peao-1-branco', INICIAL),
        peao('peao-2-vermelho', { linha: 3, coluna: 4 }),
      ],
      peaoSelecionadoId: 'peao-1-branco',
      // Projeção mínima do chamador: vermelho está afetado (Baixa ∨ Medo).
      afetadosPorPeaoId: new Set(['peao-2-vermelho']),
    }
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toEqual({
      tipo: 'comando',
      comando: { type: 'MOVER_PEAO', peaoId: 'peao-1-branco', celula: { linha: 3, coluna: 4 } },
    })
  })

  it('Portão aceita do 2º ao 4º peão e bloqueia no teto 4 (espelho peoes.ts:555-561 / engine termino.test.ts:770)', () => {
    const posicionadas = [
      pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
      pecaPosicionada('portao-1', 'portao_de_saida', 0, 3, 4),
    ]
    const comOcupantes = (quantidade: number): EstadoInteracaoPeoes => ({
      ...estadoBase(),
      posicionadas,
      peoes: [
        peao('peao-1-branco', INICIAL),
        ...Array.from({ length: quantidade }, (_, i) =>
          peao(`peao-x-${i}`, { linha: 3, coluna: 4 }),
        ),
      ],
      peaoSelecionadoId: 'peao-1-branco',
    })
    // 1-3 ocupantes: do 2º ao 4º peão entram como movimento. (com ocupantes
    // ≥ 4 a unidade sintética espelha a regra — com o roster real de 4 peões
    // o 5º não existe no jogo.)
    for (const ocupantes of [1, 2, 3]) {
      expect(mapearMovimentacao(comOcupantes(ocupantes), { linha: 3, coluna: 4 })).toEqual({
        tipo: 'comando',
        comando: { type: 'MOVER_PEAO', peaoId: 'peao-1-branco', celula: { linha: 3, coluna: 4 } },
      })
    }
    // 4 ocupantes sem afetado → teto atingido, destino fora.
    expect(mapearMovimentacao(comOcupantes(4), { linha: 3, coluna: 4 })).toBeNull()
  })

  it('Monstro posicionado conectado não gera movimentação (exclusão absoluta — partida.ts:583-585)', () => {
    const estado: EstadoInteracaoPeoes = {
      ...estadoBase(),
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('vulto-1', 'vulto', 0, 3, 4),
      ],
      peoes: [peao('peao-1-branco', INICIAL)],
      peaoSelecionadoId: 'peao-1-branco',
    }
    // vulto conecta (4 bordas abertas) mas nunca aceita peão: nem mesmo com
    // afetado "em estado artesanal" sob ele.
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toBeNull()
    expect(
      mapearMovimentacao(
        { ...estado, afetadosPorPeaoId: new Set(['peao-fantasma']) },
        { linha: 3, coluna: 4 },
      ),
    ).toBeNull()
  })

  it('com Recebidas pendentes, movimentação não emite comando (tudo posicionado antes)', () => {
    const estado = estadoComMock({
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', null, null),
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

  // ── Guard AC3: alvos válidos são rejeitados com feedback pós-confirmação ──

  const REJEITACAO_CONFIRMADA = {
    tipo: 'rejeicao',
    rejeicao: {
      motivo: 'posicao_confirmada',
    },
  } as const

  it('movimentação em destino conectado pós-confirmação → rejeição âmbar (AC3, review #165)', () => {
    const estado = estadoComMock({ posicaoConfirmadaNoTurno: true })
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 4 })).toEqual(REJEITACAO_CONFIRMADA)
  })

  it('permanência pós-confirmação → rejeição âmbar (AC3, review #165)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      posicaoConfirmadaNoTurno: true,
    })
    expect(mapearPermanencia(estado, INICIAL)).toEqual(REJEITACAO_CONFIRMADA)
  })

  it('clique no próprio peão pós-confirmação → rejeição âmbar, não PERMANECER (AC3)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      posicaoConfirmadaNoTurno: true,
    })
    expect(mapearCliqueNoPeao(estado, 'peao-1-branco')).toEqual(REJEITACAO_CONFIRMADA)
  })

  it('pós-confirmação, alvos inválidos seguem silenciosos (null, sem recusa indevida)', () => {
    const estado = estadoComMock({ posicaoConfirmadaNoTurno: true })
    // cruz(3,5) não é destino conectado → null mesmo com a flag ligada.
    expect(mapearMovimentacao(estado, { linha: 3, coluna: 5 })).toBeNull()
    expect(mapearPermanencia(estado, { linha: 0, coluna: 0 })).toBeNull()
  })

  // ── AC 6: pendências bloqueiam outro peão com rejeição local ──

  it('com Recebidas pendentes, clicar em outro peão não emite comando e rejeita (som de recusa)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', null, null),
      ],
    })
    expect(haRecebidasPendentes(estado)).toBe(true)
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'rejeicao',
      rejeicao: { motivo: 'pendencia_nao_resolvida' },
    })
  })

  it('com Recebidas pendentes, clicar no próprio peão não emite comando (permanência exige tudo posicionado)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', null, null),
      ],
    })
    expect(mapearCliqueNoPeao(estado, 'peao-branco')).toBeNull()
  })

  it('sem pendências o bloqueio não dispara', () => {
    // Gate "Inicial primeiro" (#249): para selecionar o vermelho, a
    // inicial-2 precisa estar posicionada.
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('inicial-2', 'inicial', 0, 3, 4),
      ],
    })
    expect(haRecebidasPendentes(estado)).toBe(false)
    expect(mapearCliqueNoPeao(estado, 'peao-vermelho')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-vermelho' },
    })
  })

  // ── AC 7: recusa com motivo (som) vs aprovação em silêncio (#228) ──

  it('eventos de sucesso do ciclo ficam em silêncio (null — o efeito no tabuleiro basta)', () => {
    const eventosDeSucesso: EventoDoCanalDaPartida[] = [
      { type: 'PEAO_SELECIONADO', peaoId: 'peao-1' },
      {
        type: 'RECEBIMENTO_GERADO',
        recebidas: [pendencia('r1', 'reta-2', 'reta', null, null)],
      },
      { type: 'PEAO_POSICIONADO', peaoId: 'peao-1', pecaId: 'inicial-1', celula: INICIAL },
      {
        type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO',
        recebidaId: 'r1',
        borda: 'norte',
        celulaAlvo: { linha: 2, coluna: 3 },
      },
      { type: 'PEAO_MOVIDO', peaoId: 'peao-1', pecaIdDe: 'inicial-1', pecaIdPara: 'reta-2', celula: { linha: 3, coluna: 4 } },
      { type: 'PEAO_PERMANECEU', peaoId: 'peao-1', pecaId: 'inicial-1' },
      { type: 'PECA_POSICIONADA', pecaId: 'reta-2', celula: { linha: 2, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_GIRADA', pecaId: 'reta-2', orientacaoAnterior: 0, orientacao: 90, sentido: 'horario' },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'reta-2' },
    ]
    for (const evento of eventosDeSucesso) {
      expect(motivoDeRecusaDoEvento(evento)).toBeNull()
    }
  })

  it('PECA_SORTEADA fica em silêncio (a bandeja comunica a peça corrente, #143)', () => {
    expect(
      motivoDeRecusaDoEvento({
        type: 'PECA_SORTEADA',
        pecaId: 'reta-2',
        tipoDaPeca: 'reta',
        orientacao: 0,
      }),
    ).toBeNull()
  })

  it('rejeição por pendência gera motivo específico (issue #118)', () => {
    const erro: ErroDoTabuleiroEvento = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'PENDENCIA_NAO_RESOLVIDA',
      mensagem: 'Há Peças Recebidas pendentes.',
    }
    expect(motivoDeRecusaDoEvento(erro)).toBe('pendencia_nao_resolvida')
    // Aprovação segue em silêncio (distinta da recusa).
    expect(
      motivoDeRecusaDoEvento({ type: 'PEAO_SELECIONADO', peaoId: 'peao-1' }),
    ).toBeNull()
  })

  it('CAIXA_ESGOTADA gera motivo próprio (issue #143)', () => {
    const erro: ErroDoTabuleiroEvento = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'CAIXA_ESGOTADA',
      mensagem: 'A Caixa está vazia.',
    }
    expect(motivoDeRecusaDoEvento(erro)).toBe('caixa_esgotada')
  })

  // ── AC 4: feedback distinto para FORA_DA_VEZ e turnos (issue #118) ──

  it('ação fora da vez gera motivo próprio (distinto do erro de comando, issue #118)', () => {
    const erro: ErroDoTabuleiroEvento = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'FORA_DA_VEZ',
      mensagem: 'Não é a sua vez.',
    }
    const motivo = motivoDeRecusaDoEvento(erro)
    expect(motivo).toBe('fora_da_vez')
    expect(motivo).not.toBe('rejeicao_do_servico')
  })

  it('demais rejeições do servidor geram o motivo genérico (issue #118)', () => {
    const erro: ErroDoTabuleiroEvento = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'MOVIMENTO_INDISPONIVEL',
      mensagem: 'O Peão só se move a partir do turno seguinte.',
    }
    expect(motivoDeRecusaDoEvento(erro)).toBe('rejeicao_do_servico')
  })

  it('abertura e encerramento de turno ficam em silêncio (issue #118)', () => {
    expect(
      motivoDeRecusaDoEvento({
        type: 'TURNO_INICIADO',
        jogadorId: 'jogador-1',
        rodada: 1,
      }),
    ).toBeNull()
    expect(
      motivoDeRecusaDoEvento({ type: 'TURNO_ENCERRADO', jogadorId: 'jogador-1' }),
    ).toBeNull()
  })

  it('Confirmação de Posição fica em silêncio (issue #118)', () => {
    expect(
      motivoDeRecusaDoEvento({
        type: 'POSICAO_CONFIRMADA',
        jogadorId: 'jogador-1',
        peaoId: 'peao-1',
        pecaId: 'reta-2',
      }),
    ).toBeNull()
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

describe('roteador do clique em célula (issue #91; sequência da #143)', () => {
  const VAGA_NORTE = { linha: 2, coluna: 3 }
  const VAGA_LESTE = { linha: 3, coluna: 4 }

  /** Projeção ST-09 do estado de peões (o roteador a usa no fallback). */
  function estadoTabuleiro(estadoPeoes: EstadoInteracaoPeoes): EstadoInteracaoTabuleiro {
    return {
      iniciais: [{ pecaId: 'inicial-2' }, { pecaId: 'inicial-3' }, { pecaId: 'inicial-4' }],
      posicionadas: estadoPeoes.posicionadas,
      pecaSelecionadaId: estadoPeoes.pecaSelecionadaId,
      pecaEmManipulacaoId: null,
    }
  }

  /** Peão selecionado sobre inicial(3,3)@0 com duas pendências sem vaga. */
  function estadoComPendencias(
    opts: Partial<EstadoInteracaoPeoes> = {},
  ): EstadoInteracaoPeoes {
    return comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)], {
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', null, null),
        pendencia('r2', 't-1', 'T', null, null),
      ],
      ...opts,
    })
  }

  // ── Com pendências: pull da bandeja, escolha de vaga na puxada e encaixe ──

  it('clique em vaga disponível SEM peça puxada é silencioso (fluxo #143/revisão #199)', () => {
    const estado = estadoComPendencias()
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_NORTE)).toBeNull()
  })

  it('clique em vaga disponível atribui a vaga à peça PUXADA da bandeja', () => {
    const estado = estadoComPendencias({ recebidaPuxadaId: 'r1' })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_NORTE)).toEqual({
      ciclo: { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', recebidaId: 'r1', borda: 'norte' },
    })
  })

  it('a vaga segue a puxada, não a ordem da lista (sem "primeira sem vaga" automática)', () => {
    // As duas pendências estão sem vaga; a puxada é r2. O roteador contempla
    // R2 — a regra antiga (primeira da lista) morreria aqui com r1.
    const estado = estadoComPendencias({ recebidaPuxadaId: 'r2' })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_NORTE)).toEqual({
      ciclo: { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', recebidaId: 'r2', borda: 'norte' },
    })
  })

  it('pull antigo (pendência já com vaga) não contempla nova vaga — exige novo pull', () => {
    const estado = estadoComPendencias({
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', VAGA_NORTE),
        pendencia('r2', 't-1', 'T', null, null),
      ],
      recebidaPuxadaId: 'r1', // r1 já tem vaga: o pull foi consumido
    })
    // (3,4) é vaga válida para a corrente r2, mas r2 não foi puxada.
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_LESTE)).toBeNull()
  })

  it('após a primeira vaga, a segunda pendência puxada recebe a próxima escolha', () => {
    const estado = estadoComPendencias({
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', VAGA_NORTE),
        pendencia('r2', 't-1', 'T', null, null),
      ],
      recebidaPuxadaId: 'r2',
    })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_LESTE)).toEqual({
      ciclo: { type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', recebidaId: 'r2', borda: 'leste' },
    })
  })

  it('célula-alvo com a peça em foco → POSICIONAR_PECA (encaixe)', () => {
    const estado = estadoComPendencias({
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', VAGA_NORTE),
        pendencia('r2', 't-1', 'T', null, null),
      ],
      pecaSelecionadaId: 'reta-1',
    })
    // (2,3) não é mais vaga disponível (norte escolhida): rota o encaixe.
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_NORTE)).toEqual({
      ciclo: { type: 'POSICIONAR_PECA', pecaId: 'reta-1', celula: VAGA_NORTE },
    })
  })

  it('célula-alvo com foco divergente da pendência → null (coerência)', () => {
    const estado = estadoComPendencias({
      recebidasPendentes: [
        pendencia('r1', 'reta-1', 'reta', 'norte', VAGA_NORTE),
      ],
      pecaSelecionadaId: 't-1',
    })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), VAGA_NORTE)).toBeNull()
  })

  it('célula que não é vaga nem alvo com pendências → null (alvos inválidos não reagem)', () => {
    const estado = estadoComPendencias()
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 0, coluna: 0 })).toBeNull()
  })

  // ── Sem pendências, com peão selecionado: permanecer / mover / posicionar ──

  it('célula do próprio peão → PERMANECER', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    expect(cicloAtivo(estado)).toBe(true)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), INICIAL)).toEqual({
      ciclo: { type: 'PERMANECER', peaoId: 'peao-1-branco' },
    })
  })

  it('destino conectado → MOVER_PEAO', () => {
    const estado = estadoComMock()
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 3, coluna: 4 })).toEqual({
      ciclo: { type: 'MOVER_PEAO', peaoId: 'peao-1-branco', celula: { linha: 3, coluna: 4 } },
    })
  })

  it('destino de RESGATE roteia o mesmo MOVER_PEAO (nenhuma rota nova no roteador)', () => {
    const estado: EstadoInteracaoPeoes = {
      ...estadoBase(),
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('reta-1', 'reta', 90, 3, 4),
      ],
      peoes: [
        peao('peao-1-branco', INICIAL),
        peao('peao-2-vermelho', { linha: 3, coluna: 4 }),
      ],
      peaoSelecionadoId: 'peao-1-branco',
      afetadosPorPeaoId: new Set(['peao-2-vermelho']),
    }
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 3, coluna: 4 })).toEqual({
      ciclo: { type: 'MOVER_PEAO', peaoId: 'peao-1-branco', celula: { linha: 3, coluna: 4 } },
    })
  })

  it('destino conectado pós-confirmação → roteador propaga a rejeição (AC3)', () => {
    const estado = estadoComMock({ posicaoConfirmadaNoTurno: true })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 3, coluna: 4 })).toEqual({
      rejeicao: {
        motivo: 'posicao_confirmada',
      },
    })
  })

  it('peão sobre a Mesa + Peça Inicial clicada → POSICIONAR_PEAO', () => {
    const estado = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    // Ciclo binário (#249): seleção vigente (mesmo sobre a Mesa) é ciclo
    // ativo — o fallback ST-09 fica suprimido; a célula da Inicial posicionada
    // roteia POSICIONAR_PEAO pelo ciclo.
    expect(cicloAtivo(estado)).toBe(true)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), INICIAL)).toEqual({
      ciclo: { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: INICIAL },
    })
  })

  it('peão selecionado, alvo inválido → null (sem reação)', () => {
    const estado = comPeaoSelecionado([pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)])
    // Célula vazia não conectada: não é o próprio peão, não é destino.
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 0, coluna: 0 })).toBeNull()
  })

  // ── Sem ciclo ativo: null (chamador aplica o fallback ST-09) ──

  it('sem pendências e sem peão selecionado → null (fallback ST-09 no chamador)', () => {
    const estado = estadoBase()
    expect(cicloAtivo(estado)).toBe(false)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro(estado), { linha: 5, coluna: 5 })).toBeNull()
  })

  // ── Peças da mesa: clique em Inicial roteia ST-09 (issue #143) ──

  it('clique em Inicial da mesa, sem pendências → SELECIONAR_PECA', () => {
    const estado = estadoBase()
    const tabuleiro = estadoTabuleiro(estado)
    expect(mapearCliqueNaPecaDaMesa(estado, tabuleiro, 'inicial-2')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-2',
    })
  })

  it('clique em Inicial da mesa COM pendências → null (bloqueio local do ciclo, #91/#143)', () => {
    const estado = estadoComPendencias()
    const tabuleiro = estadoTabuleiro(estado)
    expect(mapearCliqueNaPecaDaMesa(estado, tabuleiro, 'inicial-2')).toBeNull()
  })

  it('clique em peça fora das iniciais da mesa → null (roteador valida a identidade)', () => {
    const estado = estadoBase()
    const tabuleiro = estadoTabuleiro(estado)
    expect(mapearCliqueNaPecaDaMesa(estado, tabuleiro, 'reta-9')).toBeNull()
  })

  // ── Guard de comando (cena e espelho despacham pelo mesmo caminho) ──

  it('ehComandoDePeao distingue comando do ciclo do comando do Tabuleiro', () => {
    expect(ehComandoDePeao({ type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(true)
    expect(ehComandoDePeao({ type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(true)
    expect(ehComandoDePeao({ type: 'PERMANECER', peaoId: 'peao-branco' })).toBe(true)
    expect(ehComandoDePeao({ type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA', recebidaId: 'r1', borda: 'norte' })).toBe(true)
    expect(ehComandoDePeao({ type: 'SELECIONAR_PECA', pecaId: 'reta-1' })).toBe(false)
    expect(ehComandoDePeao({ type: 'GIRAR_PECA', pecaId: 'reta-1', sentido: 'horario' })).toBe(false)
  })
})

describe('pull da peça na bandeja (fluxo #143/revisão #199)', () => {
  function pendSemVaga(
    recebidaId: string,
    pecaId: string,
    tipoDaPeca: 'reta' | 'T' | 'cruz' = 'reta',
  ): PendenciaNoCliente {
    return { recebidaId, pecaId, tipoDaPeca, vaga: null, celulaAlvo: null }
  }

  it('clique na corrente da bandeja de slot único puxa a primeira pendência sem vaga', () => {
    // Bandeja de slot único: mesmo com duas pendências, o clique na bandeja
    // SEMPRE resolve a corrente (a primeira sem vaga) — não há fila.
    const estado = estadoBase({
      recebidasPendentes: [
        pendSemVaga('r1', 'reta-1'),
        pendSemVaga('r2', 't-1', 'T'),
      ],
    })
    expect(mapearCliqueNaPecaDaBandeja(estado)).toEqual({ recebidaId: 'r1' })
  })

  it('espectador (donoDoCiclo=false) não puxa: clique silencioso', () => {
    const estado = estadoBase({
      recebidasPendentes: [pendSemVaga('r1', 'reta-1')],
      donoDoCiclo: false,
    })
    expect(mapearCliqueNaPecaDaBandeja(estado)).toBeNull()
  })

  it('re-clique na corrente já puxada é no-op (null)', () => {
    const estado = estadoBase({
      recebidasPendentes: [pendSemVaga('r1', 'reta-1')],
      recebidaPuxadaId: 'r1',
    })
    expect(mapearCliqueNaPecaDaBandeja(estado)).toBeNull()
  })

  it('puxadaVigenteNaBandeja: só a corrente sem vaga puxada conta como vigente', () => {
    // Sem pull → não vigente.
    const semPull = estadoBase({ recebidasPendentes: [pendSemVaga('r1', 'reta-1')] })
    expect(puxadaVigenteNaBandeja(semPull)).toBe(false)
    // Pull na corrente → vigente (fonte única do destaque emissivo, do
    // destaque de vaga e do data-puxada do espelho).
    expect(
      puxadaVigenteNaBandeja({ ...semPull, recebidaPuxadaId: 'r1' }),
    ).toBe(true)
    // Pull antigo: a pendência puxada ganhou vaga — a corrente agora é outra.
    const pullEncaminhado = estadoBase({
      recebidasPendentes: [
        { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta', vaga: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
        pendSemVaga('r2', 't-1', 'T'),
      ],
      recebidaPuxadaId: 'r1',
    })
    expect(puxadaVigenteNaBandeja(pullEncaminhado)).toBe(false)
  })

  it('sem pendência sem vaga não há o que puxar (vaga em aberto não puxa)', () => {
    const estado = estadoBase({
      recebidasPendentes: [
        { recebidaId: 'r1', pecaId: 'reta-1', tipoDaPeca: 'reta', vaga: 'norte', celulaAlvo: { linha: 2, coluna: 3 } },
      ],
    })
    expect(mapearCliqueNaPecaDaBandeja(estado)).toBeNull()
  })

  it('despacharCliqueNaPecaDaBandeja entrega só o pull ao chamador (pull silencioso, #228)', () => {
    const estado = estadoBase({
      recebidasPendentes: [pendSemVaga('r1', 'reta-1')],
    })
    const puxados: string[] = []
    despacharCliqueNaPecaDaBandeja(estado, {
      onPuxar: (id) => puxados.push(id),
    })
    expect(puxados).toEqual(['r1'])
  })

  it('despachar com espectador ou sem corrente não reage (sem pull)', () => {
    const espectador = estadoBase({
      recebidasPendentes: [pendSemVaga('r1', 'reta-1')],
      donoDoCiclo: false,
    })
    const semCorrente = estadoBase()
    let chamou = 0
    despacharCliqueNaPecaDaBandeja(espectador, {
      onPuxar: () => chamou++,
    })
    despacharCliqueNaPecaDaBandeja(semCorrente, { onPuxar: () => chamou++ })
    despacharCliqueNaPecaDaBandeja(null, { onPuxar: () => chamou++ })
    expect(chamou).toBe(0)
  })
})

describe('primeiro turno sem deadlock (issue #249)', () => {
  const CELULA_VAZIA = { linha: 5, coluna: 5 }

  function estadoTabuleiro249(estadoPeoes: EstadoInteracaoPeoes): EstadoInteracaoTabuleiro {
    return {
      iniciais: [{ pecaId: 'inicial-2' }, { pecaId: 'inicial-3' }],
      posicionadas: estadoPeoes.posicionadas,
      pecaSelecionadaId: estadoPeoes.pecaSelecionadaId,
      pecaEmManipulacaoId: null,
    }
  }

  /**
   * Despacha o clique na célula pelos dois canais e captura os comandos
   * emitidos (tabuleiro via fallback ST-09, peão via ciclo). Fonte única dos
   * testes #249 — evita repetir o objeto de despacho em cada caso.
   */
  function capturarDespacho(estadoPeoes: EstadoInteracaoPeoes, celula: Celula) {
    const comandos: unknown[] = []
    const comandosPeao: unknown[] = []
    despacharCliqueDeCelula(estadoPeoes, estadoTabuleiro249(estadoPeoes), celula, {
      onComando: (comando) => comandos.push(comando),
      onComandoPeao: (comando) => comandosPeao.push(comando),
    })
    return { comandos, comandosPeao }
  }

  it('peão na Mesa selecionado É ciclo ativo que suprime o fallback (binário, #249)', () => {
    const naMesa = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(peaoSobreAMesa(naMesa.peoes.find((p) => p.peaoId === 'peao-branco'))).toBe(true)
    expect(peaoSobreAMesa(naMesa.peoes.find((p) => p.peaoId === 'peao-vermelho'))).toBe(true)
    expect(peaoSobreAMesa(undefined)).toBe(false)
    // Invariante binário: qualquer seleção vigente (mesmo sobre a Mesa) é
    // ciclo ativo — só DESELECIONAR_PEAO + ack libera o fallback.
    expect(cicloAtivo(naMesa)).toBe(true)
    const posicionado = estadoBase({
      peoes: [peao('peao-branco', INICIAL), peao('peao-vermelho', null)],
      peaoSelecionadoId: 'peao-branco',
    })
    expect(cicloAtivo(posicionado)).toBe(true)
    const naMesaComPendencia = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    expect(cicloAtivo(naMesaComPendencia)).toBe(true)
    const semSelecao = estadoBase()
    expect(cicloAtivo(semSelecao)).toBe(false)
  })

  it('ordem peão→inicial: célula vazia com seleção vigente NÃO emite POSICIONAR_PECA (exige DESELECIONAR_PEAO, #249)', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'inicial-2',
    })
    // Ciclo binário: com seleção vigente o roteador não resolve o encaixe da
    // Inicial (não é Recebida) e o despacho NÃO cai no fallback ST-09 — fica
    // silencioso até DESELECIONAR_PEAO + ack ("Inicial primeiro").
    expect(cicloAtivo(estado)).toBe(true)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro249(estado), CELULA_VAZIA)).toBeNull()
    expect(capturarDespacho(estado, CELULA_VAZIA).comandos).toEqual([])
    // A desseleção autoritativa é o único caminho para liberar a Inicial.
    expect(mapearDesselecaoDePeao(estado)).toEqual({
      type: 'DESELECIONAR_PEAO',
      peaoId: 'peao-branco',
    })
  })

  it('desseleção libera a Inicial: sem peão selecionado o fallback posiciona', () => {
    // Após aoDesselecionar o merge entrega peaoSelecionadoId null ao roteador.
    const estado = estadoBase({
      peaoSelecionadoId: null,
      pecaSelecionadaId: 'inicial-2',
    })
    expect(cicloAtivo(estado)).toBe(false)
    expect(capturarDespacho(estado, CELULA_VAZIA).comandos).toEqual([
      { type: 'POSICIONAR_PECA', pecaId: 'inicial-2', celula: CELULA_VAZIA },
    ])
  })

  it('ordem inicial→peão: clique na Inicial posicionada emite POSICIONAR_PEAO', () => {
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: null,
    })
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro249(estado), INICIAL)).toEqual({
      ciclo: { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: INICIAL },
    })
    expect(capturarDespacho(estado, INICIAL).comandosPeao).toEqual([
      { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: INICIAL },
    ])
  })

  it('pós-reload: seleção autoritativa do servidor posiciona o peão (sem merge local)', () => {
    // A seleção vigente vem do servidor (PEAO_SELECIONADO/snapshot) — o
    // cliente nunca roteia por estado local divergente (#249).
    const estadoComSelecaoLocal = estadoBase({ peaoSelecionadoId: 'peao-branco' })
    expect(
      rotearCliqueDeCelula(estadoComSelecaoLocal, estadoTabuleiro249(estadoComSelecaoLocal), INICIAL),
    ).toEqual({
      ciclo: { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: INICIAL },
    })
  })

  it('prova Spec #249: seleção vigente com peão na Mesa SUPRIME o fallback até DESELECIONAR_PEAO', () => {
    // A seleção veio do servidor (PEAO_SELECIONADO aplicado) e o peão segue
    // sobre a Mesa; a Inicial segue selecionada para o primeiro encaixe —
    // mas o ciclo binário suprime o fallback: só a desseleção autoritativa
    // libera POSICIONAR_PECA ("Inicial primeiro").
    const estado = estadoBase({
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'inicial-2',
    })
    expect(cicloAtivo(estado)).toBe(true)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro249(estado), CELULA_VAZIA)).toBeNull()
    const { comandos, comandosPeao } = capturarDespacho(estado, CELULA_VAZIA)
    expect(comandos).toEqual([])
    expect(comandosPeao).toEqual([])
  })

  it('reconciliação no reload: seleção + pendentes do snapshot roteiam o encaixe (sem reset blanket)', () => {
    // Espelho do `aplicarSnapshot` de tabuleiro-reducao.test.ts: o snapshot
    // pós-reload restaura pecaSelecionadaId + pendência com vaga e alvo — o
    // roteador precisa emitir POSICIONAR_PECA no alvo (o reset blanket
    // rejeitado quebraria este encaixe com deadlock novo).
    const alvo = { linha: 2, coluna: 3 }
    const estado = estadoBase({
      peoes: [peao('peao-branco', INICIAL)],
      posicionadas: [pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)],
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', 'norte', alvo)],
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'reta-1',
    })
    expect(cicloAtivo(estado)).toBe(true)
    expect(rotearCliqueDeCelula(estado, estadoTabuleiro249(estado), alvo)).toEqual({
      ciclo: { type: 'POSICIONAR_PECA', pecaId: 'reta-1', celula: alvo },
    })
    expect(capturarDespacho(estado, alvo).comandos).toEqual([
      { type: 'POSICIONAR_PECA', pecaId: 'reta-1', celula: alvo },
    ])
  })

  it('reconciliação no reload: pull local nasce nulo e só o gesto da bandeja o assume', () => {
    // `recebidaPuxadaId` é estado visual LOCAL (AmbienteDeJogo), fora do
    // modelo autoritativo: o remount parte nulo e o snapshot não o carrega —
    // só o pull da corrente (mapearCliqueNaPecaDaBandeja) o assume.
    const remontado = estadoBase({
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    expect(remontado.recebidaPuxadaId ?? null).toBeNull()
    expect(puxadaVigenteNaBandeja(remontado)).toBe(false)
    expect(mapearCliqueNaPecaDaBandeja(remontado)).toEqual({ recebidaId: 'r1' })
  })

  it('prova Spec #249: POSICIONAR_PEAO após a Inicial posicionada com seleção vigente', () => {
    // A Inicial-2 acabou de encaixar em (3,4); o peão segue na Mesa e a
    // seleção do ciclo segue vigente — o clique na peça posicionada posiciona
    // o peão pelo ciclo (ativo), sem exigir desseleção prévia.
    const celulaDaInicial2 = { linha: 3, coluna: 4 }
    const estado = estadoBase({
      posicionadas: [
        pecaPosicionada('inicial-1', 'inicial', 0, 3, 3),
        pecaPosicionada('inicial-2', 'inicial', 0, 3, 4),
      ],
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: null,
    })
    expect(cicloAtivo(estado)).toBe(true)
    expect(
      rotearCliqueDeCelula(estado, estadoTabuleiro249(estado), celulaDaInicial2),
    ).toEqual({
      ciclo: { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: celulaDaInicial2 },
    })
    expect(capturarDespacho(estado, celulaDaInicial2).comandosPeao).toEqual([
      { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: celulaDaInicial2 },
    ])
  })
})

describe('desseleção autoritativa do peão (issue #249)', () => {
  const CELULA_VAZIA = { linha: 5, coluna: 5 }

  function estadoBaseDesselecao(opts: Partial<EstadoInteracaoPeoes> = {}): EstadoInteracaoPeoes {
    return {
      peoes: [peao('peao-branco', null), peao('peao-vermelho', null)],
      posicionadas: [pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)],
      recebidasPendentes: [],
      peaoSelecionadoId: null,
      pecaSelecionadaId: null,
      posicaoConfirmadaNoTurno: false,
      ...opts,
    }
  }

  it('com seleção vigente e sem pendências emite DESELECIONAR_PEAO', () => {
    const estado = estadoBaseDesselecao({ peaoSelecionadoId: 'peao-branco' })
    expect(mapearDesselecaoDePeao(estado)).toEqual({
      type: 'DESELECIONAR_PEAO',
      peaoId: 'peao-branco',
    })
  })

  it('sem seleção é silenciosa (null)', () => {
    expect(mapearDesselecaoDePeao(estadoBaseDesselecao())).toBeNull()
  })

  it('sob Recebidas pendentes é silenciosa (o domínio rejeitaria com PENDENCIA_NAO_RESOLVIDA)', () => {
    const estado = estadoBaseDesselecao({
      peaoSelecionadoId: 'peao-branco',
      recebidasPendentes: [pendencia('r1', 'reta-1', 'reta', null, null)],
    })
    expect(mapearDesselecaoDePeao(estado)).toBeNull()
  })

  it('ciclo binário: só a desseleção autoritativa libera o fallback (sem merge local)', () => {
    const comSelecao = estadoBaseDesselecao({
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'inicial-2',
    })
    expect(cicloAtivo(comSelecao)).toBe(true)
    const tabuleiro = {
      iniciais: [{ pecaId: 'inicial-2' }, { pecaId: 'inicial-3' }],
      posicionadas: comSelecao.posicionadas,
      pecaSelecionadaId: comSelecao.pecaSelecionadaId,
      pecaEmManipulacaoId: null,
    }
    // Com seleção vigente o despacho não cai no fallback.
    const comandos: unknown[] = []
    despacharCliqueDeCelula(comSelecao, tabuleiro, CELULA_VAZIA, {
      onComando: (c) => comandos.push(c),
      onComandoPeao: () => {},
    })
    expect(comandos).toEqual([])
    // Após o ack (seleção null, autoridade do servidor), o fallback posiciona.
    const aposAck: EstadoInteracaoPeoes = { ...comSelecao, peaoSelecionadoId: null }
    expect(cicloAtivo(aposAck)).toBe(false)
    const comandosApos: unknown[] = []
    despacharCliqueDeCelula(aposAck, { ...tabuleiro, pecaSelecionadaId: 'inicial-2' }, CELULA_VAZIA, {
      onComando: (c) => comandosApos.push(c),
      onComandoPeao: () => {},
    })
    expect(comandosApos).toEqual([
      { type: 'POSICIONAR_PECA', pecaId: 'inicial-2', celula: CELULA_VAZIA },
    ])
  })
})

describe('pendentes otimistas anti-duplo-place (issue #249)', () => {
  it('retry de DESELECIONAR_PEAO bloqueia em voo e libera no ack idempotente', () => {
    // Espelho do gate `enviarComJogador` da PartidaPage: o mesmo alvo em voo
    // não é reenviado; o ack (inclusive o idempotente com confirmação do
    // servidor) libera o retry — nunca fica preso até o snapshot.
    function tentarEnviar(pendentes: Set<string>, comando: { type: string; peaoId: string }): boolean {
      const chave = chaveDeComandoPendente(comando)
      if (chave === null) return true
      if (pendentes.has(chave)) return false
      pendentes.add(chave)
      return true
    }
    const voo = new Set<string>()
    expect(tentarEnviar(voo, { type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(true)
    expect(tentarEnviar(voo, { type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(false)
    // Ack idempotente do servidor (PEAO_DESELECIONADO mesmo sem seleção
    // vigente) consome o alvo — o retry volta a passar.
    expect(consumirAck(voo, { type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' })).toBe(true)
    expect(voo.size).toBe(0)
    expect(tentarEnviar(voo, { type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(true)
  })

  it('chaveia POSICIONAR_PECA/POSICIONAR_PEAO/DESELECIONAR_PEAO e ignora os demais', () => {
    expect(
      chaveDeComandoPendente({ type: 'POSICIONAR_PECA', pecaId: 'inicial-2', celula: { linha: 5, coluna: 5 } }),
    ).toBe('POSICIONAR_PECA:inicial-2:5:5')
    expect(
      chaveDeComandoPendente({ type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: { linha: 3, coluna: 3 } }),
    ).toBe('POSICIONAR_PEAO:peao-branco:3:3')
    expect(chaveDeComandoPendente({ type: 'DESELECIONAR_PEAO', peaoId: 'peao-branco' })).toBe(
      'DESELECIONAR_PEAO:peao-branco',
    )
    expect(chaveDeComandoPendente({ type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' })).toBeNull()
    // Ack consome o alvo em voo; segundo envio do mesmo alvo volta a passar.
    const pendentes = new Set<string>(['POSICIONAR_PECA:inicial-2:5:5'])
    expect(consumirAck(pendentes, { type: 'PECA_POSICIONADA', pecaId: 'inicial-2' })).toBe(true)
    expect(pendentes.size).toBe(0)
    const voo = new Set<string>(['DESELECIONAR_PEAO:peao-branco'])
    expect(consumirAck(voo, { type: 'PEAO_DESELECIONADO', peaoId: 'peao-branco' })).toBe(true)
    expect(voo.size).toBe(0)
    // Ack de outro alvo não consome.
    const outros = new Set<string>(['POSICIONAR_PEAO:peao-branco:3:3'])
    expect(consumirAck(outros, { type: 'PEAO_POSICIONADO', peaoId: 'peao-vermelho' })).toBe(false)
    expect(outros.size).toBe(1)
  })
})

describe('integração dos 8 passos da issue #249 (ordem Inicial-primeiro)', () => {
  const CELULA_VAZIA = { linha: 5, coluna: 5 }
  const CELULA_INICIAL = { linha: 3, coluna: 3 }

  function tabuleiroDe(estado: EstadoInteracaoPeoes): EstadoInteracaoTabuleiro {
    return {
      iniciais: [{ pecaId: 'inicial-1' }],
      posicionadas: estado.posicionadas,
      pecaSelecionadaId: estado.pecaSelecionadaId,
      pecaEmManipulacaoId: null,
    }
  }

  it('passo 2: SELECIONAR_PEAO antes da própria Inicial é silencioso (gate Inicial-primeiro)', () => {
    // 1. Partida iniciada: tabuleiro vazio, primeiro turno, sem seleção.
    const vazio = estadoBase({ posicionadas: [], peaoSelecionadoId: null })
    // 2. Clicar no peão sobre a Mesa antes da Inicial → gate silencioso.
    expect(mapearCliqueNoPeao(vazio, 'peao-branco')).toBeNull()
    expect(podeSelecionarPeao(vazio, 'peao-branco')).toBe(false)
  })

  it('passos 3-4: Inicial posiciona sem ciclo; com seleção vigente só DESELECIONAR_PEAO libera (passo 4)', () => {
    // 3. Selecionar a Inicial na mesa roteia ST-09 (sem pendências, sem seleção).
    const semCiclo = estadoBase({ posicionadas: [], peaoSelecionadoId: null })
    expect(mapearCliqueNaPecaDaMesa(semCiclo, tabuleiroDe(semCiclo), 'inicial-1')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-1',
    })
    // 4. Com o peão selecionado (estado autoritativo do servidor), a célula
    // vazia NÃO posiciona a Inicial — exige DESELECIONAR_PEAO + ack antes.
    const travado = estadoBase({
      posicionadas: [],
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: 'inicial-1',
    })
    expect(cicloAtivo(travado)).toBe(true)
    expect(rotearCliqueDeCelula(travado, tabuleiroDe(travado), CELULA_VAZIA)).toBeNull()
    const comandos: unknown[] = []
    despacharCliqueDeCelula(travado, tabuleiroDe(travado), CELULA_VAZIA, {
      onComando: (c) => comandos.push(c),
      onComandoPeao: () => {},
    })
    expect(comandos).toEqual([])
    expect(mapearDesselecaoDePeao(travado)).toEqual({
      type: 'DESELECIONAR_PEAO',
      peaoId: 'peao-branco',
    })
    // Ack do servidor (PEAO_DESELECIONADO) libera o fallback.
    const liberado: EstadoInteracaoPeoes = { ...travado, peaoSelecionadoId: null }
    expect(cicloAtivo(liberado)).toBe(false)
    const apos: unknown[] = []
    despacharCliqueDeCelula(liberado, tabuleiroDe(liberado), CELULA_VAZIA, {
      onComando: (c) => apos.push(c),
      onComandoPeao: () => {},
    })
    expect(apos).toEqual([{ type: 'POSICIONAR_PECA', pecaId: 'inicial-1', celula: CELULA_VAZIA }])
  })

  it('passo 8 + reload: POSICIONAR_PEAO sobre a Inicial posicionada; snapshot reconcilia sem fantasma', () => {
    // 7. Inicial posicionada + peão selecionado (gate passa: inicial-1 em mesa).
    const pronto = estadoBase({
      posicionadas: [pecaPosicionada('inicial-1', 'inicial', 0, 3, 3)],
      peaoSelecionadoId: 'peao-branco',
      pecaSelecionadaId: null,
    })
    expect(podeSelecionarPeao(pronto, 'peao-branco')).toBe(true)
    // 8. Clicar a célula da Inicial posicionada emite POSICIONAR_PEAO.
    expect(rotearCliqueDeCelula(pronto, tabuleiroDe(pronto), CELULA_INICIAL)).toEqual({
      ciclo: { type: 'POSICIONAR_PEAO', peaoId: 'peao-branco', celula: CELULA_INICIAL },
    })
    // Reload: snapshot sem seleção não ressuscita fantasma — o fallback volta
    // a valer e nova seleção passa pelo gate (Inicial posicionada).
    const aposReload: EstadoInteracaoPeoes = { ...pronto, peaoSelecionadoId: null }
    expect(cicloAtivo(aposReload)).toBe(false)
    expect(mapearCliqueNoPeao(aposReload, 'peao-branco')).toEqual({
      tipo: 'comando',
      comando: { type: 'SELECIONAR_PEAO', peaoId: 'peao-branco' },
    })
  })
})
