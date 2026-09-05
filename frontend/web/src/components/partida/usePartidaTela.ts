import { useCallback, useReducer } from 'react'
import {
  estadoInicial as estadoInicialDefault,
  transicao,
  type EstadoDaTela,
  type EventoDaTela,
  type MotivoDeDerrota,
  type ResultadoDaPartida,
} from './partidaTelaMachine'

export interface UsePartidaTelaOptions {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
  resultadoInicial?: ResultadoDaPartida | null
  motivoInicial?: MotivoDeDerrota | null
}

export interface UsePartidaTelaReturn {
  estado: EstadoDaTela
  resultado: ResultadoDaPartida | null
  /** Motivo da derrota (#145-exp); null na vitória e em payloads sem motivo. */
  motivo: MotivoDeDerrota | null
  carregar: () => void
  partidaPreparada: () => void
  partidaEmAndamento: () => void
  partidaTerminada: (resultado: ResultadoDaPartida, motivo?: MotivoDeDerrota | null) => void
  falhar: () => void
  tentarNovamente: () => void
  forcarEstado: (estado: EstadoDaTela) => void
}

function reducer(estado: EstadoDaTela, evento: EventoDaTela): EstadoDaTela {
  return transicao(estado, evento)
}

type TelaState = {
  estado: EstadoDaTela
  resultado: ResultadoDaPartida | null
  motivo: MotivoDeDerrota | null
}
function telaReducer(state: TelaState, evento: EventoDaTela): TelaState {
  const proximoEstado = transicao(state.estado, evento)
  if (evento.type === 'partidaTerminada') {
    return {
      estado: proximoEstado,
      resultado: evento.resultado,
      motivo: evento.motivo ?? null,
    }
  }
  return { estado: proximoEstado, resultado: state.resultado, motivo: state.motivo }
}

export function usePartidaTela(opts?: UsePartidaTelaOptions): UsePartidaTelaReturn {
  const {
    estadoInicial: estadoInicialOpt = estadoInicialDefault,
    loader,
    resultadoInicial = null,
    motivoInicial = null,
  } = opts ?? {}
  const [tela, dispatch] = useReducer(telaReducer, {
    estado: estadoInicialOpt,
    resultado: resultadoInicial,
    motivo: motivoInicial,
  } as TelaState)
  const estado = tela.estado
  const resultado = tela.resultado
  const motivo = tela.motivo

  const carregar = useCallback(() => dispatch({ type: 'carregar' }), [])
  const partidaPreparada = useCallback(() => dispatch({ type: 'partidaPreparada' }), [])
  const partidaEmAndamento = useCallback(() => dispatch({ type: 'partidaEmAndamento' }), [])
  const partidaTerminada = useCallback(
    (r: ResultadoDaPartida, m?: MotivoDeDerrota | null) => {
      dispatch({ type: 'partidaTerminada', resultado: r, motivo: m ?? null })
    },
    [],
  )
  const falhar = useCallback(() => dispatch({ type: 'falhar' }), [])

  const tentarNovamente = useCallback(() => {
    dispatch({ type: 'tentarNovamente' })
    if (loader) {
      void loader().catch(() => dispatch({ type: 'falhar' }))
    }
  }, [loader])

  const forcarEstado = useCallback((novoEstado: EstadoDaTela) => {
    dispatch({ type: 'forcar', estado: novoEstado })
  }, [])

  return {
    estado,
    resultado,
    motivo,
    carregar,
    partidaPreparada,
    partidaEmAndamento,
    partidaTerminada,
    falhar,
    tentarNovamente,
    forcarEstado,
  }
}
