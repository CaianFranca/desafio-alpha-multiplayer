import { chaveCelula, todasAsCelulas } from './contrato'
import type {
  PeaoDaExibicao,
  PeaoId,
  PecaId,
  PecaPosicionada,
} from './contrato'
import { Celula } from './Celula'
import { cursorParaCelula, cursorParaPecaPosicionada } from './interacao'
import type { EstadoInteracaoTabuleiro } from './interacao'
import { mapearCliqueNaCelula, mapearCliqueNaPecaPosicionada } from './interacao'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
  /** Estado de interação (seleção/manipulação) para cursor e destaques. */
  estadoInteracao: EstadoInteracaoTabuleiro
  /** Callback de comando mapeado (null = sem ação). */
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
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
  estadoInteracao, 
  onComando,
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
        const ocupada = Boolean(peca)
        const cursor =
          peca !== null
            ? cursorParaPecaPosicionada(estadoInteracao.pecaEmManipulacaoId, peca.pecaId)
            : cursorParaCelula(ocupada, estadoInteracao.pecaSelecionadaId)
        const destacada =
          peca !== null &&
          (estadoInteracao.pecaSelecionadaId === peca.pecaId ||
            estadoInteracao.pecaEmManipulacaoId === peca.pecaId)
        const peao = peoesPorChave.get(chave) ?? null
        return (
          <Celula
            key={chave}
            celula={celula}
            peca={peca}
            cursor={cursor}
            pecaDestacada={destacada}
            onClick={() => {
              // Clique na própria peça posicionada (fecha manipulação via
              // SELECIONAR_PECA) ou em célula vazia com seleção (POSICIONAR_PECA).
              const comando =
                peca !== null
                  ? mapearCliqueNaPecaPosicionada(estadoInteracao, peca.pecaId)
                  : mapearCliqueNaCelula(estadoInteracao, celula)
              onComando(comando)
            }}
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
