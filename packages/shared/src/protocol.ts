// Protocolo WS mínimo do stub (ADR-0001).
// Tipos de mensagem compartilhados via @flicker/shared, tipados de um lado só.

import type { SalaComandoDoCliente, SalaEventoDoServidor } from './sala.ts';
import type { EncaminhamentoEventoDoServidor, PartidaId } from './encaminhamento.ts';
import type { TabuleiroComandoDoCliente, TabuleiroEventoDoServidor } from './tabuleiro.ts';
import type { PeaoComandoDoCliente, PeaoEventoDoServidor } from './peoes.ts';
import type {
  EstadoDaPartidaWire,
  PartidaComandoDoCliente,
  PartidaEventoDoServidor,
} from './partida.ts';

export interface PingMessage {
  type: 'PING';
}

export interface PongMessage {
  type: 'PONG';
}

// --- Admissão (game-server WS) ---

export interface AdmissaoAceitaEvento {
  readonly type: 'ADMISSAO_ACEITA';
  readonly jogadorId: string;
  readonly apelido: string;
  readonly partidaId: PartidaId;
  readonly estado: EstadoDaPartidaWire;
}

export type CodigoDeErroDeAdmissao =
  | 'SESSAO_INVALIDA'
  | 'SERVER_ID_INVALIDO'
  | 'PARTIDA_NAO_ENCONTRADA'
  | 'JOGADOR_FORA_DO_ROSTER'
  | 'JOGADOR_NAO_NA_PARTIDA'
  | 'PARTIDA_ID_AUSENTE'
  | 'ORIGEM_NAO_PERMITIDA'
  | 'ERRO_INTERNO';

export interface AdmissaoRejeitadaEvento {
  readonly type: 'ADMISSAO_REJEITADA';
  readonly codigo: CodigoDeErroDeAdmissao;
  readonly motivo: string;
}

export type AdmissaoEventoDoServidor = AdmissaoAceitaEvento | AdmissaoRejeitadaEvento;

// --- Debug (issue #340, "Modo Desenvolvedor") ---

/**
 * Linha espelhada do backend para o PainelDeDepuracao do cliente. Enviada
 * UNICAST apenas às conexões que ativaram o stream (`ATIVAR_DEBUG`), nunca
 * broadcast. `nivel` espelha os níveis do painel; `contexto` identifica a
 * origem escopada (ex.: 'lobby', 'partida'); `mensagem` é a linha pronta.
 */
export interface DebugLogEvento {
  type: 'DEBUG_LOG';
  nivel: 'info' | 'warn' | 'error';
  contexto: string;
  mensagem: string;
}

// --- Union types ---
// ST-11 compat temporária: mantém Tabuleiro/Peao sem jogadorId até migrar game-server/frontend (#117).
// Partida(11 com jogadorId) é o contrato alvo; remover Tabuleiro/Peao após migração.
// TODO ST-11: remover Tabuleiro/Peao de SalaClientMessage após migrar game-server/frontend (#117)
export type SalaClientMessage =
  | SalaComandoDoCliente
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente
  | PartidaComandoDoCliente;
export type SalaServerMessage =
  | SalaEventoDoServidor
  | EncaminhamentoEventoDoServidor
  | TabuleiroEventoDoServidor
  | PeaoEventoDoServidor
  | PartidaEventoDoServidor;

export type ClientMessage = PingMessage | SalaClientMessage;

export type ServerMessage = PongMessage | SalaServerMessage | AdmissaoEventoDoServidor | DebugLogEvento;
