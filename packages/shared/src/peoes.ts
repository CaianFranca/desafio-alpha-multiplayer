// Protocolo WS dos Peões e do ciclo da sequência — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Peão, Conexão, Recebimento, Movimentação, Permanência, Borda Aberta.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   Comandos:
//   shared type:'SELECIONAR_PEAO'                <-> engine tipo:'selecionar_peao' (peaoId)
//   shared type:'DESELECIONAR_PEAO'              <-> engine tipo:'desselecionar_peao' (peaoId) — issue #249
//   shared type:'POSICIONAR_PEAO'                <-> engine tipo:'posicionar_peao' (peaoId, celula)
//   shared type:'ESCOLHER_VAGA_DA_PECA_RECEBIDA' <-> engine tipo:'escolher_vaga_da_peca_recebida' (recebidaId, borda) — issue #138
//   shared type:'MOVER_PEAO'                     <-> engine tipo:'mover_peao' (peaoId, celula)
//   shared type:'PERMANECER'                     <-> engine tipo:'permanecer' (peaoId)
//   (ATRAVESSAR_O_ESCURO viaja só no canal de Partida — ./partida.ts — issue #264)
//   Eventos:
//   shared type:'PEAO_SELECIONADO'                <-> engine tipo:'peao_selecionado' (peaoId)
//   shared type:'PEAO_DESELECIONADO'              <-> engine tipo:'peao_desselecionado' (peaoId) — issue #249
//   shared type:'RECEBIMENTO_GERADO'              <-> engine tipo:'recebimento_gerado' (pendências sorteada da #138 em PendenciaDaPecaSorteada)
//   shared type:'PEAO_POSICIONADO'                <-> engine tipo:'peao_posicionado' (peaoId, pecaId, celula)
//   shared type:'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' <-> engine tipo:'vaga_da_peca_recebida_escolhida' (recebidaId, borda, celulaAlvo) — issue #138
//   shared type:'PEAO_MOVIDO'                     <-> engine tipo:'peao_movido' (peaoId, pecaIdDe, pecaIdPara, celula)
//   shared type:'PEAO_PERMANECEU'                 <-> engine tipo:'peao_permaneceu' (peaoId, pecaId)
//   shared type:'ATRAVESSOU_O_ESCURO'             <-> engine tipo:'atravessou_o_escuro' (peaoId, celula) — issue #264
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
//
// O wire legado da ST-10 (comando e evento de escolha de tipo, e a pendência
// com borda geradora fixa na criação) saiu do domínio na #138 e foi removido
// daqui na limpeza da #140/#143.

import type { Celula, PecaId, TipoDePecaDaCaixa } from './tabuleiro.ts';

// --- Tipos base ---

export type PeaoId = string;

export type RecebidaId = string;

export type BordaCardinal = 'norte' | 'leste' | 'sul' | 'oeste';

// Pendência do Recebimento (issue #138): a Peça já vem sorteada da Caixa
// (pecaId + tipo + orientação de composição) e a vaga (com a célula-alvo
// derivada dela) só é fixada por ESCOLHER_VAGA_DA_PECA_RECEBIDA.
export interface PendenciaDaPecaSorteada {
  readonly recebidaId: RecebidaId;
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly vaga: BordaCardinal | null;
  readonly celulaAlvo: Celula | null;
}

// --- Comandos cliente → servidor (6) ---
// girar/posicionar da Peça Recebida usam GirarPecaComando / PosicionarPecaComando de ./tabuleiro.ts.

export interface SelecionarPeaoComando {
  readonly type: 'SELECIONAR_PEAO';
  readonly peaoId: PeaoId;
}

// Desseleção autoritativa (issue #249): o servidor é a autoridade inclusive
// para desselecionar — o cliente nunca roteia por estado local divergente.
// Idempotente no domínio (já desselecionado ou outro peão em sequência é
// no-op); rejeitada sob Recebidas pendentes (PENDENCIA_NAO_RESOLVIDA).
export interface DesselecionarPeaoComando {
  readonly type: 'DESELECIONAR_PEAO';
  readonly peaoId: PeaoId;
}

export interface PosicionarPeaoComando {
  readonly type: 'POSICIONAR_PEAO';
  readonly peaoId: PeaoId;
  readonly celula: Celula;
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

// Atravessar o Escuro (issue #264 / spec #272): jogada exclusiva de Baixa
// Iluminação — o Peão da vez atravessa para a célula escura conectada (vaga
// não iluminada) adjacente à peça sob ele no Tabuleiro. NÃO entra neste
// contrato de Peão: o comando viaja apenas pelo canal de Partida, com o
// `jogadorId` de forma (AtravessarOEscuroPartidaComando em ./partida.ts) —
// o tabuleiro só o vê como evento ATRAVESSOU_O_ESCURO na redução do cliente.
export type PeaoComandoDoCliente =
  | SelecionarPeaoComando
  | DesselecionarPeaoComando
  | PosicionarPeaoComando
  | EscolherVagaDaPecaRecebidaComando
  | MoverPeaoComando
  | PermanecerComando;

// --- Eventos servidor → cliente (7) ---
// Reusos do ciclo via TabuleiroEventoDoServidor (SalaServerMessage), sem
// redefinição aqui: peca_selecionada, peca_deselecionada, peca_girada,
// peca_posicionada, manipulacao_finalizada e erro_do_tabuleiro.

export interface PeaoSelecionadoEvento {
  readonly type: 'PEAO_SELECIONADO';
  readonly peaoId: PeaoId;
}

// Espelho da desseleção autoritativa (issue #249): idempotente COM
// confirmação — sempre emitido quando o comando é válido, inclusive quando a
// seleção vigente já estava limpa ou era de outro peão (o redutor dos demais
// clientes trata como no-op).
export interface PeaoDesselecionadoEvento {
  readonly type: 'PEAO_DESELECIONADO';
  readonly peaoId: PeaoId;
}

export interface RecebimentoGeradoEvento {
  readonly type: 'RECEBIMENTO_GERADO';
  // Forma da #138: cada pendência nasce com a Peça sorteada e a vaga nula.
  readonly recebidas: readonly PendenciaDaPecaSorteada[];
}

export interface PeaoPosicionadoEvento {
  readonly type: 'PEAO_POSICIONADO';
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
  readonly celula: Celula;
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

// Travessia do Escuro (issue #264 / spec #272): o Peão em Baixa Iluminação
// alcançou a célula escura conectada. O evento carrega apenas o Peão e a
// célula de destino — a peça sorteada do Recebimento gerado pela travessia
// chega pelos eventos RECEBIMENTO_GERADO/PECA_SORTEADA do mesmo lote.
export interface AtravessouOEscuroEvento {
  readonly type: 'ATRAVESSOU_O_ESCURO';
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export type PeaoEventoDoServidor =
  | PeaoSelecionadoEvento
  | PeaoDesselecionadoEvento
  | RecebimentoGeradoEvento
  | PeaoPosicionadoEvento
  | PeaoMovidoEvento
  | PeaoPermaneceuEvento
  | AtravessouOEscuroEvento;
