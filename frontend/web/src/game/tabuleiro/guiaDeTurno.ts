/**
 * Guia de turno (issue #441) — máquina de etapas pura + persistência mínima.
 *
 * Máquina 100% pura: lê o modelo existente (sem estado novo no domínio) e
 * devolve a etapa atual `{ id, texto, alvo }` ou `null` (sem guia). Sem
 * Three.js, sem DOM, sem som — o feedback ao agir é o normal do jogo e o
 * guia avança sozinho conforme o modelo muda.
 *
 * Fluxos (decisão da #441):
 * - inicial (rodada 1): turno → Inicial → tabuleiro → giro/OK → peão →
 *   destino → bandeja → vagas → encerrar. O passo de confirmação do peão
 *   (`guia-inicial-confirmar`) é global — no Primeiro Turno o faseamento leva
 *   direto a encerrar, então ele surge quando há confirmação pendente
 *   (fase `confirmar`, em geral pós-mover) e vence até a travessia
 *   informativa (ação antes de texto).
 * - normal (turno seguinte): peão → permanecer → mover; depois o
 *   guia termina (`fluxoNormalConcluido`, zerado por Partida). Permanecer
 *   avança ao exibir (o passo mover fixa no momento da escolha).
 * - travessia: passo automático vira texto informativo transitório, sem
 *   alvo — nunca memorizado e nunca acima de ação pendente.
 *
 * Memória "já ensinado" (zerada por Partida, chave escopada por partidaId):
 * só os passos de exibição única — turno, giro/OK, confirmação, bandeja,
 * vagas, permanecer. Turno, bandeja e permanecer avançam ao exibir
 * (transitórios por condição com o passo seguinte e cedem a ele no mesmo
 * ciclo — o card seguinte carrega a mesma informação para nada se perder).
 * Giro, confirmação e vagas fixam enquanto a condição vale e entram ao
 * concluir. Os demais repetem enquanto a condição do modelo valer (ex.:
 * encerrar reaparece após o encaixe). Amedrontado nunca tem guia (o turno é
 * pulado) e fora do turno nunca há guia (espectador).
 *
 * Alvos restritos ao acionável do dono do turno; o destaque é só visual
 * (`data-guia="true"`, contorno tracejado ciano) e nunca bloqueia cliques.
 */

/** Alvo acionável do dono do turno (ou null = texto informativo). */
export type AlvoDoGuiaDeTurno =
  | 'vez'
  | 'inicial-propria'
  | 'tabuleiro'
  | 'manipulacao'
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
  readonly minhaVez: boolean
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

const TEXTO_VEZ = 'Seu turno — veja a ordem do turno.'
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
const TEXTO_NORMAL_MOVER = 'Desloque seu peão para uma peça vizinha conectada.'
const TEXTO_TRAVESSIA = 'Travessia feita — continue seu turno.'

export const ID_VEZ = 'guia-inicial-vez'
export const ID_GIRO = 'guia-inicial-giro'
export const ID_CONFIRMAR = 'guia-inicial-confirmar'
export const ID_BANDEJA = 'guia-inicial-bandeja'
export const ID_VAGAS = 'guia-inicial-vagas'
export const ID_NORMAL_PERMANECER = 'guia-normal-permanecer'

/** Passos de exibição única por Partida (turno, giro/OK, confirmação, bandeja, vagas, permanecer). */
const PASSOS_DE_EXIBICAO_UNICA: ReadonlySet<string> = new Set([
  ID_VEZ,
  ID_GIRO,
  ID_CONFIRMAR,
  ID_BANDEJA,
  ID_VAGAS,
  ID_NORMAL_PERMANECER,
])

/**
 * Subconjunto que avança ao exibir (turno, bandeja, permanecer): dividem a
 * condição com o passo seguinte e cedem a ele no mesmo ciclo — o card
 * seguinte carrega a mesma informação (turno → Inicial; bandeja → vagas;
 * permanecer → mover), então nada se perde.
 */
const PASSOS_DE_AVANCO_IMEDIATO: ReadonlySet<string> = new Set([
  ID_VEZ,
  ID_BANDEJA,
  ID_NORMAL_PERMANECER,
])

/**
 * Etapa atual do guia ou null (sem guia). Ordem = prioridade: o primeiro
 * passo disponível e ainda não ensinado (quando de exibição única) vence.
 */
export function etapaDoGuiaDeTurno(entrada: EntradaDoGuiaDeTurno): EtapaDoGuiaDeTurno | null {
  if (!entrada.guiaLigado) return null
  if (!entrada.minhaVez) return null
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
    if (!entrada.inicialPropriaPosicionada && !entrada.peaoProprioPosicionado && !jaEnsinado(ID_VEZ)) {
      return { id: ID_VEZ, texto: TEXTO_VEZ, alvo: 'vez' }
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
    if ((entrada.temManipulacao || entrada.temPreviewEmFoco) && !jaEnsinado(ID_GIRO)) {
      return { id: ID_GIRO, texto: TEXTO_GIRO, alvo: 'manipulacao' }
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
      return { id: 'guia-normal-mover', texto: TEXTO_NORMAL_MOVER, alvo: 'destino' }
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
// Switch global (default ligado); memória por Partida (zerada por Partida via
// chave escopada por partidaId). Guards para ambiente sem `window` (testes
// unitários puros / SSR nunca montam, mas a máquina é importável).

const CHAVE_GUIA_LIGADO = 'guia-do-jogador:ligado'

function chaveEnsinados(partidaId: string): string {
  return `guia-de-turno-ensinados:${partidaId}`
}

function chaveNormalConcluido(partidaId: string): string {
  return `guia-de-turno-normal-concluido:${partidaId}`
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

/** Passos de exibição única já mostrados nesta Partida. */
export function lerEnsinados(partidaId: string | null): ReadonlySet<string> {
  if (partidaId === null) return new Set()
  try {
    if (typeof window === 'undefined' || !window.localStorage) return new Set()
    const cru = window.localStorage.getItem(chaveEnsinados(partidaId))
    if (!cru) return new Set()
    const lista: unknown = JSON.parse(cru)
    if (!Array.isArray(lista)) return new Set()
    return new Set(lista.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

export function salvarEnsinados(partidaId: string, ensinados: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(chaveEnsinados(partidaId), JSON.stringify([...ensinados]))
  } catch {
    // Sem persistência: a memória segue em estado local — sem quebrar.
  }
}

/** Turno seguinte (pós-Primeiro Turno) já encerrado (guia termina depois dele). */
export function lerFluxoNormalConcluido(partidaId: string | null): boolean {
  if (partidaId === null) return false
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    return window.localStorage.getItem(chaveNormalConcluido(partidaId)) === '1'
  } catch {
    return false
  }
}

export function salvarFluxoNormalConcluido(partidaId: string): void {
  try {
    window.localStorage.setItem(chaveNormalConcluido(partidaId), '1')
  } catch {
    // Sem persistência: segue em estado local — sem quebrar.
  }
}
