import {
  chaveCelula,
  destinosConectadosDoPeao,
  todasAsCelulas,
} from './contrato'
import type {
  PeaoDaExibicao,
  PeaoId,
  PecaPosicionada,
} from './contrato'
import { Celula } from './Celula'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
  peoes?: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local; null = nenhum). */
  peaoSelecionadoId?: PeaoId | null
  onSelecionarPeao?: (peaoId: PeaoId) => void
}

export function Tabuleiro({
  posicionadas,
  peoes = [],
  peaoSelecionadoId = null,
  onSelecionarPeao,
}: TabuleiroProps) {
  const posicionadasPorChave = new Map<string, PecaPosicionada>()
  for (const p of posicionadas) {
    posicionadasPorChave.set(chaveCelula(p.celula), p)
  }

  // Peões posicionados mapeados por célula da peça que os abriga (máx. 1).
  const peoesPorChave = new Map<string, PeaoDaExibicao>()
  for (const peao of peoes) {
    if (peao.celula !== null) {
      peoesPorChave.set(chaveCelula(peao.celula), peao)
    }
  }

  // Destinos válidos do peão selecionado → conjunto de células destacadas.
  const destinosValidos = new Set<string>()
  if (peaoSelecionadoId !== null) {
    for (const peca of destinosConectadosDoPeao(posicionadas, peoes, peaoSelecionadoId)) {
      destinosValidos.add(chaveCelula(peca.celula))
    }
  }

  const celulas = todasAsCelulas()

  return (
    <group>
      {celulas.map((celula) => {
        const chave = chaveCelula(celula)
        const peca = posicionadasPorChave.get(chave) ?? null
        const peao = peoesPorChave.get(chave) ?? null
        return (
          <Celula
            key={chave}
            celula={celula}
            peca={peca}
            peao={peao}
            destinoValido={destinosValidos.has(chave)}
            peaoSelecionadoId={peaoSelecionadoId}
            onSelecionarPeao={onSelecionarPeao}
          />
        )
      })}
    </group>
  )
}
