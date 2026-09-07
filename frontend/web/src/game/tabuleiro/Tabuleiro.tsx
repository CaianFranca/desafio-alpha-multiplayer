import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { chaveCelula, todasAsCelulas } from './contrato'
import type {
  CorDoPeao,
  PeaoDaExibicao,
  PeaoId,
  PecaId,
  PecaPosicionada,
} from './contrato'
import { Celula } from './Celula'
import { PeaoVisual } from './PeaoVisual'
import { cursorParaCelula, cursorParaPecaPosicionada } from './interacao'
import type { EstadoInteracaoTabuleiro } from './interacao'
import type { EstadoInteracaoPeoes, MotivoDeRejeicaoLocal } from './interacaoPeoes'
import { despacharCliqueDeCelula } from './interacaoPeoes'
import type {
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'
import {
  corDoVooPendente,
  deveSuprimirPeaoEstatico,
  mundoDoPeaoSobreACelula,
  tocarBaqueDoPeao,
  vooPoseEntreMundos,
  vooReduceAtivo,
  VOO_DURACAO_MS,
} from './vooDoPeao'
import { peaoMesaParaMundo } from './contrato'
import type { VooDoPeaoPendente } from './vooDoPeao'

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
   * Subconjunto de `destinosSet` com os destinos de RESGATE (peça com peão
   * AFETADO — exceção #171). Derivado no pai junto de `destinosSet`; muda só
   * o tom do destaque, nunca a affordância (o clique segue o MOVER_PEAO).
   */
  resgateSet?: ReadonlySet<PecaId>
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
  /** Rejeição local do roteador (guard pós-confirmação, AC3) → som de recusa no pai. */
  onRejeicaoPeao?: (motivo: MotivoDeRejeicaoLocal) => void
  /** Chaves das células-alvo de pendências ativas (destaque, #91). */
  alvosPendentesSet?: ReadonlySet<string>
  /**
   * Chaves das células que são vagas disponíveis para a pendência corrente
   * (destaque de escolha de vaga, issue #143). Derivado uma vez no pai —
   * mesma fonte do espelho DOM.
   */
  vagasSet?: ReadonlySet<string>
  /**
   * Voo pendente do peão (issue #242): overlay erguer→flutuar→aterrissar até
   * o pouso, quando a cena avisa via `onVooAterrissou(nonce)`. Null = sem voo
   * (o modelo atual já é o estado final).
   */
  vooPendente?: VooDoPeaoPendente | null
  /** Pouso do voo concluído (nonce): a página limpa o pendente. */
  onVooAterrissou?: (nonce: number) => void
  /**
   * Peões em Baixa Iluminação do dono (issue #297): peaoIds derivados uma vez
   * no pai (mesma fonte do espelho DOM) — o avatar do Diretor troca para a
   * variante apagado só no peão afetado, em todas as posições (célula/voo).
   */
  emBaixaIluminacaoPorPeaoId?: ReadonlySet<PeaoId>
  /**
   * Peça em voo do Encaixe (issue #241): escondida aqui enquanto a
   * TransicaoEncaixe a anima na cena — ao fim do voo o overlay some e esta
   * peça assume pixel-igual. Null = sem voo.
   */
  ocultarPecaId?: PecaId | null
  /** Quantidade de peões N=2..4 para posicionar fila da Mesa e voos mesa→peça. */
  quantidadeDePeoes?: number
}

export function Tabuleiro({
  posicionadas,
  estadoInteracao,
  onComando,
  peoes = [],
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  destinosSet = new Set<string>(),
  resgateSet = new Set<string>(),
  iluminadasSet = new Set<string>(),
  onSelecionarPeao,
  estadoPeoes = null,
  onComandoPeao,
  onRejeicaoPeao,
  alvosPendentesSet = new Set<string>(),
  vagasSet = new Set<string>(),
  vooPendente = null,
  onVooAterrissou,
  ocultarPecaId = null,
  emBaixaIluminacaoPorPeaoId = new Set<PeaoId>(),
  quantidadeDePeoes = peoes.length || 4,
}: TabuleiroProps) {
  const posicionadasPorChave = new Map<string, PecaPosicionada>()
  for (const p of posicionadas) {
    // Peça em voo do Encaixe some da grade durante o voo (só o overlay a
    // exibe); ao fim, o overlay some e ela reassume aqui pixel-igual.
    if (p.pecaId === ocultarPecaId) continue
    posicionadasPorChave.set(chaveCelula(p.celula), p)
  }

  // Peões posicionados mapeados por célula da peça que os abriga. A cena
  // renderiza um placeholder por célula (último peão vence) — limitação
  // conhecida de EXIBIÇÃO: a autoridade da ocupação é o engine (Portão aceita
  // até 4, #176; exceção de resgate #171), e o espelho DOM lista todos.
  const peoesPorChave = new Map<string, PeaoDaExibicao>()
  for (const peao of peoes) {
    if (peao.celula !== null) {
      peoesPorChave.set(chaveCelula(peao.celula), peao)
    }
  }

  const celulas = todasAsCelulas()

  // Voo do peão (#242): o modelo atualiza instantâneo, então o destino já
  // renderizaria o peão estático — durante o voo ativo ele é suprimido em
  // origem/destino e só o overlay voador aparece (sem peão duplicado). Sem
  // cor conhecida (peão fora do modelo), sem overlay — o modelo atual já é
  // o estado final — mas o pouso sonoro é mantido (baque imediato abaixo,
  // revisão PR #254: "baque ao aterrissar", nunca silêncio total).
  const corDoVoo: CorDoPeao | null = corDoVooPendente(vooPendente ?? null, peoes)
  const vooEfetivo = vooPendente !== null && corDoVoo !== null ? vooPendente : null
  // Voo sem cor para o overlay: sem overlay, mas com baque imediato + aviso
  // de aterrissagem, uma vez por nonce (efeito, sem temporizador).
  const vooSemOverlay = vooPendente !== null && corDoVoo === null ? vooPendente : null
  useEffect(() => {
    if (vooSemOverlay === null) return
    tocarBaqueDoPeao()
    onVooAterrissou?.(vooSemOverlay.nonce)
  }, [vooSemOverlay, onVooAterrissou])

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
        // Voo ativo (#242): suprime o estático de mesmo peaoId confinado a
        // origem/destino — só o overlay voa; os demais peões (ex.: Portão
        // com 4) e as demais células seguem intactos.
        const peaoSuprimido =
          peao !== null &&
          vooEfetivo !== null &&
          deveSuprimirPeaoEstatico(vooEfetivo, peao.peaoId, chave)
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
                  ? (rejeicao) => onRejeicaoPeao(rejeicao.motivo)
                  : undefined,
              })
            }}
            peao={peaoSuprimido ? null : peao}
            destinoValido={peca !== null && destinosSet.has(peca.pecaId)}
            destinoResgate={peca !== null && resgateSet.has(peca.pecaId)}
            alvoPendente={alvoPendente}
            vagaDisponivel={vagaDisponivel}
            iluminada={iluminada}
            peaoSelecionadoId={peaoSelecionadoId}
            peaoAtivoId={peaoAtivoId}
            emBaixaIluminacao={
              peao !== null && emBaixaIluminacaoPorPeaoId.has(peao.peaoId)
            }
            onSelecionarPeao={onSelecionarPeao}
          />
        )
      })}
      {vooEfetivo !== null && corDoVoo !== null ? (
        <PeaoVoador
          key={vooEfetivo.nonce}
          voo={vooEfetivo}
          cor={corDoVoo}
          emBaixaIluminacao={emBaixaIluminacaoPorPeaoId.has(vooEfetivo.peaoId)}
          onAterrissou={onVooAterrissou}
          quantidadeDePeoes={quantidadeDePeoes}
        />
      ) : null}
    </group>
  )
}

/**
 * Overlay do peão voador (issue #242): erguer→flutuar inclinado→aterrissar,
 * terminando pixel-igual ao destino estático. A origem pode ser uma célula ou
 * a fileira da Mesa (Primeiro Turno, `PEAO_POSICIONADO` com origem
 * `{ mesaIndice }`). Interpola via `useFrame` + `invalidate()`
 * (Canvas em `frameloop="demand"`, sem trocar o modo); conclui via callback,
 * sem `setTimeout`. Sob `prefers-reduced-motion` vira chegada imediata ao
 * destino + baque. Inerte ao ponteiro (sem handlers): cliques atravessam para
 * a célula/peca abaixo e a câmera segue intacta.
 */
function PeaoVoador({
  voo,
  cor,
  emBaixaIluminacao,
  onAterrissou,
  quantidadeDePeoes = 4,
}: {
  voo: VooDoPeaoPendente
  cor: CorDoPeao
  emBaixaIluminacao: boolean
  onAterrissou?: (nonce: number) => void
  quantidadeDePeoes?: number
}) {
  const grupo = useRef<Group | null>(null)
  const concluido = useRef(false)
  const inicio = useRef<number | null>(null)
  const invalidate = useThree((estado) => estado.invalidate)
  // Reduce lido uma vez por voo (o overlay remonta por nonce): leitura estável.
  const reduce = useMemo(() => vooReduceAtivo(), [])
  const destinoMundo = useMemo(() => mundoDoPeaoSobreACelula(voo.destino), [voo])
  const origemMundo = useMemo(
    () =>
      'mesaIndice' in voo.origem
        ? peaoMesaParaMundo(voo.origem.mesaIndice, quantidadeDePeoes)
        : mundoDoPeaoSobreACelula(voo.origem),
    [voo, quantidadeDePeoes],
  )

  // Reduce: chegada imediata + baque imediato, uma vez por nonce (efeito, sem temporizador).
  useEffect(() => {
    if (!reduce || concluido.current) return
    concluido.current = true
    tocarBaqueDoPeao()
    onAterrissou?.(voo.nonce)
  }, [reduce, voo.nonce, onAterrissou])

  // Chute inicial do loop sob demanda: garante o primeiro frame do voo.
  useEffect(() => {
    if (!reduce) invalidate()
  }, [reduce, invalidate])

  useFrame(() => {
    if (reduce || concluido.current) return
    const agora = performance.now()
    if (inicio.current === null) inicio.current = agora
    const progresso = Math.min(1, (agora - inicio.current) / VOO_DURACAO_MS)
    const pose = vooPoseEntreMundos(origemMundo, destinoMundo, progresso)
    const alvo = grupo.current
    if (alvo) {
      alvo.position.set(pose.posicao[0], pose.posicao[1], pose.posicao[2])
      alvo.rotation.set(pose.inclinacao[0], 0, pose.inclinacao[1])
    }
    if (progresso >= 1) {
      concluido.current = true
      tocarBaqueDoPeao()
      onAterrissou?.(voo.nonce)
      return
    }
    invalidate()
  })

  if (reduce) {
    return (
      <PeaoVisual
        cor={cor}
        position={destinoMundo}
        emBaixaIluminacao={emBaixaIluminacao}
      />
    )
  }
  return (
    <group ref={grupo} position={origemMundo}>
      <PeaoVisual cor={cor} emBaixaIluminacao={emBaixaIluminacao} />
    </group>
  )
}
