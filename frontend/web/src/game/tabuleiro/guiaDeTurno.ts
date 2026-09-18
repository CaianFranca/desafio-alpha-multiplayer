/**
 * Guia de turno (issue #441) — máquina de etapas pura + persistência mínima.
 *
 * Máquina 100% pura: lê o modelo existente (sem estado novo no domínio) e
 * devolve a etapa atual `{ id, texto, alvo }` ou `null` (sem guia). Sem
 * Three.js, sem DOM, sem som — o feedback ao agir é o normal do jogo e o
 * guia avança sozinho conforme o modelo muda.
 *
 * Fluxos (decisão da #441):
 * - Primeiro Turno (rodada 1): turno → Inicial → tabuleiro → giro/OK
 *   (só texto) → peão → destino → bandeja (1 ciclo) → vagas → encerrar. O
 *   passo de confirmação do peão (`guia-inicial-confirmar`) é global — no
 *   Primeiro Turno o faseamento leva direto a encerrar, então ele surge
 *   quando há confirmação pendente (fase `confirmar`, em geral após a
 *   Movimentação) e vence até a travessia informativa (ação antes de texto).
 * - turno seguinte: peão → permanecer → movimentação; depois o guia termina
 *   (`fluxoNormalConcluido`, zerado por Partida). Permanecer avança ao
 *   exibir (o passo da movimentação fixa no momento da escolha).
 * - travessia: passo automático vira texto informativo transitório, sem
 *   alvo — nunca memorizado e nunca acima de ação pendente.
 *
 * Memória "já ensinado" (zerada por Partida, só sessão/montagem):
 * só os passos de exibição única — turno, giro/OK, confirmação, bandeja,
 * vagas, permanecer. Turno e permanecer avançam ao exibir (transitórios por
 * condição com o passo seguinte e cedem a ele no mesmo ciclo — o card
 * seguinte carrega a mesma informação para nada se perder). Giro,
 * confirmação e vagas fixam enquanto a condição vale e entram ao concluir;
 * a bandeja fixa 1 ciclo antes das vagas. Os demais repetem enquanto a
 * condição do modelo valer (ex.: encerrar reaparece após o encaixe).
 * Amedrontado nunca tem guia (o turno é pulado) e fora do turno nunca há
 * guia (espectador).
 *
 * Alvos restritos ao acionável do dono do turno; o destaque é só visual
 * (`data-guia="true"`, contorno tracejado ciano) e nunca bloqueia cliques.
 */

/** Alvo acionável do dono do turno (ou null = texto informativo). */
export type AlvoDoGuiaDeTurno =
  | 'turno'
  | 'inicial-propria'
  | 'tabuleiro'
  | 'peao-proprio'
  | 'destino-proprio'
  | 'botao-confirmar'
  | 'bandeja'
  | 'vagas'
  | 'botao-encerrar'
  | 'botao-permanecer'
  | 'destino'

export interface EtapaDoGuiaDeTurno {
  readonly id: string
  readonly texto: string
  readonly alvo: AlvoDoGuiaDeTurno | null
}

export type FaseDoTurnoDoGuia = 'permanecer' | 'confirmar' | 'encerrar' | null

export interface EntradaDoGuiaDeTurno {
  readonly meuTurno: boolean
  readonly amedrontado: boolean
  readonly guiaLigado: boolean
  readonly rodada: number | null
  readonly inicialPropriaNaMesa: boolean
  readonly inicialPropriaPosicionada: boolean
  readonly inicialPropriaEmFoco: boolean
  readonly temManipulacao: boolean
  readonly temPreviewEmFoco: boolean
  readonly peaoSelecionadoEhProprio: boolean
  readonly peaoProprioPosicionado: boolean
  readonly posicaoConfirmadaNoTurno: boolean
  readonly movimentouNoTurno: boolean
  readonly atravessouNoTurno: boolean
  readonly temRecebidaPendente: boolean
  readonly faseDoTurno: FaseDoTurnoDoGuia
  /** Passos de exibição única já mostrados nesta Partida. */
  readonly ensinados: ReadonlySet<string>
  /** Turno seguinte (pós-Primeiro Turno) já encerrado (o guia termina depois dele). */
  readonly fluxoNormalConcluido: boolean
}

const TEXTO_TURNO = 'Seu turno — veja a ordem do turno.'
const TEXTO_INICIAL = 'Seu turno — selecione sua Peça Inicial.'
const TEXTO_TABULEIRO = 'Escolha uma célula livre no tabuleiro.'
const TEXTO_GIRO = 'Gire a peça e confirme com OK.'
const TEXTO_PEAO = 'Selecione seu peão.'
const TEXTO_DESTINO = 'Coloque o peão na sua peça.'
const TEXTO_CONFIRMAR = 'Confirme a posição do peão.'
const TEXTO_BANDEJA = 'Puxe a peça sorteada da bandeja.'
const TEXTO_VAGAS = 'Puxe a peça da bandeja e encaixe nas vagas.'
const TEXTO_ENCERRAR = 'Encerre seu turno.'
const TEXTO_NORMAL_PEAO = 'Selecione seu peão para agir.'
const TEXTO_NORMAL_PERMANECER = 'Ou permaneça para encerrar.'
const TEXTO_NORMAL_MOVIMENTACAO = 'Desloque seu peão para uma peça vizinha conectada.'
const TEXTO_TRAVESSIA = 'Travessia feita — continue seu turno.'

export const ID_TURNO = 'guia-inicial-turno'
export const ID_GIRO = 'guia-inicial-giro'
export const ID_CONFIRMAR = 'guia-inicial-confirmar'
export const ID_BANDEJA = 'guia-inicial-bandeja'
export const ID_VAGAS = 'guia-inicial-vagas'
export const ID_NORMAL_PERMANECER = 'guia-normal-permanecer'

/** Passos de exibição única por Partida (turno, giro/OK, confirmação, bandeja, vagas, permanecer). */
const PASSOS_DE_EXIBICAO_UNICA: ReadonlySet<string> = new Set([
  ID_TURNO,
  ID_GIRO,
  ID_CONFIRMAR,
  ID_BANDEJA,
  ID_VAGAS,
  ID_NORMAL_PERMANECER,
])

/**
 * Subconjunto que avança ao exibir (turno, permanecer): dividem a condição
 * com o passo seguinte e cedem a ele no mesmo ciclo — o card seguinte
 * carrega a mesma informação (turno → Inicial; permanecer → movimentação),
 * então nada se perde. A bandeja fixa 1 ciclo inteiro (exibição única, sem
 * avanço imediato): o ciano acende na corrente antes das vagas.
 */
const PASSOS_DE_AVANCO_IMEDIATO: ReadonlySet<string> = new Set([
  ID_TURNO,
  ID_NORMAL_PERMANECER,
])

/**
 * Etapa atual do guia ou null (sem guia). Ordem = prioridade: o primeiro
 * passo disponível e ainda não ensinado (quando de exibição única) vence.
 */
export function etapaDoGuiaDeTurno(entrada: EntradaDoGuiaDeTurno): EtapaDoGuiaDeTurno | null {
  if (!entrada.guiaLigado) return null
  if (!entrada.meuTurno) return null
  if (entrada.amedrontado) return null
  const jaEnsinado = (id: string): boolean => entrada.ensinados.has(id)
  // Confirmação pendente (global): uma vez por Partida, em qualquer rodada —
  // no Primeiro Turno o faseamento leva direto a encerrar. Vence a travessia
  // informativa abaixo: ação pendente antes de texto transitório.
  if (entrada.faseDoTurno === 'confirmar' && !jaEnsinado(ID_CONFIRMAR)) {
    return { id: ID_CONFIRMAR, texto: TEXTO_CONFIRMAR, alvo: 'botao-confirmar' }
  }
  // Travessia (ADR-0017): passo automático vira texto informativo
  // transitório, sem alvo — nunca memorizado, nunca acima de ação.
  if (entrada.atravessouNoTurno) {
    return { id: 'guia-travessia-info', texto: TEXTO_TRAVESSIA, alvo: null }
  }
  if (entrada.rodada === 1) {
    if (!entrada.inicialPropriaPosicionada && !entrada.peaoProprioPosicionado && !jaEnsinado(ID_TURNO)) {
      return { id: ID_TURNO, texto: TEXTO_TURNO, alvo: 'turno' }
    }
    if (entrada.inicialPropriaNaMesa && !entrada.inicialPropriaEmFoco && !entrada.inicialPropriaPosicionada) {
      return { id: 'guia-inicial-inicial', texto: TEXTO_INICIAL, alvo: 'inicial-propria' }
    }
    if (
      !entrada.inicialPropriaPosicionada &&
      (entrada.inicialPropriaEmFoco || !entrada.inicialPropriaNaMesa) &&
      !entrada.temManipulacao &&
      !entrada.temPreviewEmFoco
    ) {
      return { id: 'guia-inicial-tabuleiro', texto: TEXTO_TABULEIRO, alvo: 'tabuleiro' }
    }
    // Giro/OK é só texto informativo (sem alvo acionável): os controles de
    // giro/OK seguem clicáveis, sem contorno do guia e sem peça em guia.
    if ((entrada.temManipulacao || entrada.temPreviewEmFoco) && !jaEnsinado(ID_GIRO)) {
      return { id: ID_GIRO, texto: TEXTO_GIRO, alvo: null }
    }
    if (
      entrada.inicialPropriaPosicionada &&
      !entrada.peaoProprioPosicionado &&
      !entrada.peaoSelecionadoEhProprio &&
      !entrada.temManipulacao &&
      !entrada.temPreviewEmFoco
    ) {
      return { id: 'guia-inicial-peao', texto: TEXTO_PEAO, alvo: 'peao-proprio' }
    }
    if (
      entrada.inicialPropriaPosicionada &&
      !entrada.peaoProprioPosicionado &&
      entrada.peaoSelecionadoEhProprio &&
      !entrada.temManipulacao &&
      !entrada.temPreviewEmFoco
    ) {
      return { id: 'guia-inicial-destino', texto: TEXTO_DESTINO, alvo: 'destino-proprio' }
    }
    if (entrada.temRecebidaPendente && !entrada.temManipulacao && !entrada.temPreviewEmFoco && !jaEnsinado(ID_BANDEJA)) {
      return { id: ID_BANDEJA, texto: TEXTO_BANDEJA, alvo: 'bandeja' }
    }
    if (entrada.temRecebidaPendente && !entrada.temManipulacao && !entrada.temPreviewEmFoco && !jaEnsinado(ID_VAGAS)) {
      return { id: ID_VAGAS, texto: TEXTO_VAGAS, alvo: 'vagas' }
    }
    if (entrada.faseDoTurno === 'encerrar') {
      return { id: 'guia-inicial-encerrar', texto: TEXTO_ENCERRAR, alvo: 'botao-encerrar' }
    }
    return null
  }
  // Fluxo normal: só no turno seguinte — depois o guia termina.
  if (entrada.rodada !== 1 && !entrada.fluxoNormalConcluido) {
    if (!entrada.peaoSelecionadoEhProprio && !entrada.movimentouNoTurno && !entrada.posicaoConfirmadaNoTurno) {
      return { id: 'guia-normal-peao', texto: TEXTO_NORMAL_PEAO, alvo: 'peao-proprio' }
    }
    if (entrada.faseDoTurno === 'permanecer' && !jaEnsinado(ID_NORMAL_PERMANECER)) {
      return { id: ID_NORMAL_PERMANECER, texto: TEXTO_NORMAL_PERMANECER, alvo: 'botao-permanecer' }
    }
    if (
      entrada.peaoSelecionadoEhProprio &&
      !entrada.movimentouNoTurno &&
      !entrada.posicaoConfirmadaNoTurno &&
      entrada.faseDoTurno === 'permanecer'
    ) {
      return { id: 'guia-normal-movimentacao', texto: TEXTO_NORMAL_MOVIMENTACAO, alvo: 'destino' }
    }
  }
  return null
}

/** Passo de exibição única (memória "já ensinado" avança ao exibir/concluir). */
export function passoDeExibicaoUnica(id: string): boolean {
  return PASSOS_DE_EXIBICAO_UNICA.has(id)
}

/** Passo que avança ao exibir (cede ao seguinte no mesmo ciclo). */
export function passoDeAvancoImediato(id: string): boolean {
  return PASSOS_DE_AVANCO_IMEDIATO.has(id)
}

// ── Persistência mínima (navegador) ──
// Só o switch global persiste em `localStorage` (default ligado). A memória
// "já ensinado" é zerada por Partida: vive só na sessão/montagem (estado
// local da página), nunca no armazenamento. As chaves legadas escopadas por
// partidaId (`guia-de-turno-ensinados:*`,
// `guia-de-turno-normal-concluido:*`) são expiradas na montagem/troca de
// Partida. Guards para ambiente sem `window` (testes unitários puros / SSR
// nunca montam, mas a máquina é importável).

const CHAVE_GUIA_LIGADO = 'guia-do-jogador:ligado'

function chaveEnsinados(partidaId: string): string {
  return `guia-de-turno-ensinados:${partidaId}`
}

function chaveNormalConcluido(partidaId: string): string {
  return `guia-de-turno-normal-concluido:${partidaId}`
}

/** Expira as chaves legadas por Partida (migração: memória agora é só sessão). */
export function expirarMemoriaLegadaDoGuia(partidaId: string | null): void {
  if (partidaId === null) return
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(chaveEnsinados(partidaId))
    window.localStorage.removeItem(chaveNormalConcluido(partidaId))
  } catch {
    // Sem armazenamento, nada a expirar.
  }
}

/** Switch "Guia do Jogador" (default ligado). */
export function lerGuiaLigado(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true
    return window.localStorage.getItem(CHAVE_GUIA_LIGADO) !== '0'
  } catch {
    return true
  }
}

export function salvarGuiaLigado(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_GUIA_LIGADO, ligado ? '1' : '0')
  } catch {
    // Armazenamento indisponível (privado/congelado): o switch segue em
    // memória na sessão — sem quebrar a Partida.
  }
}
