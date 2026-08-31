// Protocolo WS dos Peões e do ciclo da sequência — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Peão, Conexão, Recebimento, Movimentação, Permanência, Borda Aberta.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   Comandos:
//   shared type:'SELECIONAR_PEAO'                <-> engine tipo:'selecionar_peao' (peaoId)
//   shared type:'POSICIONAR_PEAO'                <-> engine tipo:'posicionar_peao' (peaoId, celula)
//   shared type:'ESCOLHER_VAGA_DA_PECA_RECEBIDA' <-> engine tipo:'escolher_vaga_da_peca_recebida' (recebidaId, borda) — issue #138
//   shared type:'ESCOLHER_TIPO_DA_PECA_RECEBIDA' <-> engine tipo:'escolher_tipo_da_peca_recebida' (recebidaId, tipoDaPeca) — legado ST-10, removido do domínio pela #138 (limpeza wire na #140/#143)
//   shared type:'MOVER_PEAO'                     <-> engine tipo:'mover_peao' (peaoId, celula)
//   shared type:'PERMANECER'                     <-> engine tipo:'permanecer' (peaoId)
//   Eventos:
//   shared type:'PEAO_SELECIONADO'                <-> engine tipo:'peao_selecionado' (peaoId)
//   shared type:'RECEBIMENTO_GERADO'              <-> engine tipo:'recebimento_gerado' (pendências; forma nova da #138 em PendenciaDaPecaSorteada, legado em PendenciaDeRecebimento)
//   shared type:'PEAO_POSICIONADO'                <-> engine tipo:'peao_posicionado' (peaoId, pecaId, celula)
//   shared type:'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' <-> engine tipo:'vaga_da_peca_recebida_escolhida' (recebidaId, borda, celulaAlvo) — issue #138
//   shared type:'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO' <-> engine tipo:'tipo_da_peca_recebida_escolhido' (recebidaId, pecaId, tipoDaPeca) — legado ST-10, removido do domínio pela #138 (limpeza wire na #140/#143)
//   shared type:'PEAO_MOVIDO'                     <-> engine tipo:'peao_movido' (peaoId, pecaIdDe, pecaIdPara, celula)
//   shared type:'PEAO_PERMANECEU'                 <-> engine tipo:'peao_permaneceu' (peaoId, pecaId)
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso do contrato do Tabuleiro (./tabuleiro.ts): girar/posicionar da Peça
// Recebida usam os comandos REAIS do engine (GirarPecaComando /
// PosicionarPecaComando), roteados para a Recebida pelo pecaId no game-server:
//   shared type:'GIRAR_PECA' (pecaId de Recebida)      <-> engine tipo:'girar_peca' (roteia para a Recebida pelo pecaId)
//   shared type:'POSICIONAR_PECA' (pecaId de Recebida) <-> engine tipo:'posicionar_peca' (encaixe da Recebida na célula-alvo)
// Os eventos reusados do ciclo (PecaGiradaEvento, PecaPosicionadaEvento,
// ManipulacaoFinalizadaEvento e ErroDoTabuleiroEvento) chegam pelo
// TabuleiroEventoDoServidor (SalaServerMessage); aqui ficam apenas os do peão
// (união exclusiva). A Seleção única da ST-09 é reusada internamente sem
// evento próprio: escolher a vaga seleciona a Peça sorteada da Recebida
// (issue #138) e girar a Recebida roteia pelo pecaId sem exigir seleção
// prévia.

import type { Celula, PecaId, TipoDePecaDaCaixa } from './tabuleiro.ts';

// --- Tipos base ---

export type PeaoId = string;

export type RecebidaId = string;

export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

// sync manual com engine.TipoDePecaDeCaminho
export type TipoDePecaDeCaminho = 'reta' | 'T' | 'cruz';

/**
 * Pendência do Recebimento na forma LEGADA (ST-10): borda geradora e
 * célula-alvo fixadas na criação, sem peça até a escolha do tipo.
 *
 * @deprecated O domínio #138 não emite mais esta forma: a pendência nasce com
 * a peça já sorteada e a vaga nula (ver PendenciaDaPecaSorteada). Mantida na
 * união do RECEBIMENTO_GERADO até a limpeza do wire legado (#140/#143).
 */
export interface PendenciaDeRecebimento {
  readonly recebidaId: RecebidaId;
  readonly bordaGeradora: BordaCardinal;
  readonly celulaAlvo: Celula;
  // O pecaId da Recebida só aparece no wire no evento TIPO_DA_PECA_RECEBIDA_ESCOLHIDO.
}

// Pendência do Recebimento na forma nova (issue #138): a Peça já vem sorteada
// da Caixa (pecaId + tipo + orientação de composição) e a vaga (com a
// célula-alvo derivada dela) só é fixada por ESCOLHER_VAGA_DA_PECA_RECEBIDA.
export interface PendenciaDaPecaSorteada {
  readonly recebidaId: RecebidaId;
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly vaga: BordaCardinal | null;
  readonly celulaAlvo: Celula | null;
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

/**
 * Escolha do tipo da Recebida (legado ST-10).
 *
 * @deprecated O domínio #138 removeu a escolha de tipo: o cliente escolhe a
 * VAGA de cada peça já sorteada (EscolherVagaDaPecaRecebidaComando). Permanece
 * na união até a limpeza do wire legado (#140/#143).
 */
export interface EscolherTipoDaPecaRecebidaComando {
  readonly type: 'ESCOLHER_TIPO_DA_PECA_RECEBIDA';
  readonly recebidaId: RecebidaId;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

// Escolha da vaga (issue #138): uma escolha POR peça sorteada — a borda
// indicada deve ser uma vaga disponível da Peça sob o Peão selecionado (borda
// aberta com célula vizinha vazia, ainda não escolhida por outra pendência).
export interface EscolherVagaDaPecaRecebidaComando {
  readonly type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA';
  readonly recebidaId: RecebidaId;
  readonly borda: BordaCardinal;
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
  | EscolherVagaDaPecaRecebidaComando
  | MoverPeaoComando
  | PermanecerComando
  // Legado ST-10, fora do domínio desde a #138 (limpeza na #140/#143).
  | EscolherTipoDaPecaRecebidaComando;

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
  // União aditiva de elementos: forma legada (ST-10, @deprecated) e forma
  // nova da #138 (PendenciaDaPecaSorteada) até a limpeza do wire (#140/#143).
  readonly recebidas: readonly (PendenciaDeRecebimento | PendenciaDaPecaSorteada)[];
}

export interface PeaoPosicionadoEvento {
  readonly type: 'PEAO_POSICIONADO';
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
  readonly celula: Celula;
}

/**
 * Tipo da Recebida escolhido (legado ST-10).
 *
 * @deprecated O domínio #138 removeu a escolha de tipo: o wire passa a levar
 * VAGA_DA_PECA_RECEBIDA_ESCOLHIDO. Permanece na união até a limpeza do wire
 * legado (#140/#143).
 */
export interface TipoDaPecaRecebidaEscolhidoEvento {
  readonly type: 'TIPO_DA_PECA_RECEBIDA_ESCOLHIDO';
  readonly recebidaId: RecebidaId;
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDeCaminho;
}

// A escolha da vaga (issue #138) fixa a borda e a célula-alvo da pendência e
// seleciona a Peça sorteada correspondente.
export interface VagaDaPecaRecebidaEscolhidaEvento {
  readonly type: 'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO';
  readonly recebidaId: RecebidaId;
  readonly borda: BordaCardinal;
  readonly celulaAlvo: Celula;
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
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento
  // O evento da escolha da vaga (#138) e o legado da escolha do tipo viajam
  // pela união da Partida (ver comentario no cabecalho de ./partida.ts).
  | TipoDaPecaRecebidaEscolhidoEvento;
