/**
 * Interação pura do ciclo do Peão (issue #92 — ST-10).
 *
 * Módulo 100% puro: mapeia cliques simples → comandos wire (UPPER_SNAKE em
 * `@flicker/shared`) e eventos de servidor → feedback visual (flash branco /
 * vermelho). Sem Three.js, sem DOM, sem estado interno — todo estado vem do
 * chamador (extraído do store/WS).
 *
 * Contrato wire ↔ domínio documentado em `packages/shared/src/peoes.ts`:
 *   shared SELECIONAR_PEAO             ↔ engine selecionar_peao (idempotente)
 *   shared POSICIONAR_PEAO             ↔ engine posicionar_peao (1º posicionamento)
 *   shared ESCOLHER_TIPO_DA_PECA_RECEBIDA ↔ engine escolher_tipo_da_peca_recebida
 *   shared MOVER_PEAO                  ↔ engine mover_peao (vizinha conectada)
 *   shared PERMANECER                  ↔ engine permanecer (próprio peão/Peça sob ele)
 *   O encaixe da Recebida reusa o contrato do Tabuleiro: GIRAR_PECA /
 *   POSICIONAR_PECA com o pecaId da Recebida (o pecaId chega no wire via
 *   TIPO_DA_PECA_RECEBIDA_ESCOLHIDO e fica em pecaSelecionadaId) e a
 *   célula-alvo fixada no Recebimento.
 *
 * Bloqueio local de pendências: com Recebidas não posicionadas, não emite
 * comando — clicar em outro Peão retorna rejeição (FLASH_VERMELHO,
 * espelhando PENDENCIA_NAO_RESOLVIDA do servidor) e clicar no próprio Peão,
 * permanecer ou mover não reage (tudo precisa ser posicionado antes de
 * mover/permanecer). Clique no próprio Peão já selecionado, sem pendências →
 * PERMANECER. Alvos inválidos não reagem (null); o arrasto permanece
 * reservado à câmera via `deveSuprimirCliquePorArrasto` (limiar 6px, ver
 * cameraLimites.ts).
 */

import { FLASH_BRANCO, FLASH_VERMELHO } from './interacao'
import type { FlashFeedback } from './interacao'
import {
  chaveCelula,
  destinosConectadosDoPeao,
  encontrarPecaNaCelula,
} from './contrato'
import type { Celula, PeaoDaExibicao, PecaPosicionada, TipoDaPeca } from './contrato'
import type {
  ErroDoTabuleiroEvento,
  ManipulacaoFinalizadaEvento,
  PeaoComandoDoCliente,
  PeaoEventoDoServidor,
  PecaGiradaEvento,
  PecaPosicionadaEvento,
  PendenciaDeRecebimento,
  SentidoDeRotacao,
  TabuleiroComandoDoCliente,
  TipoDePecaDeCaminho,
} from '@flicker/shared'

// ── Estado mínimo para mapear interações ──
// Espelha EstadoDoTabuleiro do engine (peões/ciclo da ST-10) desacoplado:
// só o necessário para a interação; `reserva` carrega o tipo disponível para
// a escolha das Recebidas e `pecaSelecionadaId` é a Recebida em foco (pecaId
// chega no wire via TIPO_DA_PECA_RECEBIDA_ESCOLHIDO).

export interface EstadoInteracaoPeoes {
  readonly peoes: readonly PeaoDaExibicao[]
  readonly posicionadas: readonly PecaPosicionada[]
  /** Recebidas aguardando escolha de tipo e encaixe (bloqueiam a seleção de outro Peão). */
  readonly recebidasPendentes: readonly PendenciaDeRecebimento[]
  readonly peaoSelecionadoId: string | null
  /** Peça em sequência: após ESCOLHER_TIPO, o pecaId da Recebida em foco. */
  readonly pecaSelecionadaId: string | null
  /** Tipos de Peça de Caminho disponíveis para a escolha das Recebidas. */
  readonly reserva: readonly { readonly pecaId: string; readonly tipo: TipoDaPeca }[]
}

// ── Resultado do clique no Peão ──

export interface RejeicaoDeInteracao {
  readonly motivo: 'pendencia_nao_resolvida'
  /** Feedback da rejeição local — sempre FLASH_VERMELHO (distinto do branco). */
  readonly feedback: FlashFeedback
}

export type ResultadoDeCliqueNoPeao =
  | { readonly tipo: 'comando'; readonly comando: PeaoComandoDoCliente }
  | { readonly tipo: 'rejeicao'; readonly rejeicao: RejeicaoDeInteracao }
  | null

// ── Helpers de pendências / reserva ──

export function haRecebidasPendentes(
  estado: Pick<EstadoInteracaoPeoes, 'recebidasPendentes'>,
): boolean {
  return estado.recebidasPendentes.length > 0
}

/** Tipos de caminho (reta|T|cruz) com peça disponível na Reserva, em ordem canônica. */
export function tiposDeCaminhoDisponiveisNaReserva(
  reserva: readonly { readonly tipo: TipoDaPeca }[],
): readonly TipoDePecaDeCaminho[] {
  const presentes = new Set<TipoDaPeca>(reserva.map((p) => p.tipo))
  return TIPOS_DE_CAMINHO.filter((tipo) => presentes.has(tipo))
}

const TIPOS_DE_CAMINHO: readonly TipoDePecaDeCaminho[] = ['reta', 'T', 'cruz']

// ── Mapeamento clique → comando ──

/**
 * Clique simples no Peão → SELECIONAR_PEAO (seleciona o Peão; o servidor
 * responde RECEBIMENTO_GERADO quando o contexto gera Recebimento). No
 * próprio Peão (já selecionado) → PERMANECER (AC 5) — ou null quando há
 * Recebidas pendentes (permanência exige tudo posicionado e re-seleção não
 * emite comando). Com pendências, clicar em OUTRO Peão não emite comando e
 * retorna rejeição local (espelha PENDENCIA_NAO_RESOLVIDA). Peão
 * inexistente → null (não reage).
 */
export function mapearCliqueNoPeao(
  estado: EstadoInteracaoPeoes,
  peaoId: string,
): ResultadoDeCliqueNoPeao {
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao) return null
  if (peao.peaoId === estado.peaoSelecionadoId) {
    // Próprio Peão: permanência (AC 5) exige Peão posicionado e tudo
    // posicionado; sobre a Mesa ou com Recebidas pendentes → null.
    if (peao.celula === null) return null
    if (haRecebidasPendentes(estado)) return null
    return { tipo: 'comando', comando: { type: 'PERMANECER', peaoId } }
  }
  if (haRecebidasPendentes(estado)) {
    return {
      tipo: 'rejeicao',
      rejeicao: { motivo: 'pendencia_nao_resolvida', feedback: FLASH_VERMELHO },
    }
  }
  return { tipo: 'comando', comando: { type: 'SELECIONAR_PEAO', peaoId } }
}

/**
 * Clique na Peça Inicial → primeiro posicionamento do Peão selecionado
 * (POSICIONAR_PEAO). Outras peças, célula vazia, Peão sem seleção, sem Peça
 * sob ele (na Mesa) ou já posicionado → null (não emite o comando).
 */
export function mapearCliqueNaPecaInicial(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): PeaoComandoDoCliente | null {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return null
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula !== null) return null
  const peca = encontrarPecaNaCelula(estado.posicionadas, celula)
  if (!peca || peca.tipo !== 'inicial') return null
  return { type: 'POSICIONAR_PEAO', peaoId, celula }
}

/**
 * Escolha do tipo de cada Recebida pendente → ESCOLHER_TIPO_DA_PECA_RECEBIDA.
 * A oferta vem da Reserva: tipo sem peça disponível não gera comando (null);
 * a sequência exige Peão selecionado e a Recebida pendente existente.
 */
export function mapearEscolhaDeTipoDaRecebida(
  estado: EstadoInteracaoPeoes,
  recebidaId: string,
  tipoDaPeca: TipoDePecaDeCaminho,
): PeaoComandoDoCliente | null {
  if (estado.peaoSelecionadoId === null) return null
  const pendente = estado.recebidasPendentes.some(
    (r) => r.recebidaId === recebidaId,
  )
  if (!pendente) return null
  if (!tiposDeCaminhoDisponiveisNaReserva(estado.reserva).includes(tipoDaPeca)) {
    return null
  }
  return { type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA', recebidaId, tipoDaPeca }
}

/**
 * Giro da Recebida em foco (pecaId em pecaSelecionadaId, setado pela escolha
 * do tipo — ST-09) → GIRAR_PECA, orientação livre em passos de 90°. Sem
 * Recebida em foco → null.
 */
export function mapearGirarRecebida(
  estado: EstadoInteracaoPeoes,
  sentido: SentidoDeRotacao,
): TabuleiroComandoDoCliente | null {
  const pecaId = estado.pecaSelecionadaId
  if (pecaId === null) return null
  return { type: 'GIRAR_PECA', pecaId, sentido }
}

/**
 * Encaixe da Recebida em foco → POSICIONAR_PECA para a célula clicada. Só a
 * célula-alvo fixada no Recebimento (a vizinha correspondente à borda
 * geradora) aceita o encaixe; célula que não é alvo de nenhuma Recebida
 * pendente não reage (null). Como a pendência não carrega o pecaId da
 * Recebida, a correspondência fina entre foco e alvo é validada pelo
 * servidor (PECA_FORA_DO_ALVO). Sem Recebida em foco → null.
 */
export function mapearPosicionarRecebida(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): TabuleiroComandoDoCliente | null {
  const pecaId = estado.pecaSelecionadaId
  if (pecaId === null) return null
  const ehAlvoDePendencia = estado.recebidasPendentes.some(
    (pendencia) => chaveCelula(pendencia.celulaAlvo) === chaveCelula(celula),
  )
  if (!ehAlvoDePendencia) return null
  return { type: 'POSICIONAR_PECA', pecaId, celula }
}

/**
 * Clique no próprio Peão ou na Peça sob ele (ambos na célula do Peão
 * selecionado) → PERMANECER. Exige tudo posicionado (US 15: recebidas
 * pendentes antes de permanecer → não reage). Fora da célula do Peão, Peão
 * não selecionado ou ainda sobre a Mesa → null (não reage).
 */
export function mapearPermanencia(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): PeaoComandoDoCliente | null {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return null
  if (haRecebidasPendentes(estado)) return null
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return null
  if (chaveCelula(peao.celula) !== chaveCelula(celula)) return null
  return { type: 'PERMANECER', peaoId }
}

/**
 * Clique em Peça vizinha conectada destacada do Peão selecionado →
 * MOVER_PEAO. Exige tudo posicionado (US 15: recebidas pendentes antes de
 * mover → não reage). Destino não conectado, ocupado por outro Peão ou Peão
 * sem seleção/posicionado → null (alvos inválidos não reagem ao clique).
 */
export function mapearMovimentacao(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): PeaoComandoDoCliente | null {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return null
  if (haRecebidasPendentes(estado)) return null
  const destinos = destinosConectadosDoPeao(
    estado.posicionadas,
    estado.peoes,
    peaoId,
  )
  const conectada = destinos.some(
    (p) => chaveCelula(p.celula) === chaveCelula(celula),
  )
  if (!conectada) return null
  return { type: 'MOVER_PEAO', peaoId, celula }
}

// ── Mapeamento evento → feedback visual ──

/** Eventos do ciclo do Peão + reusos do Tabuleiro que chegam no mesmo canal. */
export type EventoDoCicloDoPeao =
  | PeaoEventoDoServidor
  | PecaPosicionadaEvento
  | PecaGiradaEvento
  | ManipulacaoFinalizadaEvento
  | ErroDoTabuleiroEvento

/**
 * Traduz evento do servidor em flash: aprovação/seleção → branco; rejeição
 * (ERRO_DO_TABULEIRO) → vermelho (distinto do branco, duração maior).
 */
export function mapearEventoPeaoParaFeedback(
  evento: EventoDoCicloDoPeao,
): FlashFeedback {
  switch (evento.type) {
    case 'PEAO_SELECIONADO':
    case 'RECEBIMENTO_GERADO':
    case 'PEAO_POSICIONADO':
    case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO':
    case 'PEAO_MOVIDO':
    case 'PEAO_PERMANECEU':
    case 'PECA_POSICIONADA':
    case 'PECA_GIRADA':
    case 'MANIPULACAO_FINALIZADA':
      return FLASH_BRANCO
    case 'ERRO_DO_TABULEIRO':
      return FLASH_VERMELHO
    default: {
      // Exaustividade: novo evento wire sem case falha em compilação.
      const _exaustivo: never = evento
      return _exaustivo
    }
  }
}

// ── Arrasto reservado à câmera (reuso do limiar 6px da ST-09) ──

export { deveSuprimirCliquePorArrasto } from './interacao'