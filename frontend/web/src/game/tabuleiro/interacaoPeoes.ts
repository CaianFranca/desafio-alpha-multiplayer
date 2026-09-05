/**
 * Interação pura do ciclo do Peão (issue #92 — ST-10; roteador de células e
 * despacho unificado da cena/espelho na issue #91; fluxo da Caixa sobre a
 * mesa e escolha de vaga na issue #143).
 *
 * Módulo 100% puro: mapeia cliques simples → comandos wire (UPPER_SNAKE em
 * `@flicker/shared`) e eventos de servidor → feedback visual (flash branco /
 * vermelho). Sem Three.js, sem DOM, sem estado interno — todo estado vem do
 * chamador (extraído do store/WS).
 *
 * Contrato wire ↔ domínio documentado em `packages/shared/src/peoes.ts`:
 *   shared SELECIONAR_PEAO                  ↔ engine selecionar_peao (idempotente)
 *   shared POSICIONAR_PEAO                  ↔ engine posicionar_peao (1º posicionamento)
 *   shared ESCOLHER_VAGA_DA_PECA_RECEBIDA   ↔ engine escolher_vaga_da_peca_recebida (#138)
 *   shared MOVER_PEAO                       ↔ engine mover_peao (vizinha conectada)
 *   shared PERMANECER                       ↔ engine permanecer (próprio peão/Peça sob ele)
 *   O encaixe da Recebida reusa o contrato do Tabuleiro: GIRAR_PECA /
 *   POSICIONAR_PECA com o pecaId da Peça sorteada (que chega no wire em
 *   RECEBIMENTO_GERADO e fica em pecaSelecionadaId após a escolha da vaga)
 *   e a célula-alvo derivada da vaga escolhida.
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
 * Atribuição de vaga (decisão da issue #143 ajustada na revisão da PR #199):
 * o jogador PUXA a peça corrente clicando na bandeja (estado local) e só
 * então o clique numa célula vazia vizinha disponível atribui a vaga à peça
 * PUXADA — não há mais "primeira pendência sem vaga" automática. Sem peça
 * puxada, o clique de vaga é silencioso (padrão #91: alvos inválidos não
 * reagem). Puxar é restrito ao dono do ciclo (espectador: clique mudo).
 *
 * Guard pós-confirmação (AC3 — review #165): com `posicaoConfirmadaNoTurno`,
 * os alvos que seriam válidos (permanecer/mover) retornam rejeição âmbar com
 * motivo `posicao_confirmada` — espelhando o FORA_DA_VEZ do servidor; alvos
 * inválidos seguem silenciosos (null).
 */

import { FLASH_AMBAR, FLASH_BRANCO, FLASH_VERMELHO } from './interacao'
import type { FlashFeedback, EstadoInteracaoTabuleiro } from './interacao'
import { mapearCliqueNaCelula, mapearCliqueNaPecaPosicionada } from './interacao'
import {
  bordasAbertas,
  chaveCelula,
  destinosConectadosDoPeao,
  encontrarPecaNaCelula,
  estaDentroDaGrade,
} from './contrato'
import type {
  Celula,
  PeaoDaExibicao,
  PeaoId,
  PecaPosicionada,
} from './contrato'
import type {
  BordaCardinal,
  ErroDoTabuleiroEvento,
  ManipulacaoFinalizadaEvento,
  Orientacao,
  PecaDeselecionadaEvento,
  PeaoComandoDoCliente,
  PeaoEventoDoServidor,
  PendenciaDaPecaSorteada,
  PecaGiradaEvento,
  PecaPosicionadaEvento,
  PecaSelecionadaEvento,
  PosicaoConfirmadaEvento,
  SentidoDeRotacao,
  TabuleiroComandoDoCliente,
  TurnoEncerradoEvento,
  TurnoIniciadoEvento,
} from '@flicker/shared'

// ── Estado mínimo para mapear interações ──
// Espelha EstadoDoTabuleiro do engine (peões/ciclo da ST-10 na forma #138)
// desacoplado: só o necessário para a interação; `pecaSelecionadaId` é a
// Peça sorteada em foco (selecionada pela escolha da vaga).

/**
 * Pendência no cliente: a forma sorteada da #138 (o wire já traz o pecaId da
 * peça sorteada da Caixa; a vaga e a célula-alvo podem ser nulas até
 * ESCOLHER_VAGA_DA_PECA_RECEBIDA). `orientacao` é metadado client-side do
 * GIRAR_PECA em foco — o snapshot a popula na reconexão. A pendência só sai
 * da lista no encaixe (PECA_POSICIONADA na célula-alvo).
 */
export interface PendenciaNoCliente extends PendenciaDaPecaSorteada {
  readonly orientacao?: Orientacao
}

export interface EstadoInteracaoPeoes {
  readonly peoes: readonly PeaoDaExibicao[]
  readonly posicionadas: readonly PecaPosicionada[]
  /** Recebidas aguardando escolha de vaga e encaixe (bloqueiam a seleção de outro Peão). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  readonly peaoSelecionadoId: string | null
  /** Peça em foco: após a escolha da vaga (#138), o pecaId da Recebida sorteada. */
  readonly pecaSelecionadaId: string | null
  /** A posição do Peão do Jogador Ativo já foi confirmada neste turno (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
  /**
   * Recebida "puxada" da bandeja (fluxo aprovado na revisão #199 da issue
   * #143): estado visual LOCAL do jogador — fora do modelo autoritativo, no
   * padrão `peaoSelecionadoIdLocal` (AmbienteDeJogo). Só com a corrente
   * puxada o clique numa célula de vaga emite ESCOLHER_VAGA para ela.
   */
  readonly recebidaPuxadaId?: string | null
  /**
   * O jogador local é o dono do ciclo (`jogadorAtivoId === jogadorIdLocal`).
   * Espectador (`false`) não puxa: o clique na bandeja fica silencioso, mas a
   * bandeja CONTINUA pública (pendências vêm do broadcast). `undefined` =
   * gate não avaliado (unidades puras sem identidade local).
   */
  readonly donoDoCiclo?: boolean
  /**
   * Projeção mínima dos peões AFETADOS (Baixa Iluminação ∨ Amedrontado —
   * predicado espelhado de engine/partida.ts:1484). Menor shape coerente com
   * este módulo: um Set de peaoIds, derivado no pai (PartidaPage) de
   * `jogadorPorId` × `peaoPorJogador` (snapshot + deltas de ATAQUE/RESGATE
   * #174) — o módulo permanece puro e sem mapa de jogadores. Alimenta a
   * exceção de ocupação de resgate (+1 teto, issue #171) em
   * `destinosConectadosDoPeao`; ausente/vazio = percepção ainda não chegou
   * (peças ocupadas por não-afetados ficam bloqueadas — conservador).
   */
  readonly afetadosPorPeaoId?: ReadonlySet<PeaoId>
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

// ── Helpers de pendências ──

export function haRecebidasPendentes(
  estado: Pick<EstadoInteracaoPeoes, 'recebidasPendentes'>,
): boolean {
  return estado.recebidasPendentes.length > 0
}

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

const DESLOCAMENTO_DA_BORDA: Record<BordaCardinal, Celula> = {
  norte: { linha: -1, coluna: 0 },
  leste: { linha: 0, coluna: 1 },
  sul: { linha: 1, coluna: 0 },
  oeste: { linha: 0, coluna: -1 },
}

function celulaVizinhaNaBorda(celula: Celula, borda: BordaCardinal): Celula | null {
  const d = DESLOCAMENTO_DA_BORDA[borda]
  const vizinha = { linha: celula.linha + d.linha, coluna: celula.coluna + d.coluna }
  if (!estaDentroDaGrade(vizinha)) return null
  return vizinha
}

export function vagasDisponiveisDoPeao(
  estado: EstadoInteracaoPeoes,
): { borda: BordaCardinal; celula: Celula }[] {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return []
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return []
  const origem = encontrarPecaNaCelula(estado.posicionadas, peao.celula)
  if (!origem) return []
  const bordas = bordasAbertas(origem)
  const jaEscolhidas = new Set<BordaCardinal>(
    estado.recebidasPendentes
      .map((r) => r.vaga)
      .filter((v): v is BordaCardinal => v !== null),
  )
  const vagas: { borda: BordaCardinal; celula: Celula }[] = []
  for (const borda of bordas) {
    if (jaEscolhidas.has(borda)) continue
    const celula = celulaVizinhaNaBorda(origem.celula, borda)
    if (!celula || encontrarPecaNaCelula(estado.posicionadas, celula)) continue
    vagas.push({ borda, celula })
  }
  return vagas
}

export function mapearEscolhaDeVagaDaRecebida(
  estado: EstadoInteracaoPeoes,
  recebidaId: string,
  borda: BordaCardinal,
): PeaoComandoDoCliente | null {
  if (estado.peaoSelecionadoId === null) return null
  const pendente = estado.recebidasPendentes.find(
    (r) => r.recebidaId === recebidaId,
  )
  if (!pendente) return null
  if (pendente.vaga !== null) return null
  const vagaValida = vagasDisponiveisDoPeao(estado).some((v) => v.borda === borda)
  if (!vagaValida) return null
  return {
    type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
    recebidaId,
    borda,
  }
}

/**
 * Resultado do clique na peça corrente da bandeja: o `recebidaId` a ser
 * puxado (estado LOCAL do chamador — nenhum comando de wire; o pull não é
 * regra do engine, é gesto de interação do cliente).
 */
export interface PuxadaDaBandeja {
  readonly recebidaId: string
}

/**
 * Clique na peça corrente da bandeja → "puxar" (fluxo aprovado na revisão
 * #199 da issue #143). Regras:
 *   - só a CORRENTE (primeira pendência sem vaga) é puxável;
 *   - espectador (`donoDoCiclo === false`) não puxa — clique silencioso, a
 *     bandeja continua pública (a corrente é exibida a todos);
 *   - re-clique na já puxada é no-op (null), sem emissão repetida de flash;
 *   - sem pendências correntes → null.
 * O consumo do pull: com a vaga escolhida o engine move a peça para
 * `pecaSelecionadaId` e a próxima corrente exige novo pull.
 */
export function mapearCliqueNaPecaDaBandeja(
  estado: EstadoInteracaoPeoes,
  puxadaAtual: string | null = estado.recebidaPuxadaId ?? null,
): PuxadaDaBandeja | null {
  if (estado.donoDoCiclo === false) return null
  const corrente = estado.recebidasPendentes.find((r) => r.vaga === null)
  if (corrente === undefined) return null
  if (puxadaAtual === corrente.recebidaId) return null
  return { recebidaId: corrente.recebidaId }
}

/**
 * A corrente da bandeja está puxada (pull vigente)? Derivação do estado
 * LOCAL, fora do modelo autoritativo — fonte única do destaque emissivo
 * (Caixa), do destaque de vaga (AmbienteDeJogo) e do `data-puxada` do
 * espelho DOM. Mesma derivação de corrente do mapeador de pull (primeira
 * pendência sem vaga); pull antigo (vaga escolhida ou pendência encaixada)
 * não conta como vigente.
 */
export function puxadaVigenteNaBandeja(estado: EstadoInteracaoPeoes): boolean {
  const corrente = estado.recebidasPendentes.find((r) => r.vaga === null)
  return corrente !== undefined && estado.recebidaPuxadaId === corrente.recebidaId
}

export interface DespachoDeCliqueNaBandeja {
  /** Pull aceito: o chamador (React) persiste o id como estado visual local. */
  onPuxar?: (recebidaId: string) => void
  /**
   * Feedback local do pull (FLASH_BRANCO). O destaque emissivo na peça é
   * derivado do pull (`destacada` no padrão PecaPlaceholder), não daqui.
   */
  onFeedback?: (feedback: FlashFeedback) => void
}

/**
 * Despacha o clique na peça da bandeja pelo MESMO mapeador puro (padrão
 * `despacharCliqueDeCelula`): cena (Caixa.tsx) e espelho DOM
 * (TabuleiroMirrorDOM.tsx) compartilham esta função — fonte única da regra
 * de pull. Estado nulo ou clique inválido: nenhuma reação.
 */
export function despacharCliqueNaPecaDaBandeja(
  estadoPeoes: EstadoInteracaoPeoes | null,
  despacho: DespachoDeCliqueNaBandeja,
): void {
  if (estadoPeoes === null) return
  const puxada = mapearCliqueNaPecaDaBandeja(estadoPeoes)
  if (puxada === null) return
  despacho.onPuxar?.(puxada.recebidaId)
  despacho.onFeedback?.(FLASH_BRANCO)
}

// ── Peça operável do ciclo (guard de coerência — revisão #199, JF532 5.3) ──

/**
 * Recebida sobre a qual girar/encaixar podem agir: o `pecaId` em foco deve
 * pertencer a uma pendência real do ciclo, nunca a uma peça divergente.
 * Regra fina que mantém o fluxo puxar→vaga→encaixe funcional:
 *   - pendência COM vaga: após ESCOLHER_VAGA o engine move a peça para
 *     `pecaSelecionadaId` e o pull pode já ter sido consumido (ou substituído
 *     pela próxima corrente) — o encaixe/giro seguem a pendência travada na
 *     vaga, não o pull;
 *   - pendência SEM vaga: só é operável enquanto for a peça PUXADA da bandeja
 *     (o pull é o único modo de uma peça sem vaga entrar no fluxo).
 */
function recebidaOperavel(
  estado: EstadoInteracaoPeoes,
  pecaId: string,
): PendenciaNoCliente | null {
  const pendencia = estado.recebidasPendentes.find((r) => r.pecaId === pecaId)
  if (pendencia === undefined) return null
  if (pendencia.vaga !== null) return pendencia
  return estado.recebidaPuxadaId === pendencia.recebidaId ? pendencia : null
}

/**
 * Giro da Recebida em foco → GIRAR_PECA, orientação livre em passos de 90°.
 * Guard de coerência (#199): só opera sobre a Recebida operável do ciclo —
 * pendência com vaga escolhida (peça movida para `pecaSelecionadaId` pelo
 * engine após a escolha) ou corrente puxada sem vaga. Peça em foco divergente
 * (fora do ciclo ou pendência intocada) → null.
 */
export function mapearGirarRecebida(
  estado: EstadoInteracaoPeoes,
  sentido: SentidoDeRotacao,
): TabuleiroComandoDoCliente | null {
  const pecaId = estado.pecaSelecionadaId
  if (pecaId === null) return null
  if (recebidaOperavel(estado, pecaId) === null) return null
  return { type: 'GIRAR_PECA', pecaId, sentido }
}

/**
 * Encaixe da Recebida em foco → POSICIONAR_PECA para a célula clicada. Só a
 * célula-alvo derivada da vaga escolhida (a vizinha correspondente à borda
 * aberta da Peça sob o Peão) aceita o encaixe; célula que não é alvo de
 * nenhuma Recebida pendente não reage (null). Guard de coerência (#199): o
 * alvo precisa pertencer à PRÓPRIA peça em foco (match pecaId↔célula-alvo da
 * pendência) — alvo de outra pendência com foco divergente fica silencioso.
 * Sem Recebida em foco → null.
 */
export function mapearPosicionarRecebida(
  estado: EstadoInteracaoPeoes,
  celula: Celula,
): TabuleiroComandoDoCliente | null {
  const pecaId = estado.pecaSelecionadaId
  if (pecaId === null) return null
  const pendencia = estado.recebidasPendentes.find(
    (r) =>
      r.pecaId === pecaId &&
      // Célula-alvo só existe após a escolha da vaga (#138) — sem vaga, a
      // pendência ainda não é encaixável por esta rota.
      r.celulaAlvo !== null &&
      chaveCelula(r.celulaAlvo) === chaveCelula(celula),
  )
  if (pendencia === undefined) return null
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
 * (AC3). Destino não conectado, peça comum ocupada por Peão não-afetado,
 * peça no teto de ocupação (Portão 4, demais 1; +1 com afetado — espelho do
 * engine em contrato.ts) ou Peão sem seleção/posicionado → null (alvos
 * inválidos não reagem ao clique). Destino de RESGATE (peça com peão
 * AFETADO sob teto elevado) emite o MESMO comando `MOVER_PEAO` — o resgate é
 * efeito atômico do pouso no engine (partida.ts:675-712), não um comando novo
 * no wire.
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
    estado.afetadosPorPeaoId,
  )
  const conectada = destinos.some(
    (d) => chaveCelula(d.peca.celula) === chaveCelula(celula),
  )
  if (!conectada) return null
  if (estado.posicaoConfirmadaNoTurno) return REJEICAO_POSICAO_CONFIRMADA
  return { tipo: 'comando', comando: { type: 'MOVER_PEAO', peaoId, celula } }
}

// ── Roteador do clique em célula do Tabuleiro (issue #91) ──

/**
 * Resultado do clique em célula com o ciclo ativo: comando do ciclo (peão ou
 * tabuleiro — POSICIONAR_PECA da Recebida), rejeição local com feedback
 * (guard pós-confirmação, AC3), ou null (alvo inválido não reage; sem ciclo
 * ativo o chamador aplica o fallback ST-09).
 */
export type ResultadoDeCliqueEmCelula =
  | { readonly ciclo: PeaoComandoDoCliente | TabuleiroComandoDoCliente }
  | { readonly rejeicao: RejeicaoDeInteracao }
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
 * Roteador puro do clique em célula durante o ciclo do Peão (issue #91;
 * fluxo de puxar da revisão #199 da issue #143). Tabela exata de prioridades:
 *
 * Com pendências:
 *   - célula = vaga disponível E há pendência PUXADA sem vaga →
 *     ESCOLHER_VAGA para a recebida puxada (fluxo #143/revisão #199: a vaga
 *     vai para a peça puxada da bandeja — sem puxada ativa, ou com a puxada
 *     já encaminhada, o clique de vaga é silencioso).
 *   - célula = célula-alvo de pendência com pendência.pecaId ===
 *     pecaSelecionadaId → POSICIONAR_PECA (encaixe; coerência tripla:
 *     célula-alvo + vaga escolhida + peça em foco).
 *   - demais (alvo em foco divergente da seleção, célula não-alvo) → null.
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
    const temVagaPendente = estadoPeoes.recebidasPendentes.some(
      (r) => r.vaga === null,
    )
    if (temVagaPendente) {
      const vagas = vagasDisponiveisDoPeao(estadoPeoes)
      const vaga = vagas.find((v) => chaveCelula(v.celula) === chaveCelula(celula))
      if (vaga) {
        // A vaga vai para a peça PUXADA da bandeja (fluxo #143/revisão #199):
        // a puxada precisa existir, seguir sem vaga e estar na lista — pull
        // antigo (pendência encaixada ou vaga já encaminhada) não contempla
        // nova peça: exige novo pull.
        const puxadaId = estadoPeoes.recebidaPuxadaId ?? null
        const alvo =
          puxadaId !== null
            ? estadoPeoes.recebidasPendentes.find(
                (r) => r.recebidaId === puxadaId && r.vaga === null,
              )
            : undefined
        if (alvo) {
          const comando = mapearEscolhaDeVagaDaRecebida(
            estadoPeoes,
            alvo.recebidaId,
            vaga.borda,
          )
          if (comando) return { ciclo: comando }
        }
        return null
      }
    }
    const pendencia = estadoPeoes.recebidasPendentes.find(
      (r) => r.celulaAlvo !== null && chaveCelula(r.celulaAlvo) === chaveCelula(celula),
    )
    if (!pendencia) return null
    if (pendencia.pecaId !== estadoPeoes.pecaSelecionadaId) return null
    const encaixe = mapearPosicionarRecebida(estadoPeoes, celula)
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
  'ESCOLHER_VAGA_DA_PECA_RECEBIDA',
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
 * Clique em peça da mesa coerente com o ciclo (issue #143): as Peças Iniciais
 * na mesa roteiam o fallback ST-09 (SELECIONAR_PECA — o engine aceita a
 * seleção de iniciais via `encontrarNasIniciais`); com Recebidas pendentes a
 * rota fica silenciosa (null), preservando o foco de encaixe da peça sorteada
 * (padrão de bloqueio local da #91). Clique fora das iniciais conhecidas da
 * mesa → null (o roteador puro valida a identidade da peça).
 */
export function mapearCliqueNaPecaDaMesa(
  estadoPeoes: EstadoInteracaoPeoes | null,
  estadoInteracao: EstadoInteracaoTabuleiro,
  pecaId: string,
): TabuleiroComandoDoCliente | null {
  if (estadoPeoes !== null && haRecebidasPendentes(estadoPeoes)) return null
  if (!estadoInteracao.iniciais.some((p) => p.pecaId === pecaId)) return null
  return { type: 'SELECIONAR_PECA', pecaId }
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
  | import('@flicker/shared').VagaDaPecaRecebidaEscolhidaEvento
  | import('@flicker/shared').PecaSorteadaEvento

/**
 * Traduz evento do servidor em flash (issue #118): aprovação/seleção →
 * branco; rejeição → vermelho, com motivo específico para pendências e Caixa
 * esgotada (issue #143); ação fora da vez → âmbar (distinto do erro);
 * Confirmação de Posição → branco; abertura/encerramento de turno e sorteio
 * (a bandeja comunica a peça corrente) → null (sem flash).
 */
export function mapearEventoPeaoParaFeedback(
  evento: EventoDoCicloDoPeao,
): FlashFeedback | null {
  switch (evento.type) {
    case 'PEAO_SELECIONADO':
    case 'RECEBIMENTO_GERADO':
    case 'PEAO_POSICIONADO':
    case 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO':
    case 'PEAO_MOVIDO':
    case 'PEAO_PERMANECEU':
    case 'PECA_SELECIONADA':
    case 'PECA_DESELECIONADA':
    case 'PECA_POSICIONADA':
    case 'PECA_GIRADA':
    case 'MANIPULACAO_FINALIZADA':
    case 'POSICAO_CONFIRMADA':
      return FLASH_BRANCO
    case 'PECA_SORTEADA':
      return null
    case 'ERRO_DO_TABULEIRO':
      if (evento.codigo === 'FORA_DA_VEZ') return FLASH_AMBAR
      if (evento.codigo === 'PENDENCIA_NAO_RESOLVIDA') {
        return { ...FLASH_VERMELHO, motivo: 'pendencia_nao_resolvida' }
      }
      if (evento.codigo === 'CAIXA_ESGOTADA') {
        // Sorteio sem peças na Caixa (issue #143): flash vermelho com motivo.
        // Rota DEFENSIVA (#145-exp F5): nenhum comando do wire invoca a
        // primitiva sortearDaCaixa que produz este código (engine/
        // tabuleiro.ts:504-507) — o Recebimento (#138) esvazia sem erro e o
        // término por Caixa chega via PARTIDA_TERMINADA com motivo
        // 'caixa_esgotada' (F2/F4). Mantida para rejeições explícitas de um
        // servidor autoritativo; não remover.
        return { ...FLASH_VERMELHO, motivo: 'caixa_esgotada' }
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