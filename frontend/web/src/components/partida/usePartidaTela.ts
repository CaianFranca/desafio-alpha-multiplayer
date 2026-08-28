import { useCallback, useReducer } from 'react'
import {
  estadoInicial as estadoInicialDefault,
  transicao,
  type EstadoDaTela,
  type EventoDaTela,
} from './partidaTelaMachine'

export interface UsePartidaTelaOptions {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
}

export interface UsePartidaTelaReturn {
  estado: EstadoDaTela
  carregar: () => void
  partidaPreparada: () => void
  partidaEmAndamento: () => void
  falhar: () => void
  tentarNovamente: () => void
  forcarEstado: (estado: EstadoDaTela) => void
  // aliases exigidos pelo plano
  aguardar: () => void
  disponibilizar: () => void
}

function reducer(estado: EstadoDaTela, evento: EventoDaTela): EstadoDaTela {
  return transicao(estado, evento)
}

export function usePartidaTela(opts?: UsePartidaTelaOptions): UsePartidaTelaReturn {
  const [estado, dispatch] = useReducer(reducer, opts?.estadoInicial ?? estadoInicialDefault)

  const carregar = useCallback(() => dispatch({ type: 'carregar' }), [])
  const partidaPreparada = useCallback(() => dispatch({ type: 'partidaPreparada' }), [])
  const partidaEmAndamento = useCallback(() => dispatch({ type: 'partidaEmAndamento' }), [])
  const falhar = useCallback(() => dispatch({ type: 'falhar' }), [])

  const tentarNovamente = useCallback(() => {
    dispatch({ type: 'tentarNovamente' })
    if (opts?.loader) {
      void opts.loader().catch(() => dispatch({ type: 'falhar' }))
    }
  }, [opts])

  const forcarEstado = useCallback((novoEstado: EstadoDaTela) => {
    dispatch({ type: 'forcar', estado: novoEstado })
  }, [])

  return {
    estado,
    carregar,
    partidaPreparada,
    partidaEmAndamento,
    falhar,
    tentarNovamente,
    forcarEstado,
    aguardar: partidaPreparada,
    disponibilizar: partidaEmAndamento,
  }
}
