import {
  SOM_CAMINHO_BAQUE_PEAO,
  SOM_CAMINHO_CLIQUE_PEAO,
  SOM_VOLUME_BASE_BAQUE_PEAO,
  SOM_VOLUME_BASE_CLIQUE_PEAO,
  VOO_DURACAO_MS,
  deveLimparVooNoSnapshot,
  deveSuprimirPeaoEstatico,
  deveSuprimirPeaoNaMesa,
  deveTocarCliqueDoPeao,
  limparVooAoAterrissar,
  mundoDoPeaoSobreACelula,
  tocarBaqueDoPeao,
  tocarCliqueDoPeao,
  vooDoPeaoDoEvento,
  vooReduceAtivo,
} from '../web/src/game/tabuleiro/vooDoPeao'
import type { VooDoPeaoPendente } from '../web/src/game/tabuleiro/vooDoPeao'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
} from '../web/src/game/tabuleiro/reducao'
import {
  celulaParaMundo,
  PEAO_Y,
} from '../web/src/game/tabuleiro/contrato'
import { motivoDeRecusaDoEvento } from '../web/src/components/partida/somDeRecusa'
import { CAMINHO_SOM_DE_RECUSA } from '../web/src/components/partida/somDeRecusa'
import type { EventoDoCanalDaPartida } from '../web/src/hooks/usePartidaWebSocket'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeAudio,
} from './helpers/mockAudio'

// Voo do peão com sons (issue #242): comportamento externo — voo registrado
// com origem/destino certos, clique + baque, reduce vira snap, demais eventos
// do ciclo sem voo/som. Áudio mockado globalmente (mockAudio.ts); eventos
// mockados no padrão som-de-recusa.test.ts.

const ORIGEM = { linha: 3, coluna: 3 }
const DESTINO = { linha: 3, coluna: 4 }

/** Modelo com duas peças assentadas para resolver a origem via `pecaIdDe`. */
function modeloComDuasPecas() {
  let modelo = criarEstadoInicialDoCliente()
  modelo = reduzirEvento(modelo, {
    type: 'PECA_POSICIONADA',
    pecaId: 'inicial-1',
    celula: ORIGEM,
    orientacao: 0,
  })
  modelo = reduzirEvento(modelo, {
    type: 'PECA_POSICIONADA',
    pecaId: 'inicial-2',
    celula: DESTINO,
    orientacao: 0,
  })
  return modelo
}

function eventoMovido(): Extract<EventoDoCanalDaPartida, { type: 'PEAO_MOVIDO' }> {
  return {
    type: 'PEAO_MOVIDO',
    peaoId: 'peao-branco',
    pecaIdDe: 'inicial-1',
    pecaIdPara: 'inicial-2',
    celula: DESTINO,
  }
}

describe('voo do peão — derivação do PEAO_MOVIDO (issue #242)', () => {
  it('registra origem (pecaIdDe) e destino (celula do evento) certos', () => {
    const voo = vooDoPeaoDoEvento(eventoMovido(), modeloComDuasPecas())
    expect(voo).not.toBeNull()
    expect(voo?.peaoId).toBe('peao-branco')
    expect(voo?.origem).toEqual(ORIGEM)
    expect(voo?.destino).toEqual(DESTINO)
  })

  it('fallback: pecaIdDe desconhecido usa a célula do peão no modelo anterior', () => {
    let modelo = modeloComDuasPecas()
    modelo = reduzirEvento(modelo, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: ORIGEM,
    })
    const voo = vooDoPeaoDoEvento(
      {
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'peca-fantasma',
        pecaIdPara: 'inicial-2',
        celula: DESTINO,
      },
      modelo,
    )
    expect(voo?.origem).toEqual(ORIGEM)
    expect(voo?.destino).toEqual(DESTINO)
  })

  it('snap irresolúvel: sem pecaIdDe nem célula anterior, sem voo', () => {
    const voo = vooDoPeaoDoEvento(
      {
        type: 'PEAO_MOVIDO',
        peaoId: 'peao-branco',
        pecaIdDe: 'peca-fantasma',
        pecaIdPara: 'inicial-2',
        celula: DESTINO,
      },
      criarEstadoInicialDoCliente(),
    )
    expect(voo).toBeNull()
    expect(toquesDeAudio).toHaveLength(0)
  })

  it('origem idêntica ao destino vira snap (sem voo)', () => {
    const modelo = modeloComDuasPecas()
    expect(
      vooDoPeaoDoEvento(
        {
          type: 'PEAO_MOVIDO',
          peaoId: 'peao-branco',
          pecaIdDe: 'inicial-1',
          pecaIdPara: 'inicial-1',
          celula: ORIGEM,
        },
        modelo,
      ),
    ).toBeNull()
  })

  it('PEAO_PERMANECEU: snap, sem voo nem som', () => {
    const modelo = modeloComDuasPecas()
    const permaneceu: EventoDoCanalDaPartida = {
      type: 'PEAO_PERMANECEU',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
    }
    expect(vooDoPeaoDoEvento(permaneceu, modelo)).toBeNull()
    expect(deveTocarCliqueDoPeao(permaneceu)).toBe(false)
    expect(toquesDeAudio).toHaveLength(0)
  })
})

describe('voo do peão — PEAO_POSICIONADO mesa→peça no Primeiro Turno (extensão #242)', () => {
  function eventoPosicionado(): Extract<
    EventoDoCanalDaPartida,
    { type: 'PEAO_POSICIONADO' }
  > {
    return {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-2',
      celula: DESTINO,
    }
  }

  it('peão na Mesa voa até a peça inicial (origem Mesa + slot global)', () => {
    // Peões nascem sobre a Mesa (celula null); peao-branco é o índice 0.
    const voo = vooDoPeaoDoEvento(eventoPosicionado(), modeloComDuasPecas())
    expect(voo).not.toBeNull()
    expect(voo?.peaoId).toBe('peao-branco')
    expect(voo?.origem).toEqual({ mesaIndice: 0 })
    expect(voo?.destino).toEqual(DESTINO)
    expect(toquesDeAudio).toHaveLength(0)
  })

  it('pouso do posicionado toca o mesmo baque (mesmo dono: a cena)', () => {
    const voo = vooDoPeaoDoEvento(eventoPosicionado(), modeloComDuasPecas())
    expect(voo).not.toBeNull()
    tocarBaqueDoPeao()
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]?.src).toBe(SOM_CAMINHO_BAQUE_PEAO)
    expect(toquesDeAudio[0]?.volume).toBe(SOM_VOLUME_BASE_BAQUE_PEAO)
  })

  it('reduce não muda a derivação (snap vive na cena, mesmo overlay)', () => {
    const original = window.matchMedia
    try {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: () => ({ matches: true }),
      })
      expect(vooReduceAtivo()).toBe(true)
      const voo = vooDoPeaoDoEvento(eventoPosicionado(), modeloComDuasPecas())
      expect(voo).not.toBeNull()
      expect(voo?.destino).toEqual(DESTINO)
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      })
    }
  })

  it('origem irresolúvel vira snap: peão desconhecido, sem voo', () => {
    const voo = vooDoPeaoDoEvento(
      {
        type: 'PEAO_POSICIONADO',
        peaoId: 'peao-fantasma',
        pecaId: 'inicial-2',
        celula: DESTINO,
      },
      modeloComDuasPecas(),
    )
    expect(voo).toBeNull()
    expect(toquesDeAudio).toHaveLength(0)
  })

  it('peão já na célula de destino vira snap (sem voo)', () => {
    let modelo = modeloComDuasPecas()
    modelo = reduzirEvento(modelo, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-2',
      celula: DESTINO,
    })
    expect(vooDoPeaoDoEvento(eventoPosicionado(), modelo)).toBeNull()
  })

  it('peão já posicionado em outra célula voa célula→célula', () => {
    let modelo = modeloComDuasPecas()
    modelo = reduzirEvento(modelo, {
      type: 'PEAO_POSICIONADO',
      peaoId: 'peao-branco',
      pecaId: 'inicial-1',
      celula: ORIGEM,
    })
    const voo = vooDoPeaoDoEvento(eventoPosicionado(), modelo)
    expect(voo?.origem).toEqual(ORIGEM)
    expect(voo?.destino).toEqual(DESTINO)
    expect(voo !== null && 'mesaIndice' in voo.origem).toBe(false)
  })

  it('origemMesaIndice órfã não existe mais (união por forma)', () => {
    const vooMesa = vooDoPeaoDoEvento(eventoPosicionado(), modeloComDuasPecas())
    expect(vooMesa?.origem).toEqual({ mesaIndice: 0 })
    // Forma antiga (`origem: null` + `origemMesaIndice` solto) não é mais
    // emitida: o slot vive dentro de `origem`, sem campo órfão.
    expect(vooMesa).not.toHaveProperty('origemMesaIndice')
    expect(vooMesa !== null && 'mesaIndice' in vooMesa.origem).toBe(true)
  })

  it('sem duplicado: voador some do estático no destino e da Mesa', () => {
    const voo = vooDoPeaoDoEvento(eventoPosicionado(), modeloComDuasPecas())
    expect(voo).not.toBeNull()
    if (voo === null) throw new Error('voo do posicionado deveria existir')
    const pendente: VooDoPeaoPendente = { nonce: 3, ...voo }
    // Destino suprimido no tabuleiro (origem é a Mesa, sem chave de célula).
    expect(deveSuprimirPeaoEstatico(pendente, 'peao-branco', '3:4')).toBe(true)
    expect(deveSuprimirPeaoEstatico(pendente, 'peao-branco', '3:3')).toBe(false)
    expect(deveSuprimirPeaoEstatico(pendente, 'peao-vermelho', '3:4')).toBe(false)
    // Fileira da Mesa suprime pelo peaoId em voo — só com origem na Mesa.
    expect(deveSuprimirPeaoNaMesa(pendente, 'peao-branco')).toBe(true)
    expect(deveSuprimirPeaoNaMesa(pendente, 'peao-vermelho')).toBe(false)
    expect(deveSuprimirPeaoNaMesa(null, 'peao-branco')).toBe(false)
    const vooCelula: VooDoPeaoPendente = {
      nonce: 4,
      peaoId: 'peao-branco',
      origem: ORIGEM,
      destino: DESTINO,
    }
    expect(deveSuprimirPeaoNaMesa(vooCelula, 'peao-branco')).toBe(false)
  })

  it('clique continua só no PEAO_SELECIONADO (posicionado em silêncio)', () => {
    expect(deveTocarCliqueDoPeao(eventoPosicionado())).toBe(false)
    expect(toquesDeAudio).toHaveLength(0)
  })
})

describe('voo do peão — clique ao selecionar (issue #242)', () => {
  it('PEAO_SELECIONADO toca 1 clique suave com asset e volume próprios', () => {
    expect(deveTocarCliqueDoPeao({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' })).toBe(true)
    expect(deveTocarCliqueDoPeao(eventoMovido())).toBe(false)

    tocarCliqueDoPeao()
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]?.src).toBe(SOM_CAMINHO_CLIQUE_PEAO)
    expect(toquesDeAudio[0]?.volume).toBe(SOM_VOLUME_BASE_CLIQUE_PEAO)
    // Som distinto do THUD de recusa (gatilhos opostos, assets distintos).
    expect(toquesDeAudio[0]?.src).not.toBe(CAMINHO_SOM_DE_RECUSA)
  })

  it('falha de play do clique não quebra (silêncio sem asset)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarCliqueDoPeao()).not.toThrow()
    expect(toquesDeAudio).toHaveLength(1)
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarCliqueDoPeao()).not.toThrow()
    expect(toquesDeAudio).toHaveLength(1)
  })
})

describe('voo do peão — pouso com baque (issue #242)', () => {
  it('pouso toca 1 baque distinto do clique e limpa o pendente do nonce', () => {
    tocarBaqueDoPeao()
    expect(toquesDeAudio).toHaveLength(1)
    expect(toquesDeAudio[0]?.src).toBe(SOM_CAMINHO_BAQUE_PEAO)
    expect(toquesDeAudio[0]?.src).not.toBe(SOM_CAMINHO_CLIQUE_PEAO)
    expect(toquesDeAudio[0]?.volume).toBe(SOM_VOLUME_BASE_BAQUE_PEAO)

    const voo: VooDoPeaoPendente = {
      nonce: 7,
      peaoId: 'peao-branco',
      origem: ORIGEM,
      destino: DESTINO,
    }
    expect(limparVooAoAterrissar(voo, 7)).toBeNull()
  })

  it('pouso de voo antigo não limpa o novo (último vence)', () => {
    const vooNovo: VooDoPeaoPendente = {
      nonce: 8,
      peaoId: 'peao-branco',
      origem: ORIGEM,
      destino: DESTINO,
    }
    expect(limparVooAoAterrissar(vooNovo, 7)).toBe(vooNovo)
    expect(limparVooAoAterrissar(null, 7)).toBeNull()
  })

  it('falha de play do baque não quebra (silêncio sem asset)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarBaqueDoPeao()).not.toThrow()
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarBaqueDoPeao()).not.toThrow()
  })

  it('ESTADO_DA_PARTIDA limpa o voo (snapshot é autoridade); demais eventos não', () => {
    const snapshot = { type: 'ESTADO_DA_PARTIDA' } as EventoDoCanalDaPartida
    expect(deveLimparVooNoSnapshot(snapshot)).toBe(true)
    expect(deveLimparVooNoSnapshot(eventoMovido())).toBe(false)
    expect(
      deveLimparVooNoSnapshot({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' }),
    ).toBe(false)
  })
})

describe('voo do peão — transição e reduce (issue #242)', () => {
  it('duração de partida (~500ms)', () => {
    expect(VOO_DURACAO_MS).toBe(500)
  })

  it('mundo do peão = celulaParaMundo + PEAO_Y (mesma base do estático)', () => {
    const [x, y, z] = celulaParaMundo(DESTINO)
    expect(mundoDoPeaoSobreACelula(DESTINO)).toEqual([x, y + PEAO_Y, z])
  })

  it('sem reduce por padrão; com reduce ativo vira snap', () => {
    const original = window.matchMedia
    try {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: () => ({ matches: false }),
      })
      expect(vooReduceAtivo()).toBe(false)
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: () => ({ matches: true }),
      })
      expect(vooReduceAtivo()).toBe(true)
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      })
    }
  })
})

describe('voo do peão — sem duplicado nem regressão (issue #242)', () => {
  it('só o peão voador some do estático, confinado a origem/destino', () => {
    const voo: VooDoPeaoPendente = {
      nonce: 1,
      peaoId: 'peao-branco',
      origem: ORIGEM,
      destino: DESTINO,
    }
    expect(deveSuprimirPeaoEstatico(voo, 'peao-branco', '3:3')).toBe(true)
    expect(deveSuprimirPeaoEstatico(voo, 'peao-branco', '3:4')).toBe(true)
    expect(deveSuprimirPeaoEstatico(voo, 'peao-branco', '0:0')).toBe(false)
    expect(deveSuprimirPeaoEstatico(voo, 'peao-vermelho', '3:4')).toBe(false)
    expect(deveSuprimirPeaoEstatico(null, 'peao-branco', '3:4')).toBe(false)
  })

  it('modelo pós-voo inalterado: PEAO_MOVIDO move e limpa seleção como antes', () => {
    let modelo = modeloComDuasPecas()
    modelo = reduzirEvento(modelo, {
      type: 'PEAO_SELECIONADO',
      peaoId: 'peao-branco',
    })
    expect(modelo.peaoSelecionadoId).toBe('peao-branco')
    modelo = reduzirEvento(modelo, eventoMovido())
    expect(
      modelo.peoes.find((p) => p.peaoId === 'peao-branco')?.celula,
    ).toEqual(DESTINO)
    expect(modelo.peaoSelecionadoId).toBeNull()
  })

  it('ponto de recusa intocado: seleção e movimento seguem em silêncio lá', () => {
    expect(
      motivoDeRecusaDoEvento({ type: 'PEAO_SELECIONADO', peaoId: 'peao-branco' }),
    ).toBeNull()
    expect(motivoDeRecusaDoEvento(eventoMovido())).toBeNull()
  })

  it('derivações puras nunca tocam áudio (zero toques sem efeito colateral)', () => {
    const modelo = modeloComDuasPecas()
    vooDoPeaoDoEvento(eventoMovido(), modelo)
    vooDoPeaoDoEvento(
      { type: 'PEAO_POSICIONADO', peaoId: 'peao-branco', pecaId: 'inicial-2', celula: DESTINO },
      modelo,
    )
    deveTocarCliqueDoPeao(eventoMovido())
    limparVooAoAterrissar(null, 1)
    deveLimparVooNoSnapshot(eventoMovido())
    deveSuprimirPeaoEstatico(null, 'peao-branco', '3:4')
    deveSuprimirPeaoNaMesa(null, 'peao-branco')
    vooReduceAtivo()
    expect(toquesDeAudio).toHaveLength(0)
  })
})
