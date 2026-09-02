// Protocolo WS da Partida — Turnos e loop — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Jogador Ativo, Turno, Rodada, Passagem de Vez, Primeiro Turno, Confirmação de Posição, Encerramento do Turno (CONTEXT.md:179-207).
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   Comandos (shared wire + jogadorId <-> engine tipo + ator):
//   shared type:'SELECIONAR_PECA' + jogadorId <-> engine tipo:'selecionar_peca' + ator
//   shared type:'GIRAR_PECA' + jogadorId <-> engine tipo:'girar_peca' + ator
//   shared type:'POSICIONAR_PECA' + jogadorId <-> engine tipo:'posicionar_peca' + ator
//   shared type:'FINALIZAR_MANIPULACAO' + jogadorId <-> engine tipo:'finalizar_manipulacao' + ator
//   shared type:'SELECIONAR_PEAO' + jogadorId <-> engine tipo:'selecionar_peao' + ator
//   shared type:'POSICIONAR_PEAO' + jogadorId <-> engine tipo:'posicionar_peao' + ator
//   shared type:'ESCOLHER_VAGA_DA_PECA_RECEBIDA' + jogadorId <-> engine tipo:'escolher_vaga_da_peca_recebida' + ator — issue #138
//   shared type:'MOVER_PEAO' + jogadorId <-> engine tipo:'mover_peao' + ator
//   shared type:'PERMANECER' + jogadorId <-> engine tipo:'permanecer' + ator
//   shared type:'CONFIRMAR_POSICAO_DO_PEAO' + jogadorId <-> engine tipo:'confirmar_posicao_do_peao' + ator
//   shared type:'ENCERRAR_TURNO' + jogadorId <-> engine tipo:'encerrar_turno' + ator
//   Eventos:
//   shared type:'TURNO_INICIADO' { jogadorId, rodada } <-> engine tipo:'turno_iniciado' { jogadorId, rodada }
//   shared type:'TURNO_ENCERRADO' { jogadorId } <-> engine tipo:'turno_encerrado' { jogadorId }
//   shared type:'POSICAO_CONFIRMADA' { jogadorId, peaoId, pecaId } <-> engine tipo:'posicao_confirmada' { jogadorId, peaoId, pecaId }
//   shared type:'PECA_SORTEADA' { pecaId, tipoDaPeca, orientacao } <-> engine tipo:'peca_sorteada' idem — emitido pelo Recebimento da #138 (e pelo sorteio unitário da Caixa)
//   shared type:'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' { recebidaId, borda, celulaAlvo } <-> engine tipo:'vaga_da_peca_recebida_escolhida' idem — issue #138
//   (Estes dois eventos novos vivem nesta união, e não em
//   PeaoEventoDoServidor/TabuleiroEventoDoServidor, porque são o contrato do
//   canal de Partida — o canal alvo do ST-11 — e as uniões antigas têm
//   switches exaustivos no frontend legado, intocado pela #138.)
//   shared type:'CELULAS_ILUMINADAS' { celulas } <-> engine tipo:'celulas_iluminadas' { celulas }
//   shared type:'LIMPEZA_APLICADA' { pecasRemovidas } <-> engine tipo:'limpeza_aplicada' { pecasRemovidas }
//   shared type:'PARTIDA_TERMINADA' { resultado } <-> engine tipo:'partida_terminada' { desfecho } — issue #179
//   (O Resultado wire é 'vitoria' | 'derrota' (ResultadoDaPartidaWire); o
//   motivo da derrota no engine fica interno — o contrato expõe apenas o par.)
//   shared type:'ATAQUE_RESOLVIDO' { atacantes, peoesAtingidos, protegidos } <-> engine tipo:'ataque_resolvido' idem — issue #172
//   (Shape 1:1 com o evento de domínio; o refinamento do wire/feedback —
//   celular de penalidades, feedback ao cliente — é da issue #173.)
//   Erros: CodigoDeErroDaPartida alias de CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120) — FORA_DA_VEZ, PARTIDA_TERMINADA etc via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//
// Reuso: importa PecaId de ./tabuleiro.ts e PeaoId de ./peoes.ts; não duplica tipos base.
// Sem runtime/validação/sem @flicker/engine — apenas DTOs.
// Sufixo "Wire": eventos com homônimo em @flicker/engine recebem sufixo Wire
// para evitar colisão nominal em consumers que importam ambos pacotes.

import type {
  Celula,
  CodigoDeErroDoTabuleiro,
  Orientacao,
  PecaId,
  SentidoDeRotacao,
  TipoDePecaDaCaixa,
} from './tabuleiro.ts';
import type {
  PeaoId,
  RecebidaId,
  BordaCardinal,
  TipoDePecaDeCaminho,
  VagaDaPecaRecebidaEscolhidaEvento,
} from './peoes.ts';

// --- Comandos cliente → servidor (11) ---

export interface SelecionarPecaPartidaComando {
  readonly type: 'SELECIONAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
}

export interface GirarPecaPartidaComando {
  readonly type: 'GIRAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
  readonly sentido: SentidoDeRotacao;
}

export interface PosicionarPecaPartidaComando {
  readonly type: 'POSICIONAR_PECA';
  readonly jogadorId: string;
  readonly pecaId: PecaId;
  readonly celula: Celula;
}

export interface FinalizarManipulacaoPartidaComando {
  readonly type: 'FINALIZAR_MANIPULACAO';
  readonly jogadorId: string;
}

export interface SelecionarPeaoPartidaComando {
  readonly type: 'SELECIONAR_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface PosicionarPeaoPartidaComando {
  readonly type: 'POSICIONAR_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

// Escolha da vaga (issue #138): uma escolha POR peça sorteada — a borda
// indicada deve ser uma vaga disponível da Peça sob o Peão selecionado.
export interface EscolherVagaDaPecaRecebidaPartidaComando {
  readonly type: 'ESCOLHER_VAGA_DA_PECA_RECEBIDA';
  readonly jogadorId: string;
  readonly recebidaId: RecebidaId;
  readonly borda: BordaCardinal;
}

export interface MoverPeaoPartidaComando {
  readonly type: 'MOVER_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export interface PermanecerPartidaComando {
  readonly type: 'PERMANECER';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface ConfirmarPosicaoDoPeaoComando {
  readonly type: 'CONFIRMAR_POSICAO_DO_PEAO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
}

export interface EncerrarTurnoComando {
  readonly type: 'ENCERRAR_TURNO';
  readonly jogadorId: string;
}

export type PartidaComandoDoCliente =
  | SelecionarPecaPartidaComando
  | GirarPecaPartidaComando
  | PosicionarPecaPartidaComando
  | FinalizarManipulacaoPartidaComando
  | SelecionarPeaoPartidaComando
  | PosicionarPeaoPartidaComando
  | EscolherVagaDaPecaRecebidaPartidaComando
  | MoverPeaoPartidaComando
  | PermanecerPartidaComando
  | ConfirmarPosicaoDoPeaoComando
  | EncerrarTurnoComando;

// --- Eventos servidor → cliente (5 + 2 da issue #138) ---

export interface TurnoIniciadoEvento {
  readonly type: 'TURNO_INICIADO';
  readonly jogadorId: string;
  readonly rodada: number;
}

export interface TurnoEncerradoEvento {
  readonly type: 'TURNO_ENCERRADO';
  readonly jogadorId: string;
}

export interface PosicaoConfirmadaEvento {
  readonly type: 'POSICAO_CONFIRMADA';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly pecaId: PecaId;
}

// Uma peça retirada da Caixa por sorteio (issue #138: uma por peça do
// Recebimento; a primitiva unitária sortearDaCaixa também a emite).
export interface PecaSorteadaEvento {
  readonly type: 'PECA_SORTEADA';
  readonly pecaId: PecaId;
  readonly tipoDaPeca: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
}

// Reexportado de ./peoes.ts (conceito de Recebida): a escolha da vaga fixa a
// borda e a célula-alvo da pendência e seleciona a Peça sorteada.
export type { VagaDaPecaRecebidaEscolhidaEvento };

// --- Snapshot wire (ST-14) — projeção tipada sem runtime ---

// Resultado do término da Partida (issue #179): o par vitória/derrota do
// glossário (CONTEXT.md); em evento simultâneo das condições, a vitória tem
// prioridade — essa regra vive no engine, o wire só transporta o par.
// Sufixo Wire: o engine já exporta um homônimo ResultadoDaPartida (o
// resultado de operação de seus comandos) — a colisão nominal segue a
// convenção do cabeçalho.
export type ResultadoDaPartidaWire = 'vitoria' | 'derrota';

export type EstadoDaPartidaWire = 'preparada' | 'em_andamento' | 'terminada';

export type CorDoPeaoWire = 'branco' | 'vermelho' | 'azul' | 'amarelo';

export type TipoDaPecaWire =
  | 'inicial'
  | TipoDePecaDeCaminho
  | 'gerador'
  | 'sala_do_diretor'
  | 'sala_medica'
  | 'portao_de_saida'
  | 'vulto'
  | 'espectro';

export interface JogadorNoSnapshot {
  readonly jogadorId: string;
  readonly apelido: string;
  readonly cor: CorDoPeaoWire;
  readonly ordem: number;
  readonly peaoId: PeaoId;
  readonly primeiroTurnoPendente: boolean;
}

export interface PecaPosicionadaNoSnapshot {
  readonly pecaId: PecaId;
  readonly tipo: TipoDaPecaWire;
  readonly orientacao: Orientacao;
  readonly celula: Celula;
}

export interface PecaInicialNoSnapshot {
  readonly pecaId: PecaId;
  readonly tipo: 'inicial';
  readonly orientacao: Orientacao;
}

export interface PeaoNoSnapshot {
  readonly peaoId: PeaoId;
  readonly cor: CorDoPeaoWire;
  readonly pecaId: PecaId | null;
}

// No domínio pós-#138 o Recebimento sorteia as peças da Caixa: cada pendência
// carrega a Peça sorteada (pecaId + tipo + orientação) e a vaga (com a
// célula-alvo derivada dela) só é fixada pela escolha de vaga.
export interface RecebidaNoSnapshot {
  readonly recebidaId: RecebidaId;
  readonly pecaId: PecaId;
  readonly tipo: TipoDePecaDaCaixa;
  readonly orientacao: Orientacao;
  readonly vaga: BordaCardinal | null;
  readonly celulaAlvo: Celula | null;
}

export interface TabuleiroNoSnapshot {
  readonly posicionadas: readonly PecaPosicionadaNoSnapshot[];
  readonly iniciais: readonly PecaInicialNoSnapshot[];
  readonly peoes: readonly PeaoNoSnapshot[];
  readonly recebidas: readonly RecebidaNoSnapshot[];
  readonly pecaSelecionadaId: PecaId | null;
  readonly pecaEmManipulacaoId: PecaId | null;
  readonly peaoSelecionadoId: PeaoId | null;
}

export interface EstadoDaPartidaSnapshot {
  readonly tabuleiro: TabuleiroNoSnapshot;
  readonly jogadores: readonly JogadorNoSnapshot[];
  readonly jogadorAtivoId: string;
  readonly rodada: number;
  readonly pecaDoInicioDoTurnoId: PecaId | null;
  readonly posicaoConfirmada: boolean;
  readonly celulasIluminadas: readonly Celula[];
  readonly estado: EstadoDaPartidaWire;
  // Término (issue #179): não nulo quando e somente quando estado === 'terminada' —
  // preserva o Resultado no snapshot entregue a quem se conecta (recarregamento).
  readonly resultado: ResultadoDaPartidaWire | null;
}

export interface PartidaIniciadaEvento {
  readonly type: 'PARTIDA_INICIADA';
  readonly partidaId: string;
}

export interface EstadoDaPartidaEvento {
  readonly type: 'ESTADO_DA_PARTIDA';
  readonly snapshot: EstadoDaPartidaSnapshot;
}

export interface CelulasIluminadasWireEvento {
  readonly type: 'CELULAS_ILUMINADAS';
  readonly celulas: readonly Celula[];
}

export interface LimpezaAplicadaWireEvento {
  readonly type: 'LIMPEZA_APLICADA';
  readonly pecasRemovidas: readonly PecaId[];
}

// Término da Partida (issue #179): broadcast com o Resultado no instante em
// que o engine consome o desfecho; é o último evento do lote da Ação que
// consumou o término.
export interface PartidaTerminadaWireEvento {
  readonly type: 'PARTIDA_TERMINADA';
  readonly resultado: ResultadoDaPartidaWire;
}

// Um Monstro que disparou no gatilho, com os peões dentro do Alcance atual
// (inclusive os de Jogadores protegidos — o ataque contra eles é negado).
export interface AtacanteNoAlcance {
  readonly pecaId: PecaId;
  readonly tipo: 'vulto' | 'espectro';
  readonly peoesNoAlcance: readonly PeaoId[];
}

// Ataque dos Monstros (issue #172): broadcast nos gatilhos definitivos da
// Partida (posicionamento do Peão do Primeiro Turno e Confirmação de Posição
// com mudança de peça) quando ao menos um Monstro dispara — mesmo que ninguém
// seja atingido. Shape 1:1 com o evento de domínio; a aplicação das
// penalidades e o refinamento do feedback são das issues #170/#173.
export interface AtaqueResolvidoWireEvento {
  readonly type: 'ATAQUE_RESOLVIDO';
  readonly atacantes: readonly AtacanteNoAlcance[];
  // Peões atingidos finais (pós-Proteção), na ordem canônica dos Peões.
  readonly peoesAtingidos: readonly PeaoId[];
  // Jogadores cuja Proteção foi consumida nesta resolução (ordem do roster).
  readonly protegidos: readonly string[];
}

export type PartidaEventoDoServidor =
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento
  | PartidaIniciadaEvento
  | EstadoDaPartidaEvento
  | PartidaTerminadaWireEvento
  | AtaqueResolvidoWireEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
