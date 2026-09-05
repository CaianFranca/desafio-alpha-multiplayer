/**
 * Som de recusa da Partida (issue #228).
 *
 * Ponto de som ÚNICO e centralizado da tela da Partida: toca sempre o mesmo
 * asset (`/assets/audio/bumpintowall.mp3`, servido de `web/public`) nos pontos
 * que antes geravam flash vermelho/âmbar — erros do tabuleiro (incluindo ação
 * fora da vez), rejeições locais do roteador após confirmação e ataque com
 * penalidade. Demais eventos (aprovações, seleções, sorteios, turnos,
 * limpeza, resgate, ataque sem vítimas) ficam em silêncio, sem substituto
 * visual.
 *
 * O motivo do disparo sobrevive como identificador (string), preparando sons
 * distintos futuros — hoje o mapa abaixo aponta todos para o mesmo asset.
 * Volume reduzido (0.3): o futuro botão de volume controlará este ponto sem
 * recostura. `play()` com `catch` silencioso como defensivo (no-op se falhar).
 *
 * Puro onde dá: `motivoDeRecusaDoEvento` é 100% puro (evento → motivo | null,
 * somente leitura do evento, sem recalcular regra); só `tocarSomDeRecusa`
 * tem efeito colateral (áudio).
 */

import type { EventoDoCanalDaPartida } from '../../hooks/usePartidaWebSocket'

/** Asset de recusa (web/public → servido em /assets/...). */
export const CAMINHO_SOM_DE_RECUSA = '/assets/audio/bumpintowall.mp3'

/**
 * Motivo do disparo do som — identificador estável da recusa. Herda os
 * motivos que antes tingiam o flash (vermelho/âmbar) mais o ataque com
 * penalidade; aprovações não têm motivo (silêncio = "foi").
 */
export type MotivoDeRecusa =
  | 'rejeicao_do_servico'
  | 'fora_da_vez'
  | 'pendencia_nao_resolvida'
  | 'caixa_esgotada'
  | 'posicao_confirmada'
  | 'ataque_com_penalidade'

/**
 * Asset por motivo — hoje sempre o mesmo som (história 7: o futuro botão de
 * volume controla este ponto sem recostura; sons distintos por motivo são
 * outra issue e nascem trocando valores aqui).
 */
const SOM_POR_MOTIVO: Record<MotivoDeRecusa, string> = {
  rejeicao_do_servico: CAMINHO_SOM_DE_RECUSA,
  fora_da_vez: CAMINHO_SOM_DE_RECUSA,
  pendencia_nao_resolvida: CAMINHO_SOM_DE_RECUSA,
  caixa_esgotada: CAMINHO_SOM_DE_RECUSA,
  posicao_confirmada: CAMINHO_SOM_DE_RECUSA,
  ataque_com_penalidade: CAMINHO_SOM_DE_RECUSA,
}

/**
 * Traduz evento do canal em motivo de recusa (só os vermelhos/âmbar de
 * antes; ataque SOMENTE com penalidade — `estadosAplicados.length > 0`).
 * Todo o resto (aprovação, seleção, giro, sorteio, vaga, turno, confirmação,
 * limpeza, iluminação, resgate, proteção que negou, gatilho sem vítimas)
 * retorna null = silêncio.
 */
export function motivoDeRecusaDoEvento(
  evento: EventoDoCanalDaPartida,
): MotivoDeRecusa | null {
  switch (evento.type) {
    case 'ATAQUE_RESOLVIDO':
      return evento.estadosAplicados.length > 0 ? 'ataque_com_penalidade' : null
    case 'ERRO_DO_TABULEIRO':
      switch (evento.codigo) {
        case 'FORA_DA_VEZ':
          return 'fora_da_vez'
        case 'PENDENCIA_NAO_RESOLVIDA':
          return 'pendencia_nao_resolvida'
        case 'CAIXA_ESGOTADA':
          // Rota DEFENSIVA (#145-exp F5): nenhum comando do wire invoca a
          // primitiva sortearDaCaixa que produz este código (engine/
          // tabuleiro.ts) — o Recebimento esvazia sem erro e o término por
          // Caixa chega via PARTIDA_TERMINADA com motivo. Mantida para
          // rejeições explícitas de um servidor autoritativo; não remover.
          return 'caixa_esgotada'
        default:
          return 'rejeicao_do_servico'
      }
    default:
      return null
  }
}

/**
 * Toca o som de recusa do motivo — habilitado por padrão, sem etapa de
 * habilitação (história 6: a primeira recusa já é audível). No-op silencioso
 * se o áudio falhar (história 2 sem quebrar a Partida).
 */
export function tocarSomDeRecusa(motivo: MotivoDeRecusa): void {
  try {
    const audio = new Audio(SOM_POR_MOTIVO[motivo])
    // Volume reduzido (0.3) — compatível com o futuro botão de volume sem recostura.
    audio.volume = 0.3
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
    // Recusa silenciosa sem quebrar nada.
  }
}

/**
 * Texto do anúncio de recusa restrito a leitores de tela (história 8):
 * região viva `sr-only` na PartidaPage. O flash antigo era `aria-hidden`
 * (não carregava informação textual); este anúncio é novo.
 */
export function textoDoAnuncioDeRecusa(motivo: MotivoDeRecusa): string {
  switch (motivo) {
    case 'fora_da_vez':
      return 'Ação recusada: aguarde a sua vez.'
    case 'pendencia_nao_resolvida':
      return 'Ação recusada: há peças recebidas pendentes.'
    case 'posicao_confirmada':
      return 'Ação recusada: posição já confirmada neste turno.'
    case 'caixa_esgotada':
      return 'Ação recusada: a caixa está vazia.'
    case 'ataque_com_penalidade':
      return 'Seu peão sofreu um ataque.'
    default:
      return 'Ação recusada.'
  }
}
