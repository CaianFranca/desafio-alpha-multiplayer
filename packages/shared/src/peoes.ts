// Protocolo WS dos Peões e do ciclo da sequência — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Peão, Conexão, Recebimento, Movimentação, Permanência, Borda Aberta.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   shared type:'SELECIONAR_PEAO'             <-> engine tipo:'selecionar_peao' (peaoId)
//   shared type:'POSICIONAR_PEAO'             <-> engine tipo:'posicionar_peao' (peaoId, celula)
//   shared type:'ESCOLHER_TIPO_DA_PECA_RECEBIDA' <-> engine tipo:'escolher_tipo_da_peca_recebida' (recebidaId, tipoDaPeca)
//   shared type:'MOVER_PEAO'                  <-> engine tipo:'mover_peao' (peaoId, celula)
//   shared type:'PERMANECER'                  <-> engine tipo:'permanecer' (peaoId)
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso do contrato do Tabuleiro (./tabuleiro.ts): girar/posicionar da Peça
// Recebida são roteados pelo pecaId, então reutilizam GirarPecaComando /
// PosicionarPecaComando (o game-server roteia a Recebida pelo pecaId); os
// eventos PecaGiradaEvento / PecaPosicionadaEvento / ManipulacaoFinalizadaEvento /
// ErroDoTabuleiroEvento entram no PeaoEventoDoServidor sem serem redefinidos aqui.

import type {
  Celula,
  ErroDoTabuleiroEvento,
  ManipulacaoFinalizadaEvento,
  PecaGiradaEvento,
  PecaId,
  PecaPosicionadaEvento,
} from './tabuleiro.ts';

// --- Tipos base ---

export type PeaoId = string;

export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

export type TipoDePecaDeCaminho = 'reta' | 'T' | 'cruz';

export interface PendenciaDeRecebimento {
  readonly recebidaId: string;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
}

// --- Comandos cliente → servidor (5) ---
// girar/posicionar da Peça Recebida usam GirarPecaComando / PosicionarPecaComando de ./tabuleiro.ts.

export interface SelecionarPeaoComando {
  readonly type: 'SELECIONAR_PEAO';
  readonly peaoId: PeaoId;
}

export interface PosicionarPeaoComando {
  readonly type: 'POSICIONAR_PEAO';
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export interface EscolherTipoDaPecaRecebidaComando {
  readonly type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA';
  readonly recebidaId: string;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

export interface MoverPeaoComando {
  readonly type: 'MOVER_PEAO';
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export interface PermanecerComando {
  readonly type: 'PERMANECER';
  readonly peaoId: PeaoId;
}

export type PeaoComandoDoCliente =
  | SelecionarPeaoComando
  | PosicionarPeaoComando
  | EscolherTipoDaPecaRecebidaComando
  | MoverPeaoComando
  | PermanecerComando;

// --- Eventos servidor → cliente (6 + reuso do Tabuleiro) ---

export interface PeaoSelecionadoEvento {
  readonly type: 'PEAO_SELECIONADO';
  readonly peaoId: PeaoId;
}

export interface RecebimentoGeradoEvento {
  readonly type: 'RECEBIMENTO_GERADO';
  readonly recebidas: readonly PendenciaDeRecebimento[];
}

export interface PeaoPosicionadoEvento {
  readonly type: 'PEAO_POSICIONADO';
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
  readonly celula: Celula;
}

export interface TipoDaPecaRecebidaEscolhidoEvento {
  readonly type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO';
  readonly recebidaId: string;
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

export interface PeaoMovidoEvento {
  readonly type: 'PEAO_MOVIDO';
  readonly peaoId: PeaoId;
  readonly pecaIdDe: PecaId;
  readonly pecaIdPara: PecaId;
  readonly celula: Celula;
}

export interface PeaoPermaneceuEvento {
  readonly type: 'PEAO_PERMANECEU';
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
}

export type PeaoEventoDoServidor =
  | PeaoSelecionadoEvento
  | RecebimentoGeradoEvento
  | PeaoPosicionadoEvento
  | TipoDaPecaRecebidaEscolhidoEvento
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | ManipulacaoFinalizadaEvento
  | ErroDoTabuleiroEvento;
