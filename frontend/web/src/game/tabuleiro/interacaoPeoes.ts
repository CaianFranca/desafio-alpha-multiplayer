/**
 * Interação pura do ciclo do Peão (issue #92 — ST-10; roteador de células e
 * despacho unificado da cena/espelho na issue #91; fluxo da Caixa sobre a
 * mesa e escolha de vaga na issue #143).
 *
 * Módulo 100% puro: mapeia cliques simples → comandos wire (UPPER_SNAKE em
 * `@flicker/shared`). Sem Three.js, sem DOM, sem estado interno — todo estado
 * vem do chamador (extraído do store/WS). O feedback de recusa vive no ponto
 * de som da Partida (`components/partida/somDeRecusa.ts`, issue #228): as
 * rejeições locais carregam só o motivo como identificador — este módulo não
 * emite feedback visual nem sonoro.
 *
 * Contrato wire ↔ domínio documentado em `packages/shared/src/peoes.ts`:
 *   shared SELECIONAR_PEAO                  ↔ engine selecionar_peao (idempotente)
 *   shared DESELECIONAR_PEAO                ↔ engine desselecionar_peao (idempotente, #249)
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
 * comando — clicar em outro Peão retorna rejeição com motivo
 * `pendencia_nao_resolvida` (espelhando PENDENCIA_NAO_RESOLVIDA do servidor)
 * e clicar no próprio Peão, permanecer ou mover não reage (tudo precisa ser
 * posicionado antes de mover/permanecer). Clique no próprio Peão já
 * selecionado, sem pendências → PERMANECER. Alvos inválidos não reagem
 * (null); o arrasto permanece reservado à câmera via
 * `deveSuprimirCliquePorArrasto` (limiar 6px, ver cameraLimites.ts).
 *
 * Atribuição de vaga (decisão da issue #143 ajustada na revisão da PR #199):
 * o jogador PUXA a peça corrente clicando na bandeja (estado local) e só
 * então o clique numa célula vazia vizinha disponível atribui a vaga à peça
 * PUXADA — não há mais "primeira pendência sem vaga" automática. Sem peça
 * puxada, o clique de vaga é silencioso (padrão #91: alvos inválidos não
 * reagem). Puxar é restrito ao dono do ciclo (espectador: clique mudo).
 *
 * Guard pós-confirmação (AC3 — review #165): com `posicaoConfirmadaNoTurno`,
 * os alvos que seriam válidos (permanecer/mover) retornam rejeição com motivo
 * `posicao_confirmada` — espelhando o FORA_DA_VEZ do servidor; alvos
 * inválidos seguem silenciosos (null).
 *
 * Gate do PERMANECER por `movimentouNoTurno` (revisão PR #309): como
 * PEAO_MOVIDO mantém o Peão selecionado (#263), o clique no próprio Peão
 * após mover rotearia para PERMANECER — que o engine rejeita com
 * ENCERRAMENTO_INVALIDO (mover já consumiu a decisão do turno). Com
 * `movimentouNoTurno` o clique no próprio Peão fica silencioso; o caminho
 * canônico de encerrar após mover é confirmar → encerrar, e o botão
 * Permanecer só vale ANTES de mover.
 */

import { mapearCliqueNaCelula, mapearCliqueNaPecaPosicionada } from './interacao'
import type { EstadoInteracaoTabuleiro } from './interacao'
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
  Orientacao,
  PeaoComandoDoCliente,
  PendenciaDaPecaSorteada,
  SentidoDeRotacao,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

// ── Estado mínimo para mapear interações ──
// Espelha EstadoDoTabuleiro do engine (peões/ciclo da ST-10 na forma #138)
// desacoplado: só o necessário para a interação; `pecaSelecionadaId` é a
// Peça sorteada em foco (selecionada pela escolha da vaga).

/**
 * Pendência no cliente: a forma sorteada da #138 (o wire já traz o pecaId da
 * peça sorteada da Caixa, com tipo e orientação de composição; a vaga e a
 * célula-alvo podem ser nulas até ESCOLHER_VAGA_DA_PECA_RECEBIDA). A
 * `orientacao` do wire é a de nascimento (o snapshot a repopula na
 * reconexão); o GIRAR_PECA local a atualiza em foco. A pendência só sai
 * da lista no encaixe (PECA_POSICIONADA na célula-alvo).
 */
export interface PendenciaNoCliente extends PendenciaDaPecaSorteada {}

export interface EstadoInteracaoPeoes {
  readonly peoes: readonly PeaoDaExibicao[]
  readonly posicionadas: readonly PecaPosicionada[]
  /** Recebidas aguardando escolha de vaga e encaixe (bloqueiam a seleção de outro Peão). */
  readonly recebidasPendentes: readonly PendenciaNoCliente[]
  readonly peaoSelecionadoId: string | null
  /**
   * Peão do Jogador Ativo (fonte: PartidaPage, do snapshot/turno).
   * Fallback da sequência pendente (#326): se o espelho ficou sem seleção
   * (dessincronia pós-confirmação), as vagas/escolha usam o peão do turno —
   * o engine preserva a seleção do peão confirmado enquanto há pendências.
   */
  readonly peaoDoTurnoId: PeaoId | null
  /** Peça em foco: após a escolha da vaga (#138), o pecaId da Recebida sorteada. */
  readonly pecaSelecionadaId: string | null
  /** A posição do Peão do Jogador Ativo já foi confirmada neste turno (POSICAO_CONFIRMADA). */
  readonly posicaoConfirmadaNoTurno: boolean
  /**
   * O Peão do Jogador Ativo já se moveu neste turno (PEAO_MOVIDO marca a fase
   * no espelho — issue #118). Com o movimento consumado, PERMANECER perde o
   * sentido (o engine rejeita com ENCERRAMENTO_INVALIDO — revisão PR #309):
   * o clique no próprio Peão após mover fica silencioso; encerrar depois de
   * mover é confirmar → encerrar, e Permanecer só vale ANTES de mover.
   */
  readonly movimentouNoTurno: boolean
  /**
   * Recebida "puxada" da bandeja (fluxo aprovado na revisão #199 da issue
   * #143): estado visual LOCAL do jogador — fora do modelo autoritativo.
   * Só com a corrente puxada o clique numa célula de vaga emite
   * ESCOLHER_VAGA para ela.
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
  /**
   * N do roster para o teto do Portão (#284): obrigatório na cadeia
   * PartidaPage→AmbienteDeJogo→interacaoPeoes — o teto é o N real de
   * jogadores, nunca peoes.length (risco 5). Opcional para compatibilidade
   * com testes legados que derivam de peoes.length; a cadeia produtiva
   * sempre fornece o N clampeado.
   */
  readonly quantidadeDeJogadores?: number
}

// ── Resultado de clique/ação do ciclo ──

/**
 * Motivo da rejeição local — identificador estável que o ponto de som de
 * recusa da Partida (`components/partida/somDeRecusa.ts`, issue #228)
 * usa para tocar o som e anunciar ao leitor de tela.
 */
export type MotivoDeRejeicaoLocal = 'pendencia_nao_resolvida' | 'posicao_confirmada'

export interface RejeicaoDeInteracao {
  readonly motivo: MotivoDeRejeicaoLocal
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
 * foi travada neste turno (AC3 — guard client-side do review #165). Motivo
 * próprio, distinto do de pendência (o servidor responde FORA_DA_VEZ nesta
 * situação — partida.ts do engine).
 */
const REJEICAO_POSICAO_CONFIRMADA: ResultadoDeInteracaoDePeao & object = {
  tipo: 'rejeicao',
  rejeicao: {
    motivo: 'posicao_confirmada',
  },
}

// ── Helpers de pendências ──

export function haRecebidasPendentes(
  estado: Pick<EstadoInteracaoPeoes, 'recebidasPendentes'>,
): boolean {
  return estado.recebidasPendentes.length > 0
}

// ── Gate "Inicial primeiro" (issue #249, decisão do usuário) ──

const ORDEM_DA_COR_DO_PEAO: Readonly<Record<string, number>> = {
  branco: 1,
  vermelho: 2,
  azul: 3,
  amarelo: 4,
}

/**
 * Cor inferida do peaoId (`peao-<cor>`, tolerando prefixos como
 * `peao-1-branco` dos mocks): último segmento após `-` quando é cor
 * canônica. Null quando o dono não é inferível (ids sintéticos sem cor).
 */
function corDoPeaoId(peaoId: string): string | null {
  const ultimo = peaoId.split('-').pop() ?? ''
  return ultimo in ORDEM_DA_COR_DO_PEAO ? ultimo : null
}

/**
 * Gate "Inicial primeiro" (issue #249): SELECIONAR_PEAO só é emitido quando
 * a própria Inicial do dono já está posicionada — sem ela em `posicionadas`,
 * a seleção fica silenciosa (null no mapeador, sem comando ao servidor).
 *
 * O dono é inferido pela cor (`peao-branco` → `inicial-1`, espelhando
 * `estadoInicialDaPartida` do engine: ordem ↔ cor ↔ inicial-<ordem>). Sem
 * cor inferível o gate falha fechado (retorna false): ids fora do padrão
 * `peao-<cor>` nunca furam a seleção — o engine só cria `peao-<cor>`.
 */
export function podeSelecionarPeao(
  estado: Pick<EstadoInteracaoPeoes, 'posicionadas'>,
  peaoId: string,
): boolean {
  const cor = corDoPeaoId(peaoId)
  if (cor === null) return false
  const ordem = ORDEM_DA_COR_DO_PEAO[cor]
  const inicialDoDono = `inicial-${ordem}`
  return estado.posicionadas.some((p) => p.pecaId === inicialDoDono)
}

/**
 * Desseleção autoritativa (issue #249): com seleção vigente e sem pendências,
 * emite DESELECIONAR_PEAO para o peão selecionado (o servidor é a autoridade
 * — o cliente nunca desseleciona só no Local). Sem seleção é silenciosa
 * (null); sob pendências retorna rejeição com motivo `pendencia_nao_resolvida`
 * (o domínio rejeitaria com PENDENCIA_NAO_RESOLVIDA) para que o chamador toque
 * a recusa em vez de silenciar o clique-fora.
 */
export function mapearDesselecaoDePeao(
  estado: EstadoInteracaoPeoes,
): ResultadoDeInteracaoDePeao {
  const peaoId = estado.peaoSelecionadoId
  if (peaoId === null) return null
  if (haRecebidasPendentes(estado)) {
    return {
      tipo: 'rejeicao',
      rejeicao: { motivo: 'pendencia_nao_resolvida' },
    }
  }
  return { tipo: 'comando', comando: { type: 'DESELECIONAR_PEAO', peaoId } }
}

// ── Mapeamento clique → comando ──

/**
 * Clique simples no Peão → SELECIONAR_PEAO (seleciona o Peão; o servidor
 * responde RECEBIMENTO_GERADO quando o contexto gera Recebimento). No
 * próprio Peão (já selecionado) → PERMANECER (AC 5) — ou null quando há
 * Recebidas pendentes (permanência exige tudo posicionado e re-seleção não
 * emite comando) ou quando o Peão já se moveu no turno
 * (`movimentouNoTurno` — revisão PR #309: após mover, PERMANECER é
 * ENCERRAMENTO_INVALIDO no engine; o clique fica silencioso). Com
 * pendências, clicar em OUTRO Peão não emite comando e retorna rejeição
 * local (espelha PENDENCIA_NAO_RESOLVIDA). Peão inexistente → null (não
 * reage). Gate "Inicial primeiro" (#249): sem a própria Inicial posicionada,
 * SELECIONAR_PEAO é silencioso (null).
 */
export function mapearCliqueNoPeao(
  estado: EstadoInteracaoPeoes,
  peaoId: string,
): ResultadoDeCliqueNoPeao {
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao) return null
  if (peao.peaoId === estado.peaoSelecionadoId) {
    // Próprio Peão: permanência (AC 5) exige Peão posicionado e tudo
    // posicionado; sobre a Mesa, com Recebidas pendentes ou após mover no
    // turno → null (silencioso). Posição já confirmada neste turno →
    // rejeição âmbar (AC3, review #165).
    if (peao.celula === null) return null
    if (haRecebidasPendentes(estado)) return null
    if (estado.posicaoConfirmadaNoTurno) return REJEICAO_POSICAO_CONFIRMADA
    if (estado.movimentouNoTurno) return null
    return { tipo: 'comando', comando: { type: 'PERMANECER', peaoId } }
  }
  if (haRecebidasPendentes(estado)) {
    return {
      tipo: 'rejeicao',
      rejeicao: { motivo: 'pendencia_nao_resolvida' },
    }
  }
  // Gate "Inicial primeiro" (#249): travar SELECIONAR_PEAO até a própria
  // Inicial estar posicionada — silencioso, sem comando.
  if (!podeSelecionarPeao(estado, peaoId)) return null
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

// O default documentado (M1/review #333) emite UMA vez por sessão: o flag é
// estado de módulo — o warn da PartidaPage cobre a fonte; este cobre os
// consumidores (cena, espelho e testes).
let avisoPeaoDoTurnoAusenteEmitido = false

/**
 * Peão de referência da sequência pendente (#326): a seleção vigente; com
 * Recebidas pendentes e espelho dessincronizado (seleção nula pós-confirmação
 * em bases sem a re-seleção do mover), o Peão do Jogador Ativo cobre a
 * sequência — o engine mantém a seleção do Peão confirmado até o Encerramento.
 * Sem pendências, a referência é só a seleção (comportamento inalterado).
 *
 * Default documentado (M1/review #333): o campo é obrigatório no TS, mas em
 * JS/casts pode chegar `undefined` — normaliza para `null` (`?? null`) e
 * denuncia em DEV, uma vez por sessão. Sem Peão do turno, vagas/escolha
 * ficam inertes em silêncio; o warn torna a invariante visível nos
 * consumidores (cena, espelho e testes).
 */
export function peaoDeReferenciaDaSequencia(
  estado: EstadoInteracaoPeoes,
): string | null {
  if (estado.peaoSelecionadoId !== null) return estado.peaoSelecionadoId
  if (!haRecebidasPendentes(estado)) return null
  const peaoDoTurnoId = estado.peaoDoTurnoId ?? null
  if (import.meta.env.DEV && peaoDoTurnoId === null && !avisoPeaoDoTurnoAusenteEmitido) {
    avisoPeaoDoTurnoAusenteEmitido = true
    console.warn(
      '[interacaoPeoes] Recebidas pendentes sem Peão do Jogador Ativo — vagas/escolha ficam inertes (#326/M1)',
    )
  }
  return peaoDoTurnoId
}

export function vagasDisponiveisDoPeao(
  estado: EstadoInteracaoPeoes,
): { borda: BordaCardinal; celula: Celula }[] {
  const peaoId = peaoDeReferenciaDaSequencia(estado)
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
  if (peaoDeReferenciaDaSequencia(estado) === null) return null
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
 *   - re-clique na já puxada é no-op (null), sem reação repetida;
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
}

/**
 * Despacha o clique na peça da bandeja pelo MESMO mapeador puro (padrão
 * `despacharCliqueDeCelula`): cena (Caixa.tsx) e espelho DOM
 * (TabuleiroMirrorDOM.tsx) compartilham esta função — fonte única da regra
 * de pull. Estado nulo ou clique inválido: nenhuma reação. O pull é
 * silencioso (issue #228): nenhum feedback visual nem sonoro.
 */
export function despacharCliqueNaPecaDaBandeja(
  estadoPeoes: EstadoInteracaoPeoes | null,
  despacho: DespachoDeCliqueNaBandeja,
): void {
  if (estadoPeoes === null) return
  const puxada = mapearCliqueNaPecaDaBandeja(estadoPeoes)
  if (puxada === null) return
  despacho.onPuxar?.(puxada.recebidaId)
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
 * turno → rejeição âmbar (AC3). Após mover no turno (`movimentouNoTurno`) →
 * silencioso (null — revisão PR #309: PERMANECER pós-movimento é
 * ENCERRAMENTO_INVALIDO no engine; encerrar depois de mover é confirmar →
 * encerrar). Fora da célula do Peão, Peão não selecionado ou ainda sobre a
 * Mesa → null (não reage).
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
  if (estado.movimentouNoTurno) return null
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
    estado.quantidadeDeJogadores,
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

/**
 * Peão ainda sobre a Mesa: nunca ocupou uma célula do tabuleiro
 * (`celula === null` — seed do cliente e do engine antes do primeiro
 * POSICIONAR_PEAO). Predicado mantido para destaque/seleção visual — NÃO é
 * mais gate de ciclo (issue #249: a exceção quebrava o invariante
 * ciclo/fallback e foi removida; o ciclo é binário).
 */
export function peaoSobreAMesa(peao: PeaoDaExibicao | undefined): boolean {
  return peao !== undefined && peao.celula === null
}

/**
 * Ciclo ativo (issue #249 — invariante binário restaurado): há Recebidas
 * pendentes OU peão selecionado (qualquer posição, inclusive sobre a Mesa).
 * O servidor é a autoridade da seleção — o cliente nunca roteia por estado
 * local divergente, e a desseleção via DESELECIONAR_PEAO é o único caminho
 * para liberar o fallback ST-09.
 *
 * Tabela de decisão:
 *   - com Recebidas pendentes → true (o encaixe governa; alvos inválidos com
 *     ciclo ativo não reagem em vez de cair no fallback — decisão #91);
 *   - sem seleção → false (fallback ST-09 livre);
 *   - com seleção (posicionado ou sobre a Mesa) → true (suprime o fallback;
 *     a Inicial só posiciona após DESELECIONAR_PEAO + ack — "Inicial primeiro"
 *     exige a ordem: desselecionar o peão antes de POSICIONAR_PECA);
 *   - seleção de peão inexistente → true conservador (estado inconsistente
 *     não libera o fallback).
 */
export function cicloAtivo(estado: EstadoInteracaoPeoes): boolean {
  if (haRecebidasPendentes(estado)) return true
  return estado.peaoSelecionadoId !== null
}

/**
 * Roteador puro do clique em célula durante o ciclo do Peão (issue #91;
 * fluxo de puxar da revisão #199 da issue #143; desseleção autoritativa e
 * ciclo binário da issue #249). Tabela exata de prioridades:
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
 * Sem pendências, com peão selecionado (ciclo ativo — inclusive sobre a
 * Mesa, invariante binário #249):
 *   - célula do próprio peão → PERMANECER (ou rejeição âmbar se a posição já
 *     foi confirmada — AC3; silencioso se o peão já se moveu no turno —
 *     revisão PR #309).
 *   - destino conectado → MOVER_PEAO (ou rejeição âmbar pós-confirmação).
 *   - peão sobre a Mesa e Peça Inicial clicada → POSICIONAR_PEAO.
 *   - demais → null (com ciclo ativo o chamador NÃO aplica o fallback ST-09:
 *     a Inicial só posiciona após DESELECIONAR_PEAO + ack — "Inicial primeiro").
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
  'DESELECIONAR_PEAO',
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
  /** Rejeição local do ciclo (AC3): motivo para o som de recusa, sem comando enviado. */
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
  // e a posição não foi confirmada (alvos inválidos com ciclo ativo não
  // reagem — decisão aprovada #91; com seleção vigente o ciclo está ativo por
  // definição binária — #249 — e só DESELECIONAR_PEAO + ack libera o fallback
  // para a Inicial). Pós-confirmação (B2/review #333) a célula fica muda: a
  // Confirmação trava o Peão e nada mais é clicável no tabuleiro.
  if (
    estadoPeoes !== null &&
    (cicloAtivo(estadoPeoes) || estadoPeoes.posicaoConfirmadaNoTurno)
  )
    return
  despacho.onComando?.(fallbackST09ParaCelula(estadoInteracao, celula))
}

/**
 * Clique em peça da mesa coerente com o ciclo (issue #143): as Peças Iniciais
 * na mesa roteiam o fallback ST-09 (SELECIONAR_PECA — o engine aceita a
 * seleção de iniciais via `encontrarNasIniciais`); com Recebidas pendentes a
 * rota fica silenciosa (null), preservando o foco de encaixe da peça sorteada
 * (padrão de bloqueio local da #91). Pós-confirmação (B2/review #333) a Mesa
 * fica muda: a Confirmação trava o Peão e a seleção de peças não existe mais
 * no turno. Clique fora das iniciais conhecidas da mesa → null (o roteador
 * puro valida a identidade da peça).
 */
export function mapearCliqueNaPecaDaMesa(
  estadoPeoes: EstadoInteracaoPeoes | null,
  estadoInteracao: EstadoInteracaoTabuleiro,
  pecaId: string,
): TabuleiroComandoDoCliente | null {
  if (
    estadoPeoes !== null &&
    (haRecebidasPendentes(estadoPeoes) || estadoPeoes.posicaoConfirmadaNoTurno)
  )
    return null
  if (!estadoInteracao.iniciais.some((p) => p.pecaId === pecaId)) return null
  return { type: 'SELECIONAR_PECA', pecaId }
}

// ── Arrasto reservado à câmera (reuso do limiar 6px da ST-09) ──

export { deveSuprimirCliquePorArrasto } from './interacao'