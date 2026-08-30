import { chaveCelula, todasAsCelulas } from './contrato'
import type {
  PeaoDaExibicao,
  PeaoId,
  PecaId,
  PecaPosicionada,
} from './contrato'
import { Celula } from './Celula'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
  peoes?: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local; null = nenhum). */
  peaoSelecionadoId?: PeaoId | null
  /**
   * PecaIds destinos válidos do peão selecionado, derivados uma única vez no
   * pai (mesma fonte do espelho DOM). Célula cuja peça está neste conjunto é
   * destacada e reage ao ponteiro; as demais permanecem inertes.
   */
  destinosSet?: ReadonlySet<PecaId>
  onSelecionarPeao?: (peaoId: PeaoId) => void
}

export function Tabuleiro({
  posicionadas,
  peoes = [],
  peaoSelecionadoId = null,
  destinosSet = new Set<string>(),
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
            destinoValido={peca !== null && destinosSet.has(peca.pecaId)}
            peaoSelecionadoId={peaoSelecionadoId}
            onSelecionarPeao={onSelecionarPeao}
          />
        )
      })}
    </group>
  )
}
