export type EstadoDaTela = 'carregando' | 'aguardando' | 'disponivel' | 'falha' | 'resultado'

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

export const estadoInicial: EstadoDaTela = 'carregando'

const estadosValidos: readonly EstadoDaTela[] = ['carregando', 'aguardando', 'disponivel', 'falha', 'resultado'] as const

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
    case 'falhar':
      if (estado === 'resultado') return 'resultado'
      return 'falha'
    case 'tentarNovamente':
      // Resultado é terminal — retry não sai do resultado (requer navegação)
      if (estado === 'resultado') return 'resultado'
      return 'carregando'
    case 'forcar':
      return evento.estado
    default:
      return estado
  }
}
