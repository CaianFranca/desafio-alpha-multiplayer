import {
  CORES_DOS_PEOES,
  chaveCelula,
  criarIniciaisDaMesa,
} from '../../web/src/game/tabuleiro/contrato'

/**
 * Estado de exibicao compartilhado dos testes de contrato/interacao (review
 * PR #189): extrato unico antes duplicado em peoes-contrato, peoes-interacao
 * e tabuleiro-contrato. Issue #143: as 22 peças fictícias deram lugar às 4
 * Peças Iniciais na mesa (Caixa sobre a mesa).
 */
export function criarEstadoExibicaoMock() {
  const iniciais = criarIniciaisDaMesa()
  const posicionadas = [
    { pecaId: 'posicionada-inicial-1', tipo: 'inicial' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 3 } },
    { pecaId: 'posicionada-reta-2', tipo: 'reta' as const, orientacao: 90 as const, celula: { linha: 3, coluna: 4 } },
    { pecaId: 'posicionada-cruz-3', tipo: 'cruz' as const, orientacao: 0 as const, celula: { linha: 3, coluna: 5 } },
    { pecaId: 'posicionada-reta-4', tipo: 'reta' as const, orientacao: 0 as const, celula: { linha: 4, coluna: 5 } },
    { pecaId: 'posicionada-t-5', tipo: 'T' as const, orientacao: 180 as const, celula: { linha: 2, coluna: 5 } },
  ]
  const peoes = CORES_DOS_PEOES.map((cor, indice) => ({
    peaoId: `peao-${indice + 1}-${cor}`,
    cor,
    celula: cor === 'branco' ? { linha: 3, coluna: 3 } : null,
  }))
  // Fila de chegada (issue #298): o branco sobre (3,3) é o único posicionado.
  const ordemDeChegadaPorChave = { [chaveCelula({ linha: 3, coluna: 3 })]: ['peao-1-branco'] }
  return { iniciais, posicionadas, peoes, celulasIluminadas: [] as const, ordemDeChegadaPorChave }
}
