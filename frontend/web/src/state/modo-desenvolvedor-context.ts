import { createContext, useContext } from 'react'

interface ModoDesenvolvedorContextoValor {
  ativo: boolean
  painelVisivel: boolean
  ativarModo: () => void
  desativarModo: () => void
  alternarPainel: () => void
}

export const ModoDesenvolvedorContext = createContext<ModoDesenvolvedorContextoValor | null>(null)

export function useModoDesenvolvedor(): ModoDesenvolvedorContextoValor {
  const valor = useContext(ModoDesenvolvedorContext)
  if (valor === null) {
    throw new Error('useModoDesenvolvedor deve ser usado dentro de ModoDesenvolvedorProvider')
  }
  return valor
}
