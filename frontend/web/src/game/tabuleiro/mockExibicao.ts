import type { EstadoExibicaoTabuleiro } from './contrato'
import { criarReservaInicial } from './contrato'

export function criarEstadoExibicaoMock(): EstadoExibicaoTabuleiro {
  const reserva = criarReservaInicial()
  const posicionadas = [
    {
      pecaId: 'posicionada-inicial-1',
      tipo: 'inicial' as const,
      orientacao: 0 as const,
      celula: { linha: 3, coluna: 3 },
    },
    {
      pecaId: 'posicionada-reta-2',
      tipo: 'reta' as const,
      orientacao: 90 as const,
      celula: { linha: 3, coluna: 4 },
    },
    {
      pecaId: 'posicionada-cruz-3',
      tipo: 'cruz' as const,
      orientacao: 0 as const,
      celula: { linha: 3, coluna: 5 },
    },
    {
      pecaId: 'posicionada-reta-4',
      tipo: 'reta' as const,
      orientacao: 0 as const,
      celula: { linha: 4, coluna: 5 },
    },
    {
      pecaId: 'posicionada-t-5',
      tipo: 'T' as const,
      orientacao: 180 as const,
      celula: { linha: 2, coluna: 5 },
    },
  ]
  return { reserva, posicionadas }
}
