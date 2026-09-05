/**
 * Voo do peão com sons (issue #242).
 *
 * Transição do peão na cena + 2 sons (clique ao selecionar, baque ao
 * aterrissar), com durações e caminhos centralizados — espelho de
 * `components/partida/somDeRecusa.ts` (mesma infra `new Audio` + `catch`
 * silencioso, bases de volume no espírito do ADR-0007).
 *
 * Composição no ponto mais alto (decisão #238): a transição vive na cena,
 * disparada pelos mesmos eventos do canal que atualizam o modelo
 * (`PartidaPage.onEvento`); o estado final é sempre igual ao sem animação.
 * Sem `setTimeout` no código de produção: a cena interpola via `useFrame` +
 * `invalidate()` e conclui via callback `onVooAterrissou(nonce).
 *
 * Gatilhos (só do canal, nunca do clique local otimista):
 *   - `PEAO_SELECIONADO` → a página toca o clique imediato;
 *   - `PEAO_MOVIDO` → a página registra o voo pendente (último vence);
 *   - `PEAO_POSICIONADO` (Primeiro Turno) → a página registra o voo pendente
 *     mesa→peça inicial (origem na célula anterior do peão, ou na fileira da
 *     Mesa quando ele ainda não está posicionado);
 *   - o baque é tocado pela cena ao concluir o pouso (imediato sob reduce) —
 *     dono único por som, sem duplo.
 * `PEAO_PERMANECEU` pede snap, sem voo nem som.
 *
 * Puro onde dá: `vooDoPeaoDoEvento` e `deveTocarCliqueDoPeao` são 100% puras
 * (evento + modelo anterior → voo base | null / boolean); só
 * `tocarCliqueDoPeao`/`tocarBaqueDoPeao` têm efeito colateral (áudio, no-op
 * silencioso sem asset — os arquivos chegam depois, via `web/media/` → `/media/`).
 */

import type { EventoDoCanalDaPartida } from '../../hooks/usePartidaWebSocket'
import { celulaParaMundo, chaveCelula, PEAO_Y } from './contrato'
import type { Celula } from './contrato'
import type { EstadoDoTabuleiroNoCliente } from './reducao'

/**
 * Voo pendente: mora em `PartidaPage` (nonce por voo), desce pela cadeia de
 * props existente (`AmbienteDeJogo`→`AmbienteCena`→`Tabuleiro`); a cena avisa
 * o pouso via `onVooAterrissou(nonce)` e a página limpa o pendente. Voos
 * sobrepostos: último vence. `ESTADO_DA_PARTIDA` limpa o voo (snapshot é
 * autoridade).
 */
export interface VooDoPeaoPendente {
  readonly nonce: number
  readonly peaoId: string
  /**
   * Origem do voo; `null` = fileira da Mesa (Primeiro Turno: o peão ainda não
   * estava posicionado no modelo anterior). Com origem na Mesa, o slot global
   * em `peoes` vai em `origemMesaIndice` (pixel-igual ao estático via
   * `peaoMesaParaMundo`).
   */
  readonly origem: Celula | null
  readonly destino: Celula
  /** Slot da origem na Mesa; presente só quando `origem` é `null`. */
  readonly origemMesaIndice?: number
}

/** Voo sem nonce: o que a pura deriva; a página carimba o nonce ao registrar. */
export type VooDoPeaoBase = Omit<VooDoPeaoPendente, 'nonce'>

/** Duração do voo erguer→flutuar→aterrissar (~500ms de partida). */
export const VOO_DURACAO_MS = 500
/** Alias com o nome do plano (Execução 1). */
export const DURACAO_VOO_PEAO_MS = VOO_DURACAO_MS

/** Altura máxima do arco do voo, em unidades de mundo. */
export const VOO_ALTURA_MAX = 1.2

/** Inclinação fixa na fase flutuar, em radianos, no eixo do deslocamento. */
export const VOO_INCLINACAO_RAD = 0.28

/** Asset do clique suave ao selecionar (chega depois; sem arquivo = silêncio). */
export const SOM_CAMINHO_CLIQUE_PEAO = '/media/clique-peao.mp3'
/** Alias com o nome do plano (Execução 1). */
export const CAMINHO_SOM_CLIQUE_PEAO = SOM_CAMINHO_CLIQUE_PEAO

/** Asset do baque ao aterrissar (chega depois; sem arquivo = silêncio). */
export const SOM_CAMINHO_BAQUE_PEAO = '/media/baque-peao.mp3'
/** Alias com o nome do plano (Execução 1). */
export const CAMINHO_SOM_BAQUE_PEAO = SOM_CAMINHO_BAQUE_PEAO

/**
 * Volumes base (contrato com o futuro botão de volume, ADR-0007:
 * `audio.volume = master * SOM_VOLUME_BASE_*`, com master em [0, 1]).
 */
export const SOM_VOLUME_BASE_CLIQUE_PEAO = 0.3
export const SOM_VOLUME_BASE_BAQUE_PEAO = 0.4

/**
 * Clique suave só no `PEAO_SELECIONADO` vindo do canal — demais eventos ficam
 * em silêncio neste ponto (recusas têm o próprio duto em `somDeRecusa.ts`).
 */
export function deveTocarCliqueDoPeao(evento: EventoDoCanalDaPartida): boolean {
  return evento.type === 'PEAO_SELECIONADO'
}

/**
 * Deriva o voo base do `PEAO_MOVIDO` e do `PEAO_POSICIONADO` (Primeiro Turno):
 * destino é sempre a célula do evento. No `PEAO_MOVIDO`, origem é a célula da
 * peça de `pecaIdDe` em `posicionadas`, com fallback para a célula do peão no
 * modelo anterior. No `PEAO_POSICIONADO`, origem é a célula do peão no modelo
 * anterior — `null` (ainda sobre a Mesa) vira voo mesa→peça com o slot global
 * em `peoes` carimbado em `origemMesaIndice`. Origem irresolúvel (ou idêntica
 * ao destino) → `null` = snap, sem voo nem som.
 * `PEAO_PERMANECEU`/demais eventos → `null`.
 */
export function vooDoPeaoDoEvento(
  evento: EventoDoCanalDaPartida,
  modeloAntes: Pick<EstadoDoTabuleiroNoCliente, 'posicionadas' | 'peoes'>,
): VooDoPeaoBase | null {
  if (evento.type === 'PEAO_POSICIONADO') {
    const destino = evento.celula
    const indice = modeloAntes.peoes.findIndex((p) => p.peaoId === evento.peaoId)
    if (indice < 0) return null
    const celulaAntes = modeloAntes.peoes[indice]?.celula ?? null
    if (celulaAntes === null) {
      return { peaoId: evento.peaoId, origem: null, destino, origemMesaIndice: indice }
    }
    if (chaveCelula(celulaAntes) === chaveCelula(destino)) return null
    return { peaoId: evento.peaoId, origem: celulaAntes, destino }
  }
  if (evento.type !== 'PEAO_MOVIDO') return null
  const destino = evento.celula
  const pecaDe = modeloAntes.posicionadas.find((p) => p.pecaId === evento.pecaIdDe)
  const origem: Celula | null =
    pecaDe?.celula ??
    modeloAntes.peoes.find((p) => p.peaoId === evento.peaoId)?.celula ??
    null
  if (origem === null) return null
  if (chaveCelula(origem) === chaveCelula(destino)) return null
  return { peaoId: evento.peaoId, origem, destino }
}

/**
 * O voo pendente deve ser limpo ao aterrissar só quando o nonce confere
 * (voos sobrepostos: último vence — pouso de voo antigo não limpa o novo).
 */
export function limparVooAoAterrissar(
  vooAtual: VooDoPeaoPendente | null,
  nonceAterrissado: number,
): VooDoPeaoPendente | null {
  if (vooAtual === null) return null
  return vooAtual.nonce === nonceAterrissado ? null : vooAtual
}

/** Snapshot é autoridade: `ESTADO_DA_PARTIDA` sempre limpa o voo pendente. */
export function deveLimparVooNoSnapshot(evento: EventoDoCanalDaPartida): boolean {
  return evento.type === 'ESTADO_DA_PARTIDA'
}

/**
 * Durante o voo ativo, o peão estático de mesmo `peaoId` não renderiza na
 * origem nem no destino (o modelo atualiza instantâneo, então o destino já o
 * teria) — só o overlay voador aparece. Com origem na Mesa (`origem` null),
 * só o destino se suprime aqui; a fileira da Mesa suprime pelo
 * `deveSuprimirPeaoNaMesa`. Demais células/peões (ex.: Portão com 4) seguem
 * intactos. Sem voo, nada se suprime.
 */
export function deveSuprimirPeaoEstatico(
  voo: VooDoPeaoPendente | null,
  peaoId: string,
  chaveDaCelula: string,
): boolean {
  if (voo === null || voo.peaoId !== peaoId) return false
  return (
    (voo.origem !== null && chaveDaCelula === chaveCelula(voo.origem)) ||
    chaveDaCelula === chaveCelula(voo.destino)
  )
}

/**
 * Durante o voo com origem na Mesa (`origem` null — Primeiro Turno), o peão
 * de mesmo `peaoId` não renderiza na fileira da Mesa (`peoesNaMesa` em
 * `AmbienteCena`) — só o overlay voador aparece. Voos célula→célula e ausência
 * de voo nada supremem aqui. (Na prática o modelo atualiza instantâneo, então
 * o posicionado já saiu da Mesa; a supressão é guarda contra duplicado.)
 */
export function deveSuprimirPeaoNaMesa(
  voo: VooDoPeaoPendente | null,
  peaoId: string,
): boolean {
  if (voo === null || voo.peaoId !== peaoId) return false
  return voo.origem === null
}

function tocarArquivoDeAudio(caminho: string, volumeBase: number): void {
  try {
    const audio = new Audio(caminho)
    // Contrato de volume (ADR-0007): base fixa; o futuro botão de volume
    // aplica `audio.volume = master * SOM_VOLUME_BASE_*`.
    audio.volume = volumeBase
    const tocando: unknown = audio.play()
    // jsdom não implementa play(): retorna undefined em vez de Promise.
    if (
      typeof tocando === 'object' &&
      tocando !== null &&
      'catch' in tocando &&
      typeof (tocando as { catch: unknown }).catch === 'function'
    ) {
      ;(tocando as Promise<void>).catch(() => {})
    }
  } catch {
    // Sem asset (ou áudio bloqueado): silêncio sem quebrar a Partida.
  }
}

/** Clique suave ao selecionar — habilitado por padrão, no-op silencioso sem asset. */
export function tocarCliqueDoPeao(): void {
  tocarArquivoDeAudio(SOM_CAMINHO_CLIQUE_PEAO, SOM_VOLUME_BASE_CLIQUE_PEAO)
}

/** Baque ao aterrissar — tocado pela cena ao concluir o pouso; no-op sem asset. */
export function tocarBaqueDoPeao(): void {
  tocarArquivoDeAudio(SOM_CAMINHO_BAQUE_PEAO, SOM_VOLUME_BASE_BAQUE_PEAO)
}

// ── Geometria da transição (pura, testável sem temporizador) ───────────────

/** Posição mundo do peão sobre uma célula (topo da peça via `PEAO_Y`). */
export function mundoDoPeaoSobreACelula(celula: Celula): [number, number, number] {
  const [x, y, z] = celulaParaMundo(celula)
  return [x, y + PEAO_Y, z]
}

export interface VooPoseDoPeao {
  /** Posição mundo do grupo do peão voador. */
  readonly posicao: [number, number, number]
  /** Inclinação [rx, rz] no eixo do deslocamento (só na fase flutuar). */
  readonly inclinacao: readonly [number, number]
}

function prenderEm01(progresso: number): number {
  if (Number.isNaN(progresso)) return 0
  return Math.min(1, Math.max(0, progresso))
}

/**
 * Janela da inclinação: 0 nas pontas (erguer/aterrissar retos), 1 no flutuar
 * (0.3–0.7 do progresso) com rampas suaves — peão voa como xadrez, inclinado
 * só enquanto flutua.
 */
function janelaDeInclinacao(progresso: number): number {
  const t = prenderEm01(progresso)
  if (t <= 0.3) return t / 0.3
  if (t >= 0.7) return (1 - t) / 0.3
  return 1
}

/**
 * Pose do voo no progresso `t` em [0, 1] entre dois pontos de mundo:
 * horizontal interpola origem→destino, vertical soma o arco
 * (`sin(pi·t)·ALTURA`), inclinação fixa no eixo do deslocamento só no
 * flutuar. `t = 0` é pixel-igual à origem, `t = 1` é pixel-igual ao destino
 * (pós-voo = sem animação). Núcleo compartilhado pelo voo célula→célula e
 * pelo voo mesa→peça (origem na fileira da Mesa, fora da grade).
 */
export function vooPoseEntreMundos(
  origemMundo: readonly [number, number, number],
  destinoMundo: readonly [number, number, number],
  progresso: number,
): VooPoseDoPeao {
  const t = prenderEm01(progresso)
  const [ox, oy, oz] = origemMundo
  const [dx, dy, dz] = destinoMundo
  // Pontas exatas (pixel-igual aos estáticos): o lerp horizontal acumula erro
  // de ponto flutuante com origem fora do zero (ex.: fileira da Mesa em
  // x = -8) e `sin(pi) ≈ 1.2e-16` não é zero — sem os guardas, o pouso
  // herdaria epsilons em vez do destino exato.
  if (t <= 0) {
    return { posicao: [ox, oy, oz], inclinacao: [0, 0] }
  }
  if (t >= 1) {
    return { posicao: [dx, dy, dz], inclinacao: [0, 0] }
  }
  const arco = Math.sin(Math.PI * t) * VOO_ALTURA_MAX
  const posicao: [number, number, number] = [
    ox + (dx - ox) * t,
    oy + (dy - oy) * t + arco,
    oz + (dz - oz) * t,
  ]
  const ex = dx - ox
  const ez = dz - oz
  const comprimento = Math.hypot(ex, ez)
  if (comprimento === 0) {
    return { posicao, inclinacao: [0, 0] }
  }
  const intensidade = janelaDeInclinacao(t) * VOO_INCLINACAO_RAD
  // Pontas retas: evita `-0` (toEqual distingue de `+0`) e ruído no pouso.
  if (intensidade === 0) {
    return { posicao, inclinacao: [0, 0] }
  }
  const inclinacao: readonly [number, number] = [
    (ez / comprimento) * intensidade,
    (-ex / comprimento) * intensidade,
  ]
  return { posicao, inclinacao }
}

/**
 * Pose do voo no progresso `t` em [0, 1]: horizontal interpola origem→destino,
 * vertical soma o arco (`sin(pi·t)·ALTURA`), inclinação fixa no eixo do
 * deslocamento só no flutuar. `t = 0` é pixel-igual à origem estática,
 * `t = 1` é pixel-igual ao destino estático (pós-voo = sem animação).
 */
export function vooPoseNoProgresso(
  origem: Celula,
  destino: Celula,
  progresso: number,
): VooPoseDoPeao {
  return vooPoseEntreMundos(
    mundoDoPeaoSobreACelula(origem),
    mundoDoPeaoSobreACelula(destino),
    progresso,
  )
}

/**
 * `prefers-reduced-motion: reduce` → snap: sem interpolação, o peão aparece
 * direto no destino (pixel-igual ao atual) e o baque toca imediato. Guarda
 * para SSR/testes sem `matchMedia` (falso = anima).
 */
export function vooReduceAtivo(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
