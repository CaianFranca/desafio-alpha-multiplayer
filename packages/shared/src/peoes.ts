// Protocolo WS dos Peões e do ciclo da sequência — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Peão, Conexão, Recebimento, Movimentação, Permanência, Borda Aberta.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   Comandos:
//   shared type:'SELECIONAR_PEAO'                <-> engine tipo:'selecionar_peao' (peaoId)
//   shared type:'POSICIONAR_PEAO'                <-> engine tipo:'posicionar_peao' (peaoId, celula)
//   shared type:'ESCOLHER_TIPO_DA_PECA_RECEBIDA' <-> engine tipo:'escolher_tipo_da_peca_recebida' (recebidaId, tipoDaPeca)
//   shared type:'MOVER_PEAO'                     <-> engine tipo:'mover_peao' (peaoId, celula)
//   shared type:'PERMANECER'                     <-> engine tipo:'permanecer' (peaoId)
//   Eventos:
//   shared type:'PEAO_SELECIONADO'                <-> engine tipo:'peao_selecionado' (peaoId)
//   shared type:'RECEBIMENTO_GERADO'              <-> engine tipo:'recebimento_gerado' (PendenciaDeRecebimento[])
//   shared type:'PEAO_POSICIONADO'                <-> engine tipo:'peao_posicionado' (peaoId, pecaId, celula)
//   shared type:'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO' <-> engine tipo:'tipo_da_peca_recebida_escolhido' (recebidaId, pecaId, tipoDaPeca)
//   shared type:'PEAO_MOVIDO'                     <-> engine tipo:'peao_movido' (peaoId, pecaIdDe, pecaIdPara, celula)
//   shared type:'PEAO_PERMANECEU'                 <-> engine tipo:'peao_permaneceu' (peaoId, pecaId)
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso do contrato do Tabuleiro (./tabuleiro.ts): girar/posicionar da Peça
// Recebida usam os comandos REAIS do engine (GirarPecaComando /
// PosicionarPecaComando), roteados para a Recebida pelo pecaId no game-server:
//   shared type:'GIRAR_PECA' (pecaId de Recebida)      <-> engine tipo:'girar_peca' (roteia para a Recebida pelo pecaId)
//   shared type:'POSICIONAR_PECA' (pecaId de Recebida) <-> engine tipo:'posicionar_peca' (encaixe da Recebida na célula-alvo)
// O ciclo também emite peca_selecionada / peca_deselecionada no engine (girar
// uma Recebida exige SELECIONAR_PECA antes); no wire esses eventos chegam via
// TabuleiroEventoDoServidor (SalaServerMessage), sem redefinição aqui.

import type { Celula, PecaId } from './tabuleiro.ts';

// --- Tipos base ---

export type PeaoId = string;

export type RecebidaId = string;

export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

// sync manual com engine.TipoDePecaDeCaminho
export type TipoDePecaDeCaminho = 'reta' | 'T' | 'cruz';

export interface PendenciaDeRecebimento {
  readonly recebidaId: RecebidaId;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
  // O pecaId da Recebida só aparece no wire no evento TIPO_DA_PECA_RECEBIDA_ESCOLHIDO.
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
  readonly recebidaId: RecebidaId;
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

// --- Eventos servidor → cliente (6) ---
// Reusos do ciclo via TabuleiroEventoDoServidor (SalaServerMessage), sem
// redefinição aqui: peca_selecionada, peca_deselecionada, peca_girada,
// peca_posicionada, manipulacao_finalizada e erro_do_tabuleiro.

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
  readonly recebidaId: RecebidaId;
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
  | PeaoPermaneceuEvento;
