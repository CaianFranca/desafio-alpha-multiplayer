/**
 * Sons do giro e do Encaixe da Partida (issue #241, spec #238 + mudanças de
 * spec verbais: a carta soa no GIRO; o toque enigmático é o som de MOVIMENTO
 * do posicionamento e sai no instante em que a peça começa a se mover).
 *
 * Dois pontos próprios: carta a cada `PECA_GIRADA` (giro aceito) + toque
 * enigmático no início do voo do Encaixe (Peça viajando da mesa à Célula) —
 * sons distintos do THUD de recusa (`somDeRecusa.ts`, intacto) e do som
 * sombrio da limpeza. Só coordenação entre os pontos: gatilhos opostos
 * (aprovação vs. recusa), mesma infra futura de volume.
 *
 * Duto canônico de mídia: `frontend/web/media/` → servido em `/media/` via
 * proxy/nginx (mesmo duto do som de recusa). Sem arquivo = no-op silencioso
 * (`new Audio(...)` + `play()` com `catch`, espelhando `somDeRecusa.ts`).
 *
 * Volumes base próprios (VOLUME_BASE_SOM_DE_GIRO, VOLUME_BASE_SOM_DE_MOVIMENTO):
 * o futuro botão de volume controlará estes pontos sem recostura via
 * `master * VOLUME_BASE_*` (contrato da ADR-0007) — não reutilizam a base
 * 0.3 da recusa.
 *
 * Puro onde dá: `origemDoEncaixe` é 100% pura (estado anterior → mesa ou
 * bandeja, somente leitura, sem recalcular regra); só as funções de toque
 * têm efeito colateral (áudio).
 */

import { CAMINHO_SOM_CARTA, CAMINHO_TOQUE_ENIGMATICO } from '../../game/tabuleiro/animacao'
import { tocarAsset } from '../../game/audio/sons'
import type { OrigemDoEncaixe } from '../../game/tabuleiro/encaixe'
import type { EstadoDoTabuleiroNoCliente } from '../../game/tabuleiro/reducao'

export type { OrigemDoEncaixe }

/** Carta do giro da Peça (web/media → servido em /media/). */
export const CAMINHO_SOM_GIRO_ENCAIXE = CAMINHO_SOM_CARTA

/** Toque enigmático do movimento do Encaixe (web/media → servido em /media/). */
export const CAMINHO_SOM_MOVIMENTO_ENCAIXE = CAMINHO_TOQUE_ENIGMATICO

/**
 * Volume base da carta do giro (contrato com o futuro botão de volume,
 * ADR-0007: `audio.volume = master * VOLUME_BASE_SOM_DE_GIRO`, com master
 * em [0, 1]). Base baixa por decisão humana: o giro repete a cada ação e
 * não pode gritar; o movimento de cada peça é pontual.
 */
export const VOLUME_BASE_SOM_DE_GIRO = 0.15

/**
 * Volume base do toque enigmático do movimento (contrato com o futuro botão
 * de volume, ADR-0007: `audio.volume = master * VOLUME_BASE_SOM_DE_MOVIMENTO`,
 * com master em [0, 1]). Ajuste manual do usuário sobre os 0.7 originais.
 */
export const VOLUME_BASE_SOM_DE_MOVIMENTO = 1

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

function tocarAssetDoEncaixe(caminho: string, volumeBase: number): void {
  // Sem mestre (assinatura preservada): o futuro botão de volume aplica
  // `audio.volume = master * VOLUME_BASE_*` — hoje, master 1.
  tocarAsset(caminho, volumeBase)
}

/**
 * Toca a carta do giro da Peça — habilitado por padrão, sem etapa de
 * habilitação. Uma vez por `PECA_GIRADA` (giros distintos em sequência soam
 * múltiplo por design: cada giro é uma ação distinta). No-op silencioso se
 * o áudio falhar.
 */
export function tocarSomDeGiroDoEncaixe(): void {
  tocarAssetDoEncaixe(CAMINHO_SOM_GIRO_ENCAIXE, VOLUME_BASE_SOM_DE_GIRO)
}

/**
 * Toca o toque enigmático do movimento do Encaixe — sai no instante em que
 * a peça começa a se mover (chegada do `PECA_POSICIONADA`), habilitado por
 * padrão. No-op silencioso se o áudio falhar.
 */
export function tocarSomDeMovimentoDoEncaixe(): void {
  tocarAssetDoEncaixe(CAMINHO_SOM_MOVIMENTO_ENCAIXE, VOLUME_BASE_SOM_DE_MOVIMENTO)
}
