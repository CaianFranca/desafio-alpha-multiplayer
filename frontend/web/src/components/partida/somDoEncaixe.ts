/**
 * Som do Encaixe da Partida (issue #241, spec #238).
 *
 * Ponto de som próprio do Encaixe (Peça viajando da mesa à Célula):
 * carta no movimento + toque enigmático ao assentar — sons distintos do
 * THUD de recusa (`somDeRecusa.ts`, intacto) e do som sombrio da limpeza.
 * Só coordenação entre os pontos: gatilhos opostos (aprovação vs. recusa),
 * mesma infra futura de volume.
 *
 * Duto canônico de mídia: `frontend/web/media/` → servido em `/media/` via
 * proxy/nginx (mesmo duto do som de recusa). Sem arquivo = no-op silencioso
 * (`new Audio(...)` + `play()` com `catch`, espelhando `somDeRecusa.ts`).
 *
 * Volume base próprio (VOLUME_BASE_SOM_DO_ENCAIXE): o futuro botão de volume
 * controlará este ponto sem recostura via `master * VOLUME_BASE_SOM_DO_ENCAIXE`
 * (contrato da ADR-0007) — não reutiliza a base 0.3 da recusa.
 *
 * Puro onde dá: `origemDoEncaixe` é 100% pura (estado anterior → mesa ou
 * bandeja, somente leitura, sem recalcular regra); só as funções de toque
 * têm efeito colateral (áudio).
 */

import { CAMINHO_SOM_CARTA, CAMINHO_TOQUE_ENIGMATICO } from '../../game/tabuleiro/animacao'
import type { OrigemDoEncaixe } from '../../game/tabuleiro/encaixe'
import type { EstadoDoTabuleiroNoCliente } from '../../game/tabuleiro/reducao'

export type { OrigemDoEncaixe }

/** Carta no movimento do Encaixe (web/media → servido em /media/). */
export const CAMINHO_SOM_MOVIMENTO_ENCAIXE = CAMINHO_SOM_CARTA

/** Toque enigmático ao assentar o Encaixe (web/media → servido em /media/). */
export const CAMINHO_SOM_ASSENTO_ENCAIXE = CAMINHO_TOQUE_ENIGMATICO

/**
 * Volume base do som do Encaixe (contrato com o futuro botão de volume,
 * ADR-0007: `audio.volume = master * VOLUME_BASE_SOM_DO_ENCAIXE`, com
 * master em [0, 1]).
 */
export const VOLUME_BASE_SOM_DO_ENCAIXE = 0.7

export interface OrigemDoEncaixeResolvida {
  readonly origem: OrigemDoEncaixe
  /**
   * Índice da Peça Inicial na mesa (grade 2×2) — só quando origem é mesa;
   * a cena resolve a posição mundo a partir dele. Null na bandeja.
   */
  readonly indiceNaMesa: number | null
}

/**
 * Deriva a origem do Encaixe do modelo PRÉ-despacho (somente leitura):
 * Peça Inicial ainda na mesa → 'mesa'; Peça Corrente da Bandeja (pendência
 * de Recebimento ou tipo já sorteado da Caixa) → 'bandeja'. Peça
 * desconhecida → null (sem voo; o evento ainda soa).
 */
export function origemDoEncaixe(
  estadoAnterior: Pick<
    EstadoDoTabuleiroNoCliente,
    'iniciais' | 'recebidasPendentes' | 'pecasDeRecebimento'
  >,
  pecaId: string,
): OrigemDoEncaixeResolvida | null {
  const indiceNaMesa = estadoAnterior.iniciais.findIndex((p) => p.pecaId === pecaId)
  if (indiceNaMesa >= 0) return { origem: 'mesa', indiceNaMesa }
  const naBandeja =
    estadoAnterior.recebidasPendentes.some((r) => r.pecaId === pecaId) ||
    estadoAnterior.pecasDeRecebimento[pecaId] !== undefined
  if (naBandeja) return { origem: 'bandeja', indiceNaMesa: null }
  return null
}

function tocarAssetDoEncaixe(caminho: string): void {
  try {
    const audio = new Audio(caminho)
    // Contrato de volume (ADR-0007): base fixa; o futuro botão de volume
    // aplica `audio.volume = master * VOLUME_BASE_SOM_DO_ENCAIXE`.
    audio.volume = VOLUME_BASE_SOM_DO_ENCAIXE
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
    // Sem asset ou autoplay bloqueado: silêncio sem quebrar a Partida.
  }
}

/**
 * Toca a carta do movimento do Encaixe — habilitado por padrão, sem etapa
 * de habilitação. No-op silencioso se o áudio falhar.
 */
export function tocarSomDeMovimentoDoEncaixe(): void {
  tocarAssetDoEncaixe(CAMINHO_SOM_MOVIMENTO_ENCAIXE)
}

/**
 * Toca o toque enigmático do assento do Encaixe — habilitado por padrão.
 * No-op silencioso se o áudio falhar.
 */
export function tocarSomDeAssentoDoEncaixe(): void {
  tocarAssetDoEncaixe(CAMINHO_SOM_ASSENTO_ENCAIXE)
}
