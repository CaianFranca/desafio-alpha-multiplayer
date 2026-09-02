// Protocolo WS do Tabuleiro — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Tabuleiro, Célula, Peça, Orientação, Sentido de Rotação, Reserva, Manipulação, Finalização.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   shared type:'SELECIONAR_PECA'       <-> engine tipo:'selecionar_peca' (UPPER_SNAKE no wire, snake no domínio)
//   shared type:'GIRAR_PECA'            <-> engine tipo:'girar_peca'
//   shared type:'POSICIONAR_PECA'       <-> engine tipo:'posicionar_peca'
//   shared type:'FINALIZAR_MANIPULACAO' <-> engine tipo:'finalizar_manipulacao'
//   shared Celula{linha,coluna} (0-6)    <-> engine Celula{linha,coluna}
//   shared Orientacao 0|90|180|270       <-> engine Orientacao idem
//   shared SentidoDeRotacao 'horario'|'anti_horario' <-> engine SentidoDeRotacao idem
//   shared PecaId string opaca           <-> engine PecaDaReserva.pecaId / PecaPosicionada.pecaId
//   shared type:UPPER_SNAKE ('SELECIONAR_PECA') vs engine tipo:snake ('selecionar_peca'); campos em camelCase nos dois lados
// Ver ADR-0004 para grade 7x7 e vizinhança ortogonal.

import type { CodigoDeErroComum } from './sala.ts';

// --- Tipos base ---

export type Orientacao = 0 | 90 | 180 | 270;

export type SentidoDeRotacao = 'horario' | 'anti_horario';

export interface Celula {
  readonly linha: number;
  readonly coluna: number;
}

export type PecaId = string;

// sync manual com engine.TipoDePecaDaCaixa — peças de caminho + especiais +
// monstros (ST-15 / issue #169); a Peça Inicial nunca entra na Caixa
// (ST-12 / issue #144).
export type TipoDePecaDaCaixa =
  | 'reta'
  | 'T'
  | 'cruz'
  | 'gerador'
  | 'sala_do_diretor'
  | 'sala_medica'
  | 'portao_de_saida'
  | 'vulto'
  | 'espectro';

// --- Comandos cliente → servidor (4) ---

export interface SelecionarPecaComando {
  readonly type: 'SELECIONAR_PECA';
  readonly pecaId: PecaId;
}

export interface GirarPecaComando {
  readonly type: 'GIRAR_PECA';
  readonly pecaId: PecaId;
  readonly sentido: SentidoDeRotacao;
}

export interface PosicionarPecaComando {
  readonly type: 'POSICIONAR_PECA';
  readonly pecaId: PecaId;
  readonly celula: Celula;
}

export interface FinalizarManipulacaoComando {
  readonly type: 'FINALIZAR_MANIPULACAO';
}

export type TabuleiroComandoDoCliente =
  | SelecionarPecaComando
  | GirarPecaComando
  | PosicionarPecaComando
  | FinalizarManipulacaoComando;

// --- Eventos servidor → cliente (5 + erro) ---

export interface PecaSelecionadaEvento {
  readonly type: 'PECA_SELECIONADA';
  readonly pecaId: PecaId;
}

export interface PecaDeselecionadaEvento {
  readonly type: 'PECA_DESELECIONADA';
  readonly pecaId: PecaId;
}

export interface PecaGiradaEvento {
  readonly type: 'PECA_GIRADA';
  readonly pecaId: PecaId;
  readonly orientacaoAnterior: Orientacao;
  readonly orientacao: Orientacao;
  readonly sentido: SentidoDeRotacao;
}

export interface PecaPosicionadaEvento {
  readonly type: 'PECA_POSICIONADA';
  readonly pecaId: PecaId;
  readonly celula: Celula;
  readonly orientacao: Orientacao;
}

export interface ManipulacaoFinalizadaEvento {
  readonly type: 'MANIPULACAO_FINALIZADA';
  readonly pecaId: PecaId;
}

// A união cobre também as rejeições de Peões/ciclo (ST-10) e Turnos (ST-11).
// CAIXA_ESGOTADA entra pela ST-12 (issue #144) como adição; RESERVA_ESGOTADA
// foi removido do wire na limpeza da sync (#140) — o domínio já não o emite.
export type CodigoDeErroDoTabuleiro =
  | CodigoDeErroComum
  | 'ESTADO_INDISPONIVEL'
  | 'PECA_NAO_ENCONTRADA'
  | 'PECA_NAO_SELECIONADA'
  | 'CAIXA_ESGOTADA'
  | 'CELULA_NAO_ENCONTRADA'
  | 'CELULA_JA_OCUPADA'
  | 'PECA_JA_POSICIONADA'
  | 'MANIPULACAO_ENCERRADA'
  | 'PEAO_NAO_ENCONTRADO'
  | 'PEAO_JA_POSICIONADO'
  | 'PEAO_NAO_SELECIONADO'
  | 'PECA_INICIAL_EXIGIDA'
  | 'CELULA_SEM_PECA'
  | 'PECA_JA_TEM_PEAO'
  | 'PENDENCIA_NAO_RESOLVIDA'
  | 'MOVIMENTO_NAO_CONECTADO'
  | 'PECA_NAO_RECEBIDA'
  | 'PECA_FORA_DO_ALVO'
  | 'RECEBIDA_NAO_ENCONTRADA'
  | 'FORA_DA_VEZ'
  | 'PECA_INICIAL_INDISPONIVEL'
  | 'POSICAO_CONFIRMADA'
  | 'ENCERRAMENTO_INVALIDO'
  | 'MOVIMENTO_INDISPONIVEL'
  // Término da Partida (issue #179): recusa de qualquer comando de jogo
  // pós-término; viaja pelo ERRO_DO_TABULEIRO como os demais códigos de Turno.
  | 'PARTIDA_TERMINADA';

export interface ErroDoTabuleiroEvento {
  readonly type: 'ERRO_DO_TABULEIRO';
  readonly codigo: CodigoDeErroDoTabuleiro;
  readonly mensagem: string;
}

export type TabuleiroEventoDoServidor =
  | PecaSelecionadaEvento
  | PecaDeselecionadaEvento
  | PecaGiradaEvento
  | PecaPosicionadaEvento
  | ManipulacaoFinalizadaEvento
  | ErroDoTabuleiroEvento;
