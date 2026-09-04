export type EstadoDaTela = 'carregando' | 'aguardando' | 'disponivel' | 'falha' | 'resultado'

export type ResultadoDaPartida = 'vitoria' | 'derrota'

export type EventoDaTela =
  | { type: 'carregar' }
  | { type: 'partidaPreparada' }
  | { type: 'partidaEmAndamento' }
  | { type: 'partidaTerminada'; resultado: ResultadoDaPartida }
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
