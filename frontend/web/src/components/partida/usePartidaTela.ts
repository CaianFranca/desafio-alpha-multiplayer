import { useCallback, useReducer } from 'react'
import {
  estadoInicial as estadoInicialDefault,
  transicao,
  type EstadoDaTela,
  type EventoDaTela,
  type ResultadoDaPartida,
} from './partidaTelaMachine'

export interface UsePartidaTelaOptions {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
  resultadoInicial?: ResultadoDaPartida | null
}

export interface UsePartidaTelaReturn {
  estado: EstadoDaTela
  resultado: ResultadoDaPartida | null
  carregar: () => void
  partidaPreparada: () => void
  partidaEmAndamento: () => void
  partidaTerminada: (resultado: ResultadoDaPartida) => void
  falhar: () => void
  tentarNovamente: () => void
  forcarEstado: (estado: EstadoDaTela) => void
}

function reducer(estado: EstadoDaTela, evento: EventoDaTela): EstadoDaTela {
  return transicao(estado, evento)
}

type TelaState = { estado: EstadoDaTela; resultado: ResultadoDaPartida | null }
function telaReducer(state: TelaState, evento: EventoDaTela): TelaState {
  const proximoEstado = transicao(state.estado, evento)
  if (evento.type === 'partidaTerminada') {
    return { estado: proximoEstado, resultado: evento.resultado }
  }
  return { estado: proximoEstado, resultado: state.resultado }
}

export function usePartidaTela(opts?: UsePartidaTelaOptions): UsePartidaTelaReturn {
  const { estadoInicial: estadoInicialOpt = estadoInicialDefault, loader, resultadoInicial = null } = opts ?? {}
  const [tela, dispatch] = useReducer(telaReducer, {
    estado: estadoInicialOpt,
    resultado: resultadoInicial,
  } as TelaState)
  const estado = tela.estado
  const resultado = tela.resultado

  const carregar = useCallback(() => dispatch({ type: 'carregar' }), [])
  const partidaPreparada = useCallback(() => dispatch({ type: 'partidaPreparada' }), [])
  const partidaEmAndamento = useCallback(() => dispatch({ type: 'partidaEmAndamento' }), [])
  const partidaTerminada = useCallback((r: ResultadoDaPartida) => {
    dispatch({ type: 'partidaTerminada', resultado: r })
  }, [])
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
    carregar,
    partidaPreparada,
    partidaEmAndamento,
    partidaTerminada,
    falhar,
    tentarNovamente,
    forcarEstado,
  }
}
