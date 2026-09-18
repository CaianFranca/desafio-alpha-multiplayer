/**
 * Sons das conquistas da Confirmação de Posição (issue #385, follow-up).
 *
 * Três pontos próprios no duto canônico de mídia (`frontend/web/media/` →
 * servido em `/media/`): gerador ao ligar, cartão ao obter o Cartão de
 * Acesso e remédio ao adquirir a Proteção da Sala Médica — sons distintos do
 * THUD de recusa (`somDeRecusa.ts`, intacto) e dos sons dos monstros
 * (`somDoAtaque.ts`, intacto: a penalidade do ataque usa aqueles, nunca estes).
 *
 * Evento-driven por aquisição: SÓ `POSICAO_CONFIRMADA` soa, por comparação
 * pré/pós (`tocarConquistasDaConfirmacao`) — snapshots nunca soam (a baseline
 * pode trazer conquistas antigas sem fanfarra). Sem arquivo = no-op
 * silencioso (`new Audio(...)` + `play()` com `catch`, espelhando
 * `somDoAtaque.ts`). Volumes base próprios (contrato da ADR-0007 + issue
 * #438: `audio.volume = camada de efeitos × VOLUME_BASE_*`, com a camada
 * lida no momento do toque via slider do modal de volume).
 */

import {
  CAMINHO_SOM_CARTAO_ACESSO,
  CAMINHO_SOM_GERADOR_LIGADO,
  CAMINHO_SOM_PROTECAO_ADQUIRIDA,
  VOLUME_BASE_SOM_CARTAO_ACESSO,
  VOLUME_BASE_SOM_GERADOR_LIGADO,
  VOLUME_BASE_SOM_PROTECAO_ADQUIRIDA,
} from '../../game/tabuleiro/animacao'
import type { EstadoDoTabuleiroNoCliente } from '../../game/tabuleiro/reducao'
import { tocarAsset } from '../../game/audio/sons'
import { obterVolumeDeEfeitos } from './volumesDasCamadas'

/** Subconjunto do modelo necessário à comparação pré/pós (somente leitura). */
export type ModeloParaConquista = Pick<
  EstadoDoTabuleiroNoCliente,
  'geradoresLigados' | 'cartaoDeAcessoObtido' | 'jogadorPorId'
>

/**
 * Toca o gerador ao ligar — só na aquisição (id novo em `geradoresLigados`).
 * Habilitado por padrão, no-op silencioso se falhar. Sem mestre explícito,
 * lê a camada de efeitos no momento do toque.
 */
export function tocarGeradorLigado(mestre = obterVolumeDeEfeitos()): void {
  tocarAsset(CAMINHO_SOM_GERADOR_LIGADO, VOLUME_BASE_SOM_GERADOR_LIGADO, mestre)
}

/**
 * Toca o cartão ao obter o Cartão de Acesso — só na aquisição (false→true).
 * Habilitado por padrão, no-op silencioso se falhar. Sem mestre explícito,
 * lê a camada de efeitos no momento do toque.
 */
export function tocarCartaoDeAcesso(mestre = obterVolumeDeEfeitos()): void {
  tocarAsset(CAMINHO_SOM_CARTAO_ACESSO, VOLUME_BASE_SOM_CARTAO_ACESSO, mestre)
}

/**
 * Toca o remédio ao adquirir a Proteção — só na aquisição (!antes &&
 * resultante). Habilitado por padrão, no-op silencioso se falhar. Sem mestre
 * explícito, lê a camada de efeitos no momento do toque.
 */
export function tocarProtecaoAdquirida(mestre = obterVolumeDeEfeitos()): void {
  tocarAsset(
    CAMINHO_SOM_PROTECAO_ADQUIRIDA,
    VOLUME_BASE_SOM_PROTECAO_ADQUIRIDA,
    mestre,
  )
}

/**
 * Toca os sons das conquistas adquiridas entre o modelo PRÉ e PÓS
 * `POSICAO_CONFIRMADA` (somente leitura — nunca julga regra, só revela):
 *   - gerador: id novo em `geradoresLigados` (dedupe por id — reconfirmar o
 *     mesmo gerador não soa de novo);
 *   - cartão: `cartaoDeAcessoObtido` false→true;
 *   - proteção: `protegido` do ator !antes && resultante (o wire traz o estado
 *     resultante — concessão da Sala Médica e consumo do ataque do MESMO
 *     gatilho incluídos).
 * Cada aquisição soa uma vez; sem aquisição, silêncio.
 */
export function tocarConquistasDaConfirmacao(
  antes: ModeloParaConquista,
  depois: ModeloParaConquista,
  jogadorId: string,
  mestre = obterVolumeDeEfeitos(),
): void {
  const antesIds = new Set(antes.geradoresLigados)
  if (depois.geradoresLigados.some((id) => !antesIds.has(id))) {
    tocarGeradorLigado(mestre)
  }
  if (!antes.cartaoDeAcessoObtido && depois.cartaoDeAcessoObtido) {
    tocarCartaoDeAcesso(mestre)
  }
  const protegidoAntes = antes.jogadorPorId[jogadorId]?.protegido ?? false
  const protegidoResultante = depois.jogadorPorId[jogadorId]?.protegido ?? false
  if (!protegidoAntes && protegidoResultante) {
    tocarProtecaoAdquirida(mestre)
  }
}
