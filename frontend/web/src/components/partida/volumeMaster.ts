/**
 * Master de volume da Partida (ADR-0007).
 *
 * Contrato: cada ponto de som aplica `master * VOLUME_BASE_*`, com master em
 * [0, 1] (padrão 1, sem controle de volume hoje). O futuro botão de volume
 * controla SÓ este ponto — sem recostura dos pontos de som, sem tocar nas
 * bases (`VOLUME_BASE_SOM_DE_RECUSA`, `VOLUME_BASE_SOM_DE_BLIP_DO_CHAT`).
 */

export const VOLUME_MASTER_PARTIDA = 1
