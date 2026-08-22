// Contratos do Encaminhamento — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Encaminhamento, Partida, Roster, Oferta, Aceite, Recusa, Cancelamento.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   shared.MembroDaSala                         <-> engine.Membro (shared tem apelido/presenca/prontidao)
//   shared.OfertaDeEncaminhamento.roster (tupla 4×MembroDaSala) <-> engine.Sala.membros (readonly Membro[])
//   shared type:'PARTIDA_DISPONIVEL'             <-> engine tipo futuro ('partida_disponivel' / Partida.*)
//   shared ServerId/PartidaId (string opaca)     <-> engine Partida.id / GameServer.id
// Ver sala.ts e ADR-0003 para convenção wire (UPPER_SNAKE em type, snake em Presenca, camelCase nos demais campos).
// Códigos de erro: união fechada via CodigoDeErroComum (sala.ts) — sem (string & {}), evoluir explicitamente.

import type { CodigoDeErroComum, CodigoDeSala, MembroDaSala } from './sala.ts';

// --- Aliases opacos ---

export type ServerId = string;
export type PartidaId = string;

export type CodigoDeErroDoEncaminhamento =
  | CodigoDeErroComum
  | 'ROSTER_INVALIDO'
  | 'PARTIDA_NAO_ENCONTRADA'
  | 'ENCAMINHAMENTO_RECUSADO'
  | 'ENCAMINHAMENTO_FALHOU';

// --- Payloads HTTP handoff (lobby-server <-> game-server) ---

export interface OfertaDeEncaminhamento {
  readonly salaId: string;
  readonly codigoDeSala: CodigoDeSala;
  readonly roster: readonly [MembroDaSala, MembroDaSala, MembroDaSala, MembroDaSala];
}

export interface AceiteDoEncaminhamento {
  readonly partidaId: PartidaId;
  readonly serverId: ServerId;
}

export interface RecusaDoEncaminhamento {
  readonly codigo: CodigoDeErroDoEncaminhamento;
  readonly motivo: string;
}

export interface CancelamentoDoEncaminhamento {
  readonly partidaId: PartidaId;
  readonly motivo: string;
}

// --- Eventos WS servidor → cliente (4) ---

export interface PartidaPreparandoEvento {
  readonly type: 'PARTIDA_PREPARANDO';
}

export interface PartidaRecusadaEvento {
  readonly type: 'PARTIDA_RECUSADA';
  readonly codigo: CodigoDeErroDoEncaminhamento;
  readonly motivo: string;
}

export interface PartidaFalhouEvento {
  readonly type: 'PARTIDA_FALHOU';
  readonly codigo: CodigoDeErroDoEncaminhamento;
  readonly motivo: string;
}

export interface PartidaDisponivelEvento {
  readonly type: 'PARTIDA_DISPONIVEL';
  readonly partidaId: PartidaId;
  readonly serverId: ServerId;
}

export type EncaminhamentoEventoDoServidor =
  | PartidaPreparandoEvento
  | PartidaRecusadaEvento
  | PartidaFalhouEvento
  | PartidaDisponivelEvento;
