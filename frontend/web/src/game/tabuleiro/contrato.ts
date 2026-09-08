/**
 * Contrato puro de geometria do tabuleiro (issue #83).
 *
 * Usa a origem do ambiente ([0,0,0] no centro do plano superior da Mesa,
 * ver `game/ambiente/contrato.ts`) e é 100% puro: sem three.js/DOM.
 * Centraliza dimensões, mapeamento célula↔mundo e posições do tabuleiro e
 * da zona da Caixa sobre a Mesa (issue #143: Caixa opaca + bandeja de sorteio
 * de slot único + as 4 Peças Iniciais em grade 2×2).
 */

import { LARGURA_MESA } from '../ambiente/contrato'

export const LADO_DA_GRADE = 7

/** Lado de uma célula em unidades de mundo (quadrada). */
export const TAMANHO_CELULA = 1.6

/**
 * Espaçamento padrão entre peças assentadas sobre o tampo da Mesa (grade 2×2
 * das Iniciais, fileira de Peões no lado oposto à Caixa): ponto único de
 * ajuste do layout lateral — extrai o valor antes duplicado entre
 * `ESPACAMENTO_INICIAIS` e `ESPACAMENTO_PEAO_MESA` (revisão PR #199).
 */
export const ESPACAMENTO_ENTRE_PECAS_MESA = 1.7

export const LARGURA_TABULEIRO = LADO_DA_GRADE * TAMANHO_CELULA
export const PROFUNDIDADE_TABULEIRO = LADO_DA_GRADE * TAMANHO_CELULA

/** Altura acima do plano da Mesa para evitar z-fighting. */
export const ALTURA_TABULEIRO = 0.02
export const ALTURA_ZONA_CAIXA = 0.02

/** Tabuleiro centralizado sobre a Mesa. */
export const POSICAO_TABULEIRO: readonly [number, number, number] = [
  0,
  ALTURA_TABULEIRO,
  0,
]

// ── Zona da Caixa sobre a Mesa (issue #143) ──────────────────────────────
// Região lateral +X, disposta de trás (−z) para frente (+z):
//   CAIXA (bloco opaco fechada) → BANDEJA (1 slot com a peça corrente) →
//   PEÇAS INICIAIS (4 peças em grade 2×2, clicáveis).

/** Zona da Caixa: offset +X a partir do centro. */
export const OFFSET_CAIXA_X = 8.0

/** Caixa fechada e opaca: posição da base (centro da pegada) e dimensões. */
export const POSICAO_CAIXA: readonly [number, number, number] = [
  OFFSET_CAIXA_X,
  ALTURA_ZONA_CAIXA,
  -5.0,
]
export const CAIXA_LARGURA = 2.4
export const CAIXA_PROFUNDIDADE = 1.8
export const CAIXA_ALTURA = 0.7

/** Bandejinha de slot único: a peça sorteada corrente fica sobre a base. */
export const POSICAO_BANDEJA: readonly [number, number, number] = [
  OFFSET_CAIXA_X,
  ALTURA_ZONA_CAIXA,
  0.0,
]
export const BANDEJA_LARGURA = 2.0
export const BANDEJA_PROFUNDIDADE = 2.0

/** Área das 4 Peças Iniciais em grade 2×2 na frente da bandeja. */
export const POSICAO_INICIAIS: readonly [number, number, number] = [
  OFFSET_CAIXA_X,
  ALTURA_ZONA_CAIXA,
  4.6,
]
export const COLUNAS_INICIAIS = 2
export const QUANTIDADE_INICIAIS = 4

export const CELULA_INSET = TAMANHO_CELULA * 0.98
export const ESPESSURA_BORDA = 0.04
export const BORDA_OFFSET = 0.02
export const BORDA_Y = 0.01
/** Bordas da grade: cinza-grafite escuro, coerente com o fundo `obscuro`. */
export const COR_BORDA_CELULA = '#2e3138'
export const CELULA_Y_BASE = 0.012
export const CELULA_Y_BORDA = 0.018
export const PECA_Y = 0.02
export type PecaId = string

// ── Tipos de domínio visual (espelha engine/shared) ──

// sync manual com engine.TipoDaPeca — caminho + especiais (ST-12) + monstros
// (ST-15 / issue #169); sempre que o engine adicionar um tipo, espelhar aqui.
export type TipoDaPeca =
  | 'inicial'
  | 'reta'
  | 'T'
  | 'cruz'
  | 'gerador'
  | 'sala_do_diretor'
  | 'sala_medica'
  | 'portao_de_saida'
  // Monstros (ST-15 / issue #169): entram na Caixa como peça comum; o
  // placeholder os projeta com as 4 bordas abertas (espelha
  // engine/peoes.ts:56-57).
  | 'vulto'
  | 'espectro'
export type Orientacao = 0 | 90 | 180 | 270
export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste'

// ── Janela de Manipulação por tipo (revisão PR #199; espelho do engine) ──
//
// Apenas Peças de caminho (e a Inicial, com encaixe direto na mesa) abrem a
// janela de Manipulação no encaixe — espelha `posicionarRecebida` do engine
// (packages/engine/src/peoes.ts:622-630 e 683-689): Especiais (ST-12/#142) e
// Monstros (ST-15/#169) NÃO têm janela; o reducer deve refletir isso também
// no caminho de deltas (PECA_POSICIONADA), não só no snapshot.
// Record exaustivo por tipo: um novo `TipoDaPeca` sem regra declarada quebra
// o typecheck — a decisão fica explícita na compilação (padrão da PR #200).

const JANELA_DE_MANIPULACAO_POR_TIPO: Record<TipoDaPeca, boolean> = {
  inicial: true,
  reta: true,
  T: true,
  cruz: true,
  gerador: false,
  sala_do_diretor: false,
  sala_medica: false,
  portao_de_saida: false,
  vulto: false,
  espectro: false,
}

/** O encaixe de uma peça deste tipo abre a janela de Manipulação? */
export function abreJanelaDeManipulacao(tipo: TipoDaPeca): boolean {
  return JANELA_DE_MANIPULACAO_POR_TIPO[tipo]
}

export interface Celula {
  readonly linha: number
  readonly coluna: number
}

/** Peça Inicial aguardando encaixe na mesa (issue #143; ids do engine). */
export interface PecaDaMesa {
  readonly pecaId: PecaId
  readonly tipo: 'inicial'
  readonly orientacao: Orientacao
}

export interface PecaPosicionada {
  readonly pecaId: PecaId
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
  readonly celula: Celula
}

/**
 * Peça sorteada corrente exibida na bandeja de slot único da Caixa (issue
 * #143). Identidade = pecaId; derivada da primeira pendência sem vaga (#138).
 * `recebidaId` é a chave da pendência correspondente — o fluxo de puxar da
 * revisão #199 referencia a corrente pelo `recebidaId` (o `pecaId` só entra
 * em foco no engine após a escolha da vaga).
 */
export interface PecaCorrente {
  readonly recebidaId: string
  readonly pecaId: PecaId
  readonly tipo: TipoDaPeca
  readonly orientacao: Orientacao
}

// ── Peões (issue #90 — ST-10) ──

export type PeaoId = string

/** Cores canônicas espelham `CorDoPeao` do engine (branco|vermelho|azul|amarelo). */
export type CorDoPeao = 'branco' | 'vermelho' | 'azul' | 'amarelo'

/**
 * Peão na projeção de exibição: `celula` é a célula da peça sobre a qual o
 * peão está posicionado; `null` significa sobre a Mesa (fora do tabuleiro).
 */
export interface PeaoDaExibicao {
  readonly peaoId: PeaoId
  readonly cor: CorDoPeao
  readonly celula: Celula | null
}

export interface EstadoExibicaoTabuleiro {
  /** Peças Iniciais aguardando encaixe na mesa (issue #143). */
  readonly iniciais: readonly PecaDaMesa[]
  readonly posicionadas: readonly PecaPosicionada[]
  readonly peoes: readonly PeaoDaExibicao[]
  /**
   * Células iluminadas espelhadas do estado compartilhado (issue #151);
   * fonte única para a cena e para o espelho DOM.
   */
  readonly celulasIluminadas: readonly Celula[]
  /**
   * Fila de chegada dos peões por célula (chave `linha:coluna`; issue #298):
   * ordem em que os peões pousaram na peça — o eixo do arranjo visual de
   * co-ocupação do `layoutDoPeaoNaCelula`. O 1º da lista é o mais antigo.
   */
  readonly ordemDeChegadaPorChave: Readonly<Record<string, readonly PeaoId[]>>
}

/** 4 Peões, um por cor; ordem espelha `CORES_DOS_PEOES` do engine. */
export const QUANTIDADE_PEOES = 4

/**
 * Alvo de Geradores ligados para a vitória (chip `Geradores n/3`, issue #145).
 * Espelha o limiar de vitória do engine (`geradoresLigados.length < 3` em
 * packages/engine/src/partida.ts). Acoplamento de EXIBIÇÃO: o engine não
 * exporta o número; mover o limiar no domínio exige mover esta constante.
 */
export const ALVO_GERADORES_LIGADOS = 3

export const CORES_DOS_PEOES: readonly CorDoPeao[] = [
  'branco',
  'vermelho',
  'azul',
  'amarelo',
]

/** Hex placeholder por cor (arte final substitui o placeholder, não os ids). */
export const HEX_COR_PEAO: Record<CorDoPeao, string> = {
  branco: '#f2efe6',
  vermelho: '#c0392b',
  azul: '#2e6bd6',
  amarelo: '#f1c40f',
}

/**
 * Y local (no grupo da célula) da base do peão sobre a peça. Deriva da
 * geometria do PecaPlaceholder: PECA_Y (0.02) + centro da caixa (0.08) +
 * meia espessura (0.06) = topo da peça em 0.16.
 */
export const PEAO_Y = PECA_Y + 0.14

/**
 * Fileira dos peões não posicionados sobre a Mesa: lado oposto à zona da
 * Caixa (-X; Caixa fica em +X). Altura y = 0 (plano superior da Mesa). O
 * espaçamento usa o padrão compartilhado `ESPACAMENTO_ENTRE_PECAS_MESA`.
 */
export const OFFSET_FILEIRA_PEOES_X = -8.0

// ── Composição inicial das Peças Iniciais na mesa (issue #143) ──
// Espelha `estadoInicialDoTabuleiro()` do engine: as 4 iniciais (`inicial-1`
// a `inicial-4`, orientação 0) nascem fora da Caixa, aguardando encaixe no
// Primeiro Turno. O resto das peças vem sorteado da Caixa (nunca semeado).

/** Semente determinística das 4 Peças Iniciais (mesmos ids do engine). */
export function criarIniciaisDaMesa(): PecaDaMesa[] {
  return [1, 2, 3, 4].map((ordem) => ({
    pecaId: `inicial-${ordem}`,
    tipo: 'inicial' as const,
    orientacao: 0 as const,
  }))
}

export function chaveCelula(celula: Celula): string {
  return `${celula.linha}:${celula.coluna}`
}



// ── Bordas abertas por tipo/orientação (visual do placeholder) ──

const BORDAS_BASE: Record<TipoDaPeca, readonly BordaCardinal[]> = {
  inicial: ['norte', 'leste'],
  reta: ['norte', 'sul'],
  T: ['norte', 'leste', 'oeste'],
  cruz: ['norte', 'leste', 'sul', 'oeste'],
  gerador: ['norte', 'leste', 'sul', 'oeste'],
  sala_do_diretor: ['norte', 'leste', 'sul', 'oeste'],
  sala_medica: ['norte', 'leste', 'sul', 'oeste'],
  portao_de_saida: ['norte', 'leste', 'sul', 'oeste'],
  // Monstros: 4 bordas abertas (espelha engine/peoes.ts:56-57).
  vulto: ['norte', 'leste', 'sul', 'oeste'],
  espectro: ['norte', 'leste', 'sul', 'oeste'],
}

const ORDEM_CANONICA: readonly BordaCardinal[] = ['norte', 'leste', 'sul', 'oeste']

const ROTACAO_HORARIA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'leste',
  leste: 'sul',
  sul: 'oeste',
  oeste: 'norte',
}

export function bordasAbertas(
  peca: Pick<PecaPosicionada, 'tipo' | 'orientacao'>,
): BordaCardinal[] {
  let bordas = BORDAS_BASE[peca.tipo]
  const passos = (peca.orientacao / 90) % 4
  for (let i = 0; i < passos; i++) {
    bordas = bordas.map((b) => ROTACAO_HORARIA[b])
  }
  return ORDEM_CANONICA.filter((b) => bordas.includes(b))
}

// ── Mapeamento célula ↔ mundo ──

export function celulaParaMundo(celula: Celula): [number, number, number] {
  const x = (celula.coluna - Math.floor(LADO_DA_GRADE / 2)) * TAMANHO_CELULA
  const z = (celula.linha - Math.floor(LADO_DA_GRADE / 2)) * TAMANHO_CELULA
  return [POSICAO_TABULEIRO[0] + x, POSICAO_TABULEIRO[1], POSICAO_TABULEIRO[2] + z]
}

function normalizarZero(n: number): number {
  return n === 0 ? 0 : n
}

export function mundoParaCelula(
  mundoX: number,
  mundoZ: number,
): Celula | null {
  const colunaRaw = Math.round((mundoX - POSICAO_TABULEIRO[0]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  const linhaRaw = Math.round((mundoZ - POSICAO_TABULEIRO[2]) / TAMANHO_CELULA + Math.floor(LADO_DA_GRADE / 2))
  if (Number.isNaN(colunaRaw) || Number.isNaN(linhaRaw)) return null
  const coluna = normalizarZero(colunaRaw)
  const linha = normalizarZero(linhaRaw)
  if (linha < 0 || linha >= LADO_DA_GRADE || coluna < 0 || coluna >= LADO_DA_GRADE) {
    return null
  }
  return { linha, coluna }
}

// ── Peças Iniciais: índice → local/mundo (grade 2×2 na frente da bandeja) ──

export function inicialIndiceParaLocal(indice: number): [number, number, number] {
  const linhas = Math.ceil(QUANTIDADE_INICIAIS / COLUNAS_INICIAIS)
  const col = indice % COLUNAS_INICIAIS
  const row = Math.floor(indice / COLUNAS_INICIAIS)
  const localX = (col - (COLUNAS_INICIAIS - 1) / 2) * ESPACAMENTO_ENTRE_PECAS_MESA
  const localZ = (row - (linhas - 1) / 2) * ESPACAMENTO_ENTRE_PECAS_MESA
  return [localX, 0, localZ]
}

export function inicialIndiceParaMundo(indice: number): [number, number, number] {
  const [lx, ly, lz] = inicialIndiceParaLocal(indice)
  return [POSICAO_INICIAIS[0] + lx, POSICAO_INICIAIS[1] + ly, POSICAO_INICIAIS[2] + lz]
}

// ── Helpers de layout ──
export function todasAsCelulas(): Celula[] {
  const out: Celula[] = []
  for (let linha = 0; linha < LADO_DA_GRADE; linha++) {
    for (let coluna = 0; coluna < LADO_DA_GRADE; coluna++) {
      out.push({ linha, coluna })
    }
  }
  return out
}

// Validação de invariante: tabuleiro < Mesa
export function validarDimensoes(): string | null {
  if (LARGURA_TABULEIRO >= LARGURA_MESA || PROFUNDIDADE_TABULEIRO >= LARGURA_MESA) {
    return 'Tabuleiro deve ser menor que a Mesa'
  }
  return null
}

// ── Conexões e seleção de peões (issue #90 — espelho visual do engine) ──
//
// Espelha `vizinhasConectadas` de packages/engine/src/peoes.ts: para cada
// borda aberta da origem, a célula vizinha na direção; a vizinha está
// conectada quando tem a borda oposta aberta. O frontend NÃO importa o
// engine: esta é a projeção de exibição da mesma regra.

const BORDA_OPOSTA: Record<BordaCardinal, BordaCardinal> = {
  norte: 'sul',
  sul: 'norte',
  leste: 'oeste',
  oeste: 'leste',
}

// Deslocamento idêntico ao engine: norte {linha:-1}, leste {coluna:+1},
// sul {linha:+1}, oeste {coluna:-1}.
const DESLOCAMENTO_DA_BORDA: Record<BordaCardinal, Celula> = {
  norte: { linha: -1, coluna: 0 },
  leste: { linha: 0, coluna: 1 },
  sul: { linha: 1, coluna: 0 },
  oeste: { linha: 0, coluna: -1 },
}

export function estaDentroDaGrade(celula: Celula): boolean {
  return (
    Number.isInteger(celula.linha) &&
    Number.isInteger(celula.coluna) &&
    celula.linha >= 0 &&
    celula.linha < LADO_DA_GRADE &&
    celula.coluna >= 0 &&
    celula.coluna < LADO_DA_GRADE
  )
}

export function encontrarPecaNaCelula(
  posicionadas: readonly PecaPosicionada[],
  celula: Celula,
): PecaPosicionada | null {
  const chave = chaveCelula(celula)
  return posicionadas.find((p) => chaveCelula(p.celula) === chave) ?? null
}

/** Vizinhas conectadas à peça de origem (ordem canônica norte→leste→sul→oeste). */
export function vizinhasConectadas(
  posicionadas: readonly PecaPosicionada[],
  origem: PecaPosicionada,
): PecaPosicionada[] {
  const conectadas: PecaPosicionada[] = []
  for (const borda of bordasAbertas(origem)) {
    const delta = DESLOCAMENTO_DA_BORDA[borda]
    const celulaVizinha: Celula = {
      linha: origem.celula.linha + delta.linha,
      coluna: origem.celula.coluna + delta.coluna,
    }
    if (!estaDentroDaGrade(celulaVizinha)) continue
    const vizinha = encontrarPecaNaCelula(posicionadas, celulaVizinha)
    if (!vizinha || !bordasAbertas(vizinha).includes(BORDA_OPOSTA[borda])) {
      continue
    }
    conectadas.push(vizinha)
  }
  return conectadas
}

/** Estado de seleção do peão na cena (estado visual local, não regra). */
export interface SelecaoDePeao {
  readonly peaoId: PeaoId
  readonly celula: Celula
  readonly pecaId: PecaId
}

/**
 * Resolve a seleção de um peão clicado: `null` quando o peão não existe ou
 * está sobre a Mesa (sem peça sob ele) — seleção de peão não posicionado não
 * gera conexões destacadas.
 */
export function selecionarPeaoNaExibicao(
  estado: Pick<EstadoExibicaoTabuleiro, 'posicionadas' | 'peoes'>,
  peaoId: PeaoId,
): SelecaoDePeao | null {
  const peao = estado.peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return null
  const peca = encontrarPecaNaCelula(estado.posicionadas, peao.celula)
  if (!peca) return null
  return { peaoId: peao.peaoId, celula: peao.celula, pecaId: peca.pecaId }
}

/**
 * Peça de Monstro (espelha `ehPecaDeMonstro` do engine —
 * packages/engine/src/peoes.ts:104-106): Monstros NUNCA aceitam Peão; o
 * engine rejeita antes de qualquer consulta de vizinhança/ocupação
 * (peoes.ts:531-536, partida.ts:583-585).
 */
export function ehPecaDeMonstro(tipo: TipoDaPeca): boolean {
  return tipo === 'vulto' || tipo === 'espectro'
}

/**
 * Teto de ocupação do Portão de Saída (espelha peoes.ts:558 e
 * partida.ts:1490): a reunião dos peões no Portão é condição de vitória;
 * as demais peças continuam no máximo 1.
 */
export const TETO_DE_OCUPACAO_DO_PORTAO = 4

// ── Arranjo visual de co-ocupação (issue #298) ───────────────────────────
// Sem deslocamento (dx=dz=0) os peões sobre a mesma peça se sobrepõem no
// centro; os offsets de canto afastam cada ocupante em um quadrante. Um
// `TAMANHO_CELULA/2` colocaria o peão sobre a borda da peça vizinha — o valor
// aqui é conservador, mantendo os avatares dentro da pegada da peça.

/** Deslocamento x de um peão no canto (em unidades de mundo). */
export const OFFSET_CANTO_X = 0.45

/** Deslocamento z de um peão no canto (em unidades de mundo). */
export const OFFSET_CANTO_Z = 0.45

/**
 * Cantos na ordem de chegada do Portão de Saída, cada qual um par
 * [dx, dz]: SE (superior esquerdo), SD (superior direito), ID (inferior
 * direito), IE (inferior esquerdo). O 1º ocupante assume o SE; o ciclo segue
 * no sentido horário (SE→SD→ID→IE).
 */
export const CANTOS_DO_PORTAO: readonly (readonly [number, number])[] = [
  [-OFFSET_CANTO_X, -OFFSET_CANTO_Z], // SE
  [OFFSET_CANTO_X, -OFFSET_CANTO_Z], // SD
  [OFFSET_CANTO_X, OFFSET_CANTO_Z], // ID
  [-OFFSET_CANTO_X, OFFSET_CANTO_Z], // IE
]

/**
 * Deslocamento [dx, dz] do peão sobre a peça na célula, dado o tipo da peça e
 * a fila de ocupantes (ordem de chegada):
 *   - Portão de Saída: o nº de chegada (índice na fila) mapeia pro canto
 *     SE→SD→ID→IE por ordem de chegada; o 5º (índice 4 — teto 4 + resgate
 *     #171, defensivo) ocupa o centro (dx=dz=0), sem sobrepor o IE; peão fora
 *     da fila (−1) cai no centro. Com N=1 o peão também ocupa o SE (mesmo com
 *     um único ocupante), preservando o centro da peça e a consistência do
 *     ciclo.
 *   - Demais peças (peça comum, ex.: janela de resgate): o 1º ocupante fica no
 *     centro (dx=dz=0); apenas a partir do 2º (índice ≥ 1) desloca pro canto SE.
 * Sem NaN (todas as saídas têm valores definidos).
 */
export function layoutDoPeaoNaCelula(
  tipo: TipoDaPeca,
  filaDeOcupantes: readonly PeaoId[],
  peaoId: PeaoId,
): { dx: number; dz: number } {
  const indice = filaDeOcupantes.indexOf(peaoId)
  if (tipo === 'portao_de_saida') {
    if (indice < 0) return { dx: 0, dz: 0 }
    if (indice >= CANTOS_DO_PORTAO.length) return { dx: 0, dz: 0 }
    const canto = CANTOS_DO_PORTAO[indice]
    return { dx: canto[0], dz: canto[1] }
  }
  if (indice >= 1) return { dx: CANTOS_DO_PORTAO[0][0], dz: CANTOS_DO_PORTAO[0][1] }
  return { dx: 0, dz: 0 }
}

/** Classe do destino: movimento comum ou resgate de peão afetado. */
export type TipoDeDestinoDoPeao = 'movimento' | 'resgate'

/**
 * Destino aceito por `mover_peao`, com a natureza do pouso. `resgate` espelha
 * o gatilho atômico do engine: chegada com aliado AFETADO (Baixa Iluminação ∨
 * Amedrontado) na peça de destino limpa seus estados
 * (partida.ts:675-712). O comando de wire é o mesmo `MOVER_PEAO` nos dois
 * casos — o tipo só diferencia destaque/cursor na UI.
 */
export interface DestinoDoPeao {
  readonly peca: PecaPosicionada
  readonly tipo: TipoDeDestinoDoPeao
}

/**
 * Destinos válidos do peão selecionado — espelho da aceitação de `mover_peao`
 * do engine (partida.ts:575-612 + peoes.ts:521-561):
 *   1. vizinha conectada à peça de origem (senão MOVIMENTO_NAO_CONECTADO);
 *   2. Monstros excluídos sempre (partida.ts:583-585, peoes.ts:531-536);
 *   3. ocupação < teto, onde teto = 4 no Portão, 1 nas demais
 *      (peoes.ts:555-561), +1 quando a peça abriga peão AFETADO
 *      (`tetoOcupacao`/`temAfetadoNaPeca`, partida.ts:1479-1492) — a
 *      exceção de resgate da issue #171.
 *
 * `afetadosPorPeaoId` é a projeção de percepção dos afetados
 * (emBaixaIluminacao ∨ amedrontado — predicado espelhado de
 * partida.ts:1484); o chamador a deriva de `jogadorPorId` × `peaoPorJogador`
 * (fonte: snapshot #154/#156 + deltas de ATAQUE/RESGATE #174). Sem o
 * argumento (ou set vazio) a regra antiga de 1 peão/peça é o resultado
 * natural do teto base — unidades puras sem percepção degradam conservador.
 */
export function destinosConectadosDoPeao(
  posicionadas: readonly PecaPosicionada[],
  peoes: readonly PeaoDaExibicao[],
  peaoId: PeaoId,
  afetadosPorPeaoId: ReadonlySet<PeaoId> = new Set(),
): DestinoDoPeao[] {
  const peao = peoes.find((p) => p.peaoId === peaoId)
  if (!peao || peao.celula === null) return []
  const origem = encontrarPecaNaCelula(posicionadas, peao.celula)
  if (!origem) return []
  const destinos: DestinoDoPeao[] = []
  for (const peca of vizinhasConectadas(posicionadas, origem)) {
    // (2) Monstros fora — antes de qualquer análise de ocupação.
    if (ehPecaDeMonstro(peca.tipo)) continue
    const chave = chaveCelula(peca.celula)
    // O peão em movimento aponta para a origem e não se conta entre os
    // ocupantes do destino (mesmo pressuposto de peoes.ts:553-557).
    const ocupantes = peoes.filter(
      (p) => p.peaoId !== peaoId && p.celula !== null && chaveCelula(p.celula) === chave,
    )
    // (3) teto espelhado: Portão 4, demais 1; +1 com afetado na peça.
    const tetoBase =
      peca.tipo === 'portao_de_saida' ? TETO_DE_OCUPACAO_DO_PORTAO : 1
    const temAfetado = ocupantes.some((p) => afetadosPorPeaoId.has(p.peaoId))
    const teto = temAfetado ? tetoBase + 1 : tetoBase
    if (ocupantes.length >= teto) continue
    destinos.push({ peca, tipo: temAfetado ? 'resgate' : 'movimento' })
  }
  return destinos
}

/** Posição mundo da fileira de peões sobre a Mesa (índice = posição em `peoes`). */
export function peaoMesaParaMundo(indice: number): [number, number, number] {
  const z = (indice - (QUANTIDADE_PEOES - 1) / 2) * ESPACAMENTO_ENTRE_PECAS_MESA
  return [OFFSET_FILEIRA_PEOES_X, 0, z]
}
