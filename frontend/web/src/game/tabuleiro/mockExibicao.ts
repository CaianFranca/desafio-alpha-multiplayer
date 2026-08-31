import type { EstadoExibicaoTabuleiro, PeaoDaExibicao } from './contrato'
import { CORES_DOS_PEOES, criarReservaInicial } from './contrato'

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
  // 4 peões de cores distintas (ids determinísticos por cor, espelhando o
  // engine). O peão branco inicia posicionado sobre a Peça Inicial em (3,3);
  // os demais aguardam sobre a Mesa (celula: null).
  const peoes: PeaoDaExibicao[] = CORES_DOS_PEOES.map((cor, indice) => ({
    peaoId: `peao-${indice + 1}-${cor}`,
    cor,
    celula: cor === 'branco' ? { linha: 3, coluna: 3 } : null,
  }))
  return { reserva, posicionadas, peoes }
}
