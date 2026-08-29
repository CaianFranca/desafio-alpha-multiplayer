export type EstadoDaTela = 'carregando' | 'aguardando' | 'disponivel' | 'falha'

export type EventoDaTela =
  | { type: 'carregar' }
  | { type: 'partidaPreparada' }
  | { type: 'partidaEmAndamento' }
  | { type: 'falhar' }
  | { type: 'tentarNovamente' }
  | { type: 'forcar'; estado: EstadoDaTela }

export const estadoInicial: EstadoDaTela = 'carregando'

const estadosValidos: readonly EstadoDaTela[] = ['carregando', 'aguardando', 'disponivel', 'falha'] as const

export function isEstadoDaTela(value: unknown): value is EstadoDaTela {
  return typeof value === 'string' && (estadosValidos as readonly string[]).includes(value)
}

export function transicao(_estado: EstadoDaTela, evento: EventoDaTela): EstadoDaTela {
  switch (evento.type) {
    case 'carregar':
      return 'carregando'
    case 'partidaPreparada':
      return 'aguardando'
    case 'partidaEmAndamento':
      return 'disponivel'
    case 'falhar':
      return 'falha'
    case 'tentarNovamente':
      return 'carregando'
    case 'forcar':
      return evento.estado
    default:
      return _estado
  }
}
