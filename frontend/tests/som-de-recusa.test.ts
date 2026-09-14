import {
  CAMINHO_SOM_DE_RECUSA,
  VOLUME_BASE_SOM_DE_RECUSA,
  motivoDeRecusaDoEvento,
  textoDoAnuncioDeRecusa,
  tocarSomDeRecusa,
} from '../web/src/components/partida/somDeRecusa'
import type { EventoDoCanalDaPartida } from '../web/src/hooks/usePartidaWebSocket'
import {
  armarExcecaoNoProximoPlay,
  armarFalhaNoProximoPlay,
  toquesDeAudio,
} from './helpers/mockAudio'

// Ponto de som único da Partida (issue #228): comportamento externo —
// tocou/não tocou (com qual asset e volume), motivo por evento e anúncio ao
// leitor. Áudio mockado globalmente (tests/helpers/mockAudio.ts).

describe('som de recusa — mapeamento evento → motivo (issue #228)', () => {
  it('cada motivo de recusa tem identificador próprio', () => {
    const casos: { evento: EventoDoCanalDaPartida; motivo: string }[] = [
      {
        evento: { type: 'ERRO_DO_TABULEIRO', codigo: 'PECA_NAO_RECEBIDA', mensagem: 'x' },
        motivo: 'rejeicao_do_servico',
      },
      {
        evento: { type: 'ERRO_DO_TABULEIRO', codigo: 'FORA_DA_VEZ', mensagem: 'x' },
        motivo: 'fora_da_vez',
      },
      {
        evento: { type: 'ERRO_DO_TABULEIRO', codigo: 'PENDENCIA_NAO_RESOLVIDA', mensagem: 'x' },
        motivo: 'pendencia_nao_resolvida',
      },
      {
        evento: { type: 'ERRO_DO_TABULEIRO', codigo: 'CAIXA_ESGOTADA', mensagem: 'x' },
        motivo: 'caixa_esgotada',
      },
      {
        evento: {
          type: 'ATAQUE_RESOLVIDO',
          atacantes: [],
          peoesAtingidos: [],
          protegidos: [],
          estadosAplicados: [{ jogadorId: 'j1', emBaixaIluminacao: true, sanidade: 2, amedrontado: false }],
        },
        motivo: 'ataque_com_penalidade',
      },
    ]
    for (const { evento, motivo } of casos) {
      expect(motivoDeRecusaDoEvento(evento)).toBe(motivo)
    }
  })

  it('aprovação, seleção, sorteio, turno, limpeza, resgate e ataque sem vítimas ficam em silêncio', () => {
    const silenciosos: EventoDoCanalDaPartida[] = [
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-1' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'PECA_SORTEADA', pecaId: 'reta-1', tipoDaPeca: 'reta', orientacao: 0 },
      { type: 'PEAO_SELECIONADO', peaoId: 'peao-1' },
      { type: 'PEAO_MOVIDO', peaoId: 'peao-1', pecaIdDe: 'a', pecaIdPara: 'b', celula: { linha: 3, coluna: 4 } },
      { type: 'POSICAO_CONFIRMADA', jogadorId: 'j1', peaoId: 'peao-1', pecaId: 'reta-1', protegido: false },
      { type: 'TURNO_INICIADO', jogadorId: 'j1', rodada: 2 },
      { type: 'TURNO_ENCERRADO', jogadorId: 'j1' },
      { type: 'CELULAS_ILUMINADAS', celulas: [] },
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['reta-1'] },
      {
        type: 'RESGATE_REALIZADO',
        pecaId: 'reta-1',
        resgatadoJogadorId: 'j2',
        resgatadorJogadorId: 'j1',
        resgatadorPeaoId: 'peao-1',
        emBaixaIluminacao: false,
        sanidade: 3,
      },
      // Gatilho sem vítimas e proteção que negou: sem penalidade, sem som.
      {
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [] }],
        peoesAtingidos: [],
        protegidos: [],
        estadosAplicados: [],
      },
      {
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-1'] }],
        peoesAtingidos: [],
        protegidos: ['j1'],
        estadosAplicados: [],
      },
      // Recusas do Chat de Partida (issue #390): vão só ao autor e SEM SOM —
      // o painel do chat (#389) dará o retorno visual próprio.
      { type: 'ERRO_DO_TABULEIRO', codigo: 'MENSAGEM_VAZIA', mensagem: 'x' },
      { type: 'ERRO_DO_TABULEIRO', codigo: 'MENSAGEM_LONGA_DEMAIS', mensagem: 'x' },
      { type: 'ERRO_DO_TABULEIRO', codigo: 'LIMITE_DE_MENSAGENS', mensagem: 'x' },
    ]
    for (const evento of silenciosos) {
      expect(motivoDeRecusaDoEvento(evento)).toBeNull()
    }
  })
})

describe('som de recusa — toque (issue #228)', () => {
  it('toca sempre o mesmo asset, habilitado por padrão e com volume reduzido', () => {
    tocarSomDeRecusa('rejeicao_do_servico')
    tocarSomDeRecusa('fora_da_vez')
    tocarSomDeRecusa('ataque_com_penalidade')

    expect(toquesDeAudio).toHaveLength(3)
    for (const toque of toquesDeAudio) {
      expect(toque.src).toBe(CAMINHO_SOM_DE_RECUSA)
      expect(toque.volume).toBe(VOLUME_BASE_SOM_DE_RECUSA)
    }
  })

  it('falha de play() não quebra (recusa silenciosa)', async () => {
    armarFalhaNoProximoPlay()
    expect(() => tocarSomDeRecusa('fora_da_vez')).not.toThrow()
    // O toque foi registrado (src/volume com o asset e o volume reduzido); a rejeição foi engolida.
    expect(toquesDeAudio).toHaveLength(1)
    // Unhandled rejections quebrariam a suíte — dá um giro ao event loop.
    await Promise.resolve()

    armarExcecaoNoProximoPlay()
    expect(() => tocarSomDeRecusa('fora_da_vez')).not.toThrow()
  })
})

describe('som de recusa — anúncio ao leitor de tela (issue #228)', () => {
  it('todo motivo tem texto de anúncio não vazio', () => {
    const motivos = [
      'rejeicao_do_servico',
      'fora_da_vez',
      'pendencia_nao_resolvida',
      'caixa_esgotada',
      'posicao_confirmada',
      'ataque_com_penalidade',
    ] as const
    for (const motivo of motivos) {
      expect(textoDoAnuncioDeRecusa(motivo).length).toBeGreaterThan(0)
    }
  })

  it('ataque com penalidade usa texto neutro (som global, #234)', () => {
    // Decisão de produto: o som é global (toca para penalidade de terceiros),
    // então o anúncio não pode dizer "Seu peão".
    expect(textoDoAnuncioDeRecusa('ataque_com_penalidade')).toBe('Um peão sofreu um ataque.')
  })
})
