/**
 * Interação pura do ciclo do Peão (issue #92 — ST-10; roteador de células e
 * despacho unificado da cena/espelho na issue #91).
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
 *
 * Guard pós-confirmação (AC3 — review #165): com `posicaoConfirmadaNoTurno`,
 * os alvos que seriam válidos (permanecer/mover) retornam rejeição âmbar com
 * motivo `posicao_confirmada` — espelhando o FORA_DA_VEZ do servidor; alvos
 * inválidos seguem silenciosos (null).
 */

import { FLASH_AMBAR, FLASH_BRANCO, FLASH_VERMELHO } from './interacao'
import type { FlashFeedback, EstadoInteracaoTabuleiro } from './interacao'
import { mapearCliqueNaCelula, mapearCliqueNaPecaPosicionada, mapearCliqueNaReserva } from './interacao'
import {
  chaveCelula,
  destinosConectadosDoPeao,
  encontrarPecaNaCelula,
} from './contrato'
import type { Celula, PeaoDaExibicao, PecaPosicionada, TipoDaPeca } from './contrato'
import type {
  ErroDoTabuleiroEvento,
  ManipulacaoFinalizadaEvento,
  PecaDeselecionadaEvento,
  PeaoComandoDoCliente,
  PeaoEventoDoServidor,
  PendenciaDaPecaSorteada,
  PendenciaDeRecebimento,
  PecaGiradaEvento,
  PecaPosicionadaEvento,
  PecaSelecionadaEvento,
  PosicaoConfirmadaEvento,
  RecebidaId,
  SentidoDeRotacao,
  TabuleiroComandoDoCliente,
  TipoDePecaDeCaminho,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

// ── Estado mínimo para mapear interações ──
// Espelha EstadoDoTabuleiro do engine (peões/ciclo da ST-10) desacoplado:
// só o necessário para a interação; `reserva` carrega o tipo disponível para
// a escolha das Recebidas e `pecaSelecionadaId` é a Recebida em foco (pecaId
// chega no wire via TIPO_DA_PECA_RECEBIDA_ESCOLHIDO).

/**
 * Pendência no cliente (issue #91): campos do wire + campo client-side
 * `pecaId` — null até o evento TIPO_DA_PECA_RECEBIDA_ESCOLHIDO preencher na
 * forma LEGADA (ST-10); na forma NOVA (#138) o wire já traz o pecaId da peça
 * sorteada e a celulaAlvo pode ser null (vaga ainda não escolhida). A
 * pendência só sai da lista no encaixe (PECA_POSICIONADA na célula-alvo).
 */
export type PendenciaNoCliente =
  // Legado ST-10 (@deprecated): borda geradora e célula-alvo fixas na criação,
  // com pecaId client-side preenchido por TIPO_DA_PECA_RECEBIDA_ESCOLHIDO.
  | (PendenciaDeRecebimento & { readonly pecaId: string | null })
  // Novo (#138): a peça já vem sorteada da Caixa (pecaId + tipo + vaga) e a
  // célula-alvo deriva da vaga — pode estar null até ESCOLHER_VAGA_DA_PECA_RECEBIDA.
  | PendenciaDaPecaSorteada

export interface EstadoInteracaoPeoes {
  readonly peoes: readonly PeaoDaExibicao[]
  readonly posicionadas: readonly PecaPosicionada[]
  /** Recebidas aguardando escolha de tipo e encaixe (bloqueiam a seleção de outro Peão). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  readonly peaoSelecionadoId: string | null
  /** Peça em sequência: após ESCOLHER_TIPO, o pecaId da Recebida em foco. */
  readonly pecaSelecionadaId: string | null
  /** Tipos de Peça de Caminho disponíveis para a escolha das Recebidas. */
  readonly reserva: readonly { readonly pecaId: string; readonly tipo: TipoDaPeca }[]
  /** A posição do Peão do Jogador Ativo já foi confirmada neste turno (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
}

// ── Resultado de clique/ação do ciclo ──

export interface RejeicaoDeInteracao {
  readonly motivo: 'pendencia_nao_resolvida' | 'posicao_confirmada'
  /**
   * Feedback da rejeição local: FLASH_VERMELHO para pendências (erro real);
   * FLASH_AMBAR com motivo próprio para ação pós-confirmação (espelha o
   * FORA_DA_VEZ que o servidor responderia).
   */
  readonly feedback: FlashFeedback
}

/** Comando, rejeição com feedback ou nenhuma reação do ciclo do Peão. */
export type ResultadoDeInteracaoDePeao =
  | { readonly tipo: 'comando'; readonly comando: PeaoComandoDoCliente }
  | { readonly tipo: 'rejeicao'; readonly rejeicao: RejeicaoDeInteracao }
  | null

/** Resultado do clique no Peão (mesma forma do resultado do ciclo). */
export type ResultadoDeCliqueNoPeao = ResultadoDeInteracaoDePeao

/**
 * Rejeição pós-confirmação: o comando seria válido, mas a posição do Peão já
 * foi travada neste turno (AC3 — guard client-side do review #165). Âmbar
 * com motivo próprio, distinto do vermelho de pendência (o servidor responde
 * FORA_DA_VEZ nesta situação — partida.ts do engine).
 */
const REJEICAO_POSICAO_CONFIRMADA: ResultadoDeInteracaoDePeao & object = {
  tipo: 'rejeicao',
  rejeicao: {
    motivo: 'posicao_confirmada',
    feedback: { ...FLASH_AMBAR, motivo: 'posicao_confirmada' },
  },
}

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
    // posicionado; sobre a Mesa ou com Recebidas pendentes → null. Posição
    // já confirmada neste turno → rejeição âmbar (AC3, review #165).
    if (peao.celula === null) return null
    if (haRecebidasPendentes(estado)) return null
    if (estado.posicaoConfirmadaNoTurno) return REJEICAO_POSICAO_CONFIRMADA
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
    (pendencia) =>
      // Forma nova (#138): célula-alvo ainda indefinida (null) até o sorteio
      // fixar a vaga — não é encaixável por esta rota legada.
      pendencia.celulaAlvo !== null &&
      chaveCelula(pendencia.celulaAlvo) === chaveCelula(celula),
  )
  if (!ehAlvoDePendencia) return null
  return { type: 'POSICIONAR_PECA', pecaId, celula }
}

/**
 * Clique no próprio Peão ou na Peça sob ele (ambos na célula do Peão
 * selecionado) → PERMANECER. Exige tudo posicionado (US 15: recebidas
 * pendentes antes de permanecer → não reage). Posição já confirmada neste
 * turno → rejeição âmbar (AC3). Fora da célula do Peão, Peão não selecionado
 * ou ainda sobre a Mesa → null (não reage).
 */
export function mapearPermanencia(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): ResultadoDeInteracaoDePeao {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return null
  if (haRecebidasPendentes(estado)) return null
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return null
  if (chaveCelula(peao.celula) !== chaveCelula(celula)) return null
  if (estado.posicaoConfirmadaNoTurno) return REJEICAO_POSICAO_CONFIRMADA
  return { tipo: 'comando', comando: { type: 'PERMANECER', peaoId } }
}

/**
 * Clique em Peça vizinha conectada destacada do Peão selecionado →
 * MOVER_PEAO. Exige tudo posicionado (US 15: recebidas pendentes antes de
 * mover → não reage). Posição já confirmada neste turno → rejeição âmbar
 * (AC3). Destino não conectado, ocupado por outro Peão ou Peão sem
 * seleção/posicionado → null (alvos inválidos não reagem ao clique).
 */
export function mapearMovimentacao(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): ResultadoDeInteracaoDePeao {
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
  if (estado.posicaoConfirmadaNoTurno) return REJEICAO_POSICAO_CONFIRMADA
  return { tipo: 'comando', comando: { type: 'MOVER_PEAO', peaoId, celula } }
}

// ── Roteador do clique em célula do Tabuleiro (issue #91) ──

/**
 * Resultado do clique em célula com o ciclo ativo: comando do ciclo (peão ou
 * tabuleiro — POSICIONAR_PECA da Recebida), rejeição local com feedback
 * (guard pós-confirmação, AC3), foco de uma pendência sem tipo, ou null
 * (alvo inválido não reage; sem ciclo ativo o chamador aplica o fallback
 * ST-09).
 */
export type ResultadoDeCliqueEmCelula =
  | { readonly ciclo: PeaoComandoDoCliente | TabuleiroComandoDoCliente }
  | { readonly rejeicao: RejeicaoDeInteracao }
  | { readonly focarPendencia: RecebidaId }
  | null

/** Converte o resultado do mapeador do ciclo em resultado do roteador. */
function resultadoDoMapeadorParaCelula(
  resultado: Exclude<ResultadoDeInteracaoDePeao, null>,
): Exclude<ResultadoDeCliqueEmCelula, null> {
  return resultado.tipo === 'comando'
    ? { ciclo: resultado.comando }
    : { rejeicao: resultado.rejeicao }
}

/** Ciclo ativo: há Recebidas pendentes OU peão selecionado (suprime o fallback ST-09). */
export function cicloAtivo(estado: EstadoInteracaoPeoes): boolean {
  return haRecebidasPendentes(estado) || estado.peaoSelecionadoId !== null
}

/**
 * Roteador puro do clique em célula durante o ciclo do Peão (issue #91).
 * Tabela exata de prioridades:
 *
 * Com pendências:
 *   - célula = célula-alvo de pendência SEM tipo (pecaId null) → focar
 *     (foco local; troca de foco permitida).
 *   - célula = célula-alvo de pendência COM tipo e pendência.pecaId ===
 *     pecaSelecionadaId → POSICIONAR_PECA (encaixe; coerência tríplice:
 *     célula-alvo + peça escolhida + peça em foco).
 *   - demais (alvo tipado divergente da seleção, célula não-alvo) → null.
 *
 * Sem pendências, com peão selecionado:
 *   - célula do próprio peão → PERMANECER (ou rejeição âmbar se a posição já
 *     foi confirmada — AC3).
 *   - destino conectado → MOVER_PEAO (ou rejeição âmbar pós-confirmação).
 *   - peão sobre a Mesa e Peça Inicial clicada → POSICIONAR_PEAO.
 *   - demais → null.
 *
 * Sem ciclo ativo → null (o chamador aplica o fallback ST-09).
 */
export function rotearCliqueDeCelula(
  estadoPeoes: EstadoInteracaoPeoes,
  _estadoInteracao: EstadoInteracaoTabuleiro,
  celula: Celula,
): ResultadoDeCliqueEmCelula {
  if (haRecebidasPendentes(estadoPeoes)) {
    const pendencia = estadoPeoes.recebidasPendentes.find(
      (r) =>
        // Forma nova (#138): célula-alvo ainda indefinida (null) até o sorteio
        // fixar a vaga — não é encaixável por esta rota legada.
        r.celulaAlvo !== null && chaveCelula(r.celulaAlvo) === chaveCelula(celula),
    )
    if (!pendencia) return null
    if (pendencia.pecaId === null) return { focarPendencia: pendencia.recebidaId }
    // Pendência tipada: encaixe exige a peça escolhida em foco; seleção
    // divergente (ex.: peça de Reserva selecionada — estado stale) → null.
    if (pendencia.pecaId !== estadoPeoes.pecaSelecionadaId) return null
    const encaixe = mapearPosicionarRecebida(estadoPeoes, celula)
    // Não-null por construção (pecaSelecionadaId = pendência.pecaId ≠ null e
    // célula = alvo da pendência); guardo por tipagem.
    return encaixe === null ? null : { ciclo: encaixe }
  }
  if (estadoPeoes.peaoSelecionadoId !== null) {
    const permanencia = mapearPermanencia(estadoPeoes, celula)
    if (permanencia) return resultadoDoMapeadorParaCelula(permanencia)
    const movimento = mapearMovimentacao(estadoPeoes, celula)
    if (movimento) return resultadoDoMapeadorParaCelula(movimento)
    // Peão ainda sobre a Mesa: primeiro posicionamento na Peça Inicial
    // (mapearCliqueNaPecaInicial já exige peão sem célula).
    const posicionamento = mapearCliqueNaPecaInicial(estadoPeoes, celula)
    if (posicionamento) return { ciclo: posicionamento }
    return null
  }
  return null
}

/**
 * Fallback ST-09 para célula sem ciclo ativo: peça posicionada → finalização
 * de manipulação (via SELECIONAR_PECA); célula vazia com seleção →
 * POSICIONAR_PECA; demais → null.
 */
function fallbackST09ParaCelula(
  estadoInteracao: EstadoInteracaoTabuleiro,
  celula: Celula,
): TabuleiroComandoDoCliente | null {
  const chave = chaveCelula(celula)
  const peca =
    estadoInteracao.posicionadas.find(
      (p) => chaveCelula(p.celula) === chave,
    ) ?? null
  return peca !== null
    ? mapearCliqueNaPecaPosicionada(estadoInteracao, peca.pecaId)
    : mapearCliqueNaCelula(estadoInteracao, celula)
}

// ── Despacho unificado (cena e espelho DOM usam o MESMO roteador) ──

const TIPOS_DE_COMANDO_DE_PEAO: ReadonlySet<string> = new Set([
  'SELECIONAR_PEAO',
  'POSICIONAR_PEAO',
  'ESCOLHER_TIPO_DA_PECA_RECEBIDA',
  'MOVER_PEAO',
  'PERMANECER',
])

/** Type guard: comando do ciclo do Peão (tipos wire disjuntos dos do Tabuleiro). */
export function ehComandoDePeao(
  comando: PeaoComandoDoCliente | TabuleiroComandoDoCliente,
): comando is PeaoComandoDoCliente {
  return TIPOS_DE_COMANDO_DE_PEAO.has(comando.type)
}

export interface DespachoDeCliqueEmCelula {
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
  onFocarPendencia?: (recebidaId: RecebidaId) => void
  /** Rejeição local do ciclo (AC3): feedback para flash, sem comando enviado. */
  onRejeicao?: (rejeicao: RejeicaoDeInteracao) => void
}

/**
 * Despacha o clique em célula roteando por `rotearCliqueDeCelula`; com ciclo
 * inativo, aplica o fallback ST-09 existente. Cena (Tabuleiro.tsx) e espelho
 * DOM (TabuleiroMirrorDOM.tsx) compartilham esta função — fonte única.
 */
export function despacharCliqueDeCelula(
  estadoPeoes: EstadoInteracaoPeoes | null,
  estadoInteracao: EstadoInteracaoTabuleiro,
  celula: Celula,
  despacho: DespachoDeCliqueEmCelula,
): void {
  const resultado =
    estadoPeoes !== null
      ? rotearCliqueDeCelula(estadoPeoes, estadoInteracao, celula)
      : null
  if (resultado !== null) {
    if ('focarPendencia' in resultado) {
      despacho.onFocarPendencia?.(resultado.focarPendencia)
      return
    }
    if ('rejeicao' in resultado) {
      despacho.onRejeicao?.(resultado.rejeicao)
      return
    }
    if (ehComandoDePeao(resultado.ciclo)) {
      despacho.onComandoPeao?.(resultado.ciclo)
    } else {
      despacho.onComando?.(resultado.ciclo)
    }
    return
  }
  // Sem resultado do roteador: fallback ST-09 só quando o ciclo está inativo
  // (alvos inválidos com ciclo ativo não reagem — decisão aprovada #91).
  if (estadoPeoes !== null && cicloAtivo(estadoPeoes)) return
  despacho.onComando?.(fallbackST09ParaCelula(estadoInteracao, celula))
}

/**
 * Clique em peça da Reserva coerente com o ciclo: com Recebidas pendentes, a
 * Reserva oferta o tipo da peça clicada para a pendência focada (foco ausente,
 * foco inválido ou peça inicial → null); sem pendências, mantém o ST-09
 * (mapearCliqueNaReserva → SELECIONAR_PECA).
 */
export function mapearCliqueNaReservaComCiclo(
  estadoPeoes: EstadoInteracaoPeoes | null,
  estadoInteracao: EstadoInteracaoTabuleiro,
  recebidaFocadaId: RecebidaId | null,
  peca: { readonly pecaId: string; readonly tipo: TipoDaPeca },
): PeaoComandoDoCliente | TabuleiroComandoDoCliente | null {
  if (estadoPeoes !== null && haRecebidasPendentes(estadoPeoes)) {
    if (recebidaFocadaId === null || peca.tipo === 'inicial') return null
    if (peca.tipo !== 'reta' && peca.tipo !== 'T' && peca.tipo !== 'cruz') return null
    return mapearEscolhaDeTipoDaRecebida(estadoPeoes, recebidaFocadaId, peca.tipo)
  }
  return mapearCliqueNaReserva(estadoInteracao, peca.pecaId)
}

// ── Mapeamento evento → feedback visual ──

/** Eventos do ciclo do Peão + reusos do Tabuleiro que chegam no mesmo canal,
 * + eventos de turno (ST-11, issue #118) para o feedback unificado da página. */
export type EventoDoCicloDoPeao =
  | PeaoEventoDoServidor
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaPosicionadaEvento
  | PecaGiradaEvento
  | ManipulacaoFinalizadaEvento
  | ErroDoTabuleiroEvento
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento

/**
 * Traduz evento do servidor em flash (issue #118): aprovação/seleção →
 * branco; rejeição → vermelho, com motivo específico para pendências; ação
 * fora da vez → âmbar (distinto do erro); Confirmação de Posição → branco;
 * abertura/encerramento de turno → null (sem flash).
 */
export function mapearEventoPeaoParaFeedback(
  evento: EventoDoCicloDoPeao,
): FlashFeedback | null {
  switch (evento.type) {
    case 'PEAO_SELECIONADO':
    case 'RECEBIMENTO_GERADO':
    case 'PEAO_POSICIONADO':
    case 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO':
    case 'PEAO_MOVIDO':
    case 'PEAO_PERMANECEU':
    case 'PECA_SELECIONADA':
    case 'PECA_DESELECIONADA':
    case 'PECA_POSICIONADA':
    case 'PECA_GIRADA':
    case 'MANIPULACAO_FINALIZADA':
    case 'POSICAO_CONFIRMADA':
      return FLASH_BRANCO
    case 'ERRO_DO_TABULEIRO':
      if (evento.codigo === 'FORA_DA_VEZ') return FLASH_AMBAR
      if (evento.codigo === 'PENDENCIA_NAO_RESOLVIDA') {
        return { ...FLASH_VERMELHO, motivo: 'pendencia_nao_resolvida' }
      }
      return FLASH_VERMELHO
    case 'TURNO_INICIADO':
    case 'TURNO_ENCERRADO':
      // Passagem de vez não é flash: o destaque do ativo e o indicador de
      // rodada comunicam a mudança (issue #118).
      return null
    default: {
      // Exaustividade: novo evento wire sem case falha em compilação.
      const _exaustivo: never = evento
      return _exaustivo
    }
  }
}

// ── Arrasto reservado à câmera (reuso do limiar 6px da ST-09) ──

export { deveSuprimirCliquePorArrasto } from './interacao'