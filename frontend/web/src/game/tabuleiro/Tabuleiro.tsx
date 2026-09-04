import { chaveCelula, todasAsCelulas } from './contrato'
import type {
  PeaoDaExibicao,
  PeaoId,
  PecaId,
  PecaPosicionada,
} from './contrato'
import { Celula } from './Celula'
import { cursorParaCelula, cursorParaPecaPosicionada } from './interacao'
import type { EstadoInteracaoTabuleiro, FlashFeedback } from './interacao'
import type { EstadoInteracaoPeoes } from './interacaoPeoes'
import { despacharCliqueDeCelula } from './interacaoPeoes'
import type {
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

interface TabuleiroProps {
  posicionadas: readonly PecaPosicionada[]
  /** Estado de interação (seleção/manipulação) para cursor e destaques. */
  estadoInteracao: EstadoInteracaoTabuleiro
  /** Callback de comando mapeado (null = sem ação). */
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
  peoes?: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local; null = nenhum). */
  peaoSelecionadoId?: PeaoId | null
  /** Peão do Jogador Ativo da vez (destaque, #118). */
  peaoAtivoId?: PeaoId | null
  /**
   * PecaIds destinos válidos do peão selecionado, derivados uma única vez no
   * pai (mesma fonte do espelho DOM). Célula cuja peça está neste conjunto é
   * destacada e reage ao ponteiro; as demais permanecem inertes.
   */
  destinosSet?: ReadonlySet<PecaId>
  /**
   * Chaves das células iluminadas (`linha:coluna`) vindas do estado
   * compartilhado (issue #151). Derivado uma vez no pai — mesma fonte do
   * espelho DOM.
   */
  iluminadasSet?: ReadonlySet<string>
  onSelecionarPeao?: (peaoId: PeaoId) => void
  /** Estado do ciclo do peão: com valor, cliques passam pelo roteador (#91). */
  estadoPeoes?: EstadoInteracaoPeoes | null
  /** Comando do ciclo do peão emitido pelo roteador (jogadorId injetado no pai). */
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
  /** Rejeição local do roteador (guard pós-confirmação, AC3) → flash no pai. */
  onRejeicaoPeao?: (feedback: FlashFeedback) => void
  /** Chaves das células-alvo de pendências ativas (destaque, #91). */
  alvosPendentesSet?: ReadonlySet<string>
  /**
   * Chaves das células que são vagas disponíveis para a pendência corrente
   * (destaque de escolha de vaga, issue #143). Derivado uma vez no pai —
   * mesma fonte do espelho DOM.
   */
  vagasSet?: ReadonlySet<string>
}

export function Tabuleiro({
  posicionadas,
  estadoInteracao,
  onComando,
  peoes = [],
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  destinosSet = new Set<string>(),
  iluminadasSet = new Set<string>(),
  onSelecionarPeao,
  estadoPeoes = null,
  onComandoPeao,
  onRejeicaoPeao,
  alvosPendentesSet = new Set<string>(),
  vagasSet = new Set<string>(),
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
        // Destaques do ciclo: alvos de pendência com vaga escolhida (#91) e
        // vagas disponíveis para a escolha sequencial (#143) aquecem o plano.
        const alvoPendente = alvosPendentesSet.has(chave)
        const vagaDisponivel = vagasSet.has(chave)
        // Iluminada (issue #151): espelho do estado compartilhado; os destaques
        // de interação acima têm prioridade maior no plano da célula.
        const iluminada = iluminadasSet.has(chave)
        return (
          <Celula
            key={chave}
            celula={celula}
            peca={peca}
            cursor={cursor}
            pecaDestacada={destacada}
            onClick={() => {
              // Roteador do ciclo (#91): comando do ciclo (peão ou tabuleiro)
              // ou fallback ST-09 (sem ciclo ativo).
              despacharCliqueDeCelula(estadoPeoes, estadoInteracao, celula, {
                onComando,
                onComandoPeao,
                onRejeicao: onRejeicaoPeao
                  ? (rejeicao) => onRejeicaoPeao(rejeicao.feedback)
                  : undefined,
              })
            }}
            peao={peao}
            destinoValido={peca !== null && destinosSet.has(peca.pecaId)}
            alvoPendente={alvoPendente}
            vagaDisponivel={vagaDisponivel}
            iluminada={iluminada}
            peaoSelecionadoId={peaoSelecionadoId}
            peaoAtivoId={peaoAtivoId}
            onSelecionarPeao={onSelecionarPeao}
          />
        )
      })}
    </group>
  )
}
