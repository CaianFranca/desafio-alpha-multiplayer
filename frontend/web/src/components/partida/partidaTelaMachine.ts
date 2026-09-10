export type EstadoDaTela = 'carregando' | 'aguardando' | 'disponivel' | 'falha' | 'resultado' | 'partidaNaoIniciada'

export type ResultadoDaPartida = 'vitoria' | 'derrota'

/**
 * Motivo da derrota — espelho local de `MotivoDeDerrotaWire` (shared,
 * packages/shared/src/partida.ts) e do `motivo` de `DesfechoDaPartida`
 * (engine, packages/engine/src/partida.ts:130-132): `'caixa_esgotada'`
 * (Caixa Esgotada sem objetivos alcançáveis) | `'equipe_amedrontada'`
 * (Sanidade 0 na equipe inteira). A vitória não tem motivo no domínio — o
 * campo é sempre `null`/ausente nela. Sync manual junto do par acima.
 */
export type MotivoDeDerrota = 'caixa_esgotada' | 'equipe_amedrontada'

export type EventoDaTela =
  | { type: 'carregar' }
  | { type: 'partidaPreparada' }
  | { type: 'partidaEmAndamento' }
  | {
      type: 'partidaTerminada'
      resultado: ResultadoDaPartida
      /** Motivo quando derrota (#145-exp); ausente/null em payloads antigos. */
      motivo?: MotivoDeDerrota | null
    }
  | { type: 'falhar' }
  | { type: 'tentarNovamente' }
  | { type: 'forcar'; estado: EstadoDaTela }
  | {
      /**
       * Partida declarada não iniciada (issue #329): estado terminal de tela,
       * distinto de `falha` (sem "Tentar novamente" — o retry recairia no
       * loop de reconexão) e de `resultado` (sem semântica de vitória/derrota
       * do glossário). O destino é o Retorno à Sala pela Sala reaberta.
       */
      type: 'partidaNaoIniciada'
    }

export const estadoInicial: EstadoDaTela = 'carregando'

/** Estados terminais de tela: sem retry — o destino é o Retorno à Sala. */
function isTerminal(estado: EstadoDaTela): boolean {
  return estado === 'resultado' || estado === 'partidaNaoIniciada'
}

const estadosValidos: readonly EstadoDaTela[] = ['carregando', 'aguardando', 'disponivel', 'falha', 'resultado', 'partidaNaoIniciada'] as const

export function isEstadoDaTela(value: unknown): value is EstadoDaTela {
  return typeof value === 'string' && (estadosValidos as readonly string[]).includes(value)
}

export function transicao(estado: EstadoDaTela, evento: EventoDaTela): EstadoDaTela {
  switch (evento.type) {
    case 'carregar':
      return 'carregando'
    case 'partidaPreparada':
      return estado === 'disponivel' ? 'disponivel' : 'aguardando'
    case 'partidaEmAndamento':
      return 'disponivel'
    case 'partidaTerminada':
      return 'resultado'
    case 'partidaNaoIniciada':
      return 'partidaNaoIniciada'
    case 'falhar':
      if (isTerminal(estado)) return estado
      return 'falha'
    case 'tentarNovamente':
      // Resultado e não-início são terminais — retry não sai deles (o
      // não-início requer navegação de volta à Sala reaberta).
      if (isTerminal(estado)) return estado
      return 'carregando'
    case 'forcar':
      return evento.estado
    default:
      return estado
  }
}
