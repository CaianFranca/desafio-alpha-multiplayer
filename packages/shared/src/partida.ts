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
//   shared type:'DESELECIONAR_PEAO' + jogadorId <-> engine tipo:'desselecionar_peao' + ator — issue #249
//   shared type:'POSICIONAR_PEAO' + jogadorId <-> engine tipo:'posicionar_peao' + ator
//   shared type:'ESCOLHER_VAGA_DA_PECA_RECEBIDA' + jogadorId <-> engine tipo:'escolher_vaga_da_peca_recebida' + ator — issue #138
//   shared type:'MOVER_PEAO' + jogadorId <-> engine tipo:'mover_peao' + ator
//   shared type:'PERMANECER' + jogadorId <-> engine tipo:'permanecer' + ator
//   shared type:'CONFIRMAR_POSICAO_DO_PEAO' + jogadorId <-> engine tipo:'confirmar_posicao_do_peao' + ator
//   shared type:'ENCERRAR_TURNO' + jogadorId <-> engine tipo:'encerrar_turno' + ator
//   Eventos:
//   shared type:'TURNO_INICIADO' { jogadorId, rodada } <-> engine tipo:'turno_iniciado' { jogadorId, rodada }
//   shared type:'TURNO_ENCERRADO' { jogadorId } <-> engine tipo:'turno_encerrado' { jogadorId }
//   shared type:'POSICAO_CONFIRMADA' { jogadorId, peaoId, pecaId, protegido } <-> engine tipo:'posicao_confirmada' idem — protegido (issue #227) é o estado RESULTANTE do ator no fim do gatilho completo (concessão da Sala Médica, consumo pelo ataque do MESMO gatilho e Proteção prévia não consumida incluídos).
//   shared type:'PECA_SORTEADA' { pecaId, tipoDaPeca, orientacao } <-> engine tipo:'peca_sorteada' idem — emitido pelo Recebimento da #138 (e pelo sorteio unitário da Caixa)
//   shared type:'VAGA_DA_PECA_RECEBIDA_ESCOLHIDO' { recebidaId, borda, celulaAlvo } <-> engine tipo:'vaga_da_peca_recebida_escolhida' idem — issue #138
//   (Estes dois eventos novos vivem nesta união, e não em
//   PeaoEventoDoServidor/TabuleiroEventoDoServidor, porque são o contrato do
//   canal de Partida — o canal alvo do ST-11. A limpeza do wire legado da
//   ST-10 (#140/#143) removeu os switches legados do cliente.)
//   shared type:'CELULAS_ILUMINADAS' { celulas } <-> engine tipo:'celulas_iluminadas' { celulas }
//   shared type:'LIMPEZA_APLICADA' { pecasRemovidas } <-> engine tipo:'limpeza_aplicada' { pecasRemovidas }
//   shared type:'PARTIDA_TERMINADA' { resultado, motivo? } <-> engine tipo:'partida_terminada' { desfecho } — issue #179; motivo da derrota (#145-exp)
//   (O Resultado wire é 'vitoria' | 'derrota' (ResultadoDaPartidaWire) e o
//   motivo da derrota viaja em campo opcional separado (MotivoDeDerrotaWire,
//   sync com DesfechoDaPartida — engine/src/partida.ts:128-133): presente só
//   com resultado 'derrota'; payloads de binário anterior omitem o campo —
//   o cliente trata ausente/null como "motivo desconhecido". A vitória não
//   tem motivo no domínio; o wire não inventa um.)
//   shared type:'ATAQUE_RESOLVIDO' { atacantes, peoesAtingidos, protegidos, estadosAplicados } <-> engine tipo:'ataque_resolvido' idem — issues #172/#173
//   (Shape 1:1 com o evento de domínio; o refinamento do wire/feedback da
//   issue #173 está concluído neste commit: `estadosAplicados` carrega o
//   estado resultante das penalidades (Baixa Iluminação, sanidade,
//   Amedrontado) por Jogador mudado, e o snapshot do Jogador expõe
//   sanidade/emBaixaIluminacao/amedrontado.)
//   Erros: CodigoDeErroDaPartida alias de CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120) — FORA_DA_VEZ, PARTIDA_TERMINADA etc via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
//   shared type:UPPER_SNAKE no wire vs engine tipo:snake no domínio; campos em camelCase nos dois lados
//   Snapshot (issue #145): EstadoDaPartidaSnapshot.tabuleiro.pecasRestantesNaCaixa
//   <-> engine tabuleiro.caixa.length (projeção em game-server snapshot.ts);
//   EstadoDaPartidaSnapshot.geradoresLigados <-> engine geradoresLigados
//   (espelho exato: readonly string[] de pecaIds);
//   EstadoDaPartidaSnapshot.cartaoDeAcessoObtido <-> engine cartaoDeAcessoObtido.
//   EstadoDaPartidaSnapshot.jogadores[].protegido <-> engine jogador.protegido
//   (baseline da Proteção da Sala Médica, issue #227: concessão vive na
//   Confirmação de Posição e consumo em ATAQUE_RESOLVIDO.protegidos; o
//   cliente reconcilia pelo snapshot sem derivar do histórico).
//   Sync manual: o engine não conhece o wire; novos contadores de objetivo
//   exigem estender as duas pontas à mão (projeção + modelo do cliente).
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
import type { PeaoId, RecebidaId, BordaCardinal, VagaDaPecaRecebidaEscolhidaEvento } from './peoes.ts';

// --- Comandos cliente → servidor (12) ---

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

// Desseleção autoritativa (issue #249): o servidor é a autoridade inclusive
// para desselecionar; idempotente no domínio, rejeitada sob pendências.
export interface DesselecionarPeaoPartidaComando {
  readonly type: 'DESELECIONAR_PEAO';
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
  | DesselecionarPeaoPartidaComando
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
  // Proteção do ator RESULTANTE do gatilho (issue #227): o espelho exato do
  // `protegido` do ator no ESTADO FINAL — true quando a Sala Médica a concedeu
  // (sobrevive ao ataque do MESMO gatilho) OU quando uma Proteção prévia não
  // foi consumida; false quando não havia Proteção ou ela foi consumida pelo
  // ataque do próprio gatilho (sem Sala Médica no destino para restaurá-la).
  readonly protegido: boolean;
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

// Motivo da derrota (issue #145-exp): sync manual com o motivo de
// DesfechoDaPartida do engine (packages/engine/src/partida.ts:130-132) —
// 'caixa_esgotada' (Caixa Esgotada sem objetivos alcançáveis,
// caixaEsgotadaSemObjetivos) e 'equipe_amedrontada' (Sanidade 0 em toda a
// equipe). Tipo fechado: a vitória não tem motivo no domínio e o wire não
// inventa um. Terminais do glossário (CONTEXT.md): Caixa, Amedrontado.
export type MotivoDeDerrotaWire = 'caixa_esgotada' | 'equipe_amedrontada';

export type EstadoDaPartidaWire = 'preparada' | 'em_andamento' | 'terminada';

export type CorDoPeaoWire = 'branco' | 'vermelho' | 'azul' | 'amarelo';

export type TipoDaPecaWire =
  | 'inicial'
  // sync manual com engine.TipoDePecaDeCaminho
  | 'reta'
  | 'T'
  | 'cruz'
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
  // Estados dos Monstros no snapshot (issue #173): sanidade atual, Baixa
  // Iluminação (Vulto) e Amedrontado (Espectro ao zerar sanidade) — o cliente
  // projeta sem derivar do histórico de eventos.
  readonly sanidade: number;
  readonly emBaixaIluminacao: boolean;
  readonly amedrontado: boolean;
  // Proteção da Sala Médica no snapshot (issue #227): baseline do estado da
  // Proteção por Jogador — o cliente projeta sem derivar do histórico de
  // eventos (a concessão vive na Confirmação de Posição e o consumo em
  // ATAQUE_RESOLVIDO.protegidos).
  readonly protegido: boolean;
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
  // Contagem da Caixa no HUD (issue #145, spec pai ST-12 #137): projeção de
  // engine tabuleiro.caixa.length. Ao vivo o cliente deriva por decremento em
  // PECA_SORTEADA (id inédito); o snapshot é a baseline que reconcilia
  // reconexões sem recarregamento.
  readonly pecasRestantesNaCaixa: number;
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
  // Motivo da derrota (issue #145-exp): companheiro de `resultado` com a
  // mesma semântica do `motivo` em PARTIDA_TERMINADA — presente somente quando
  // `resultado === 'derrota'`. Opcional/defensivo: snapshots persistidos por
  // binário anterior omitem o campo (padrão do `?? null` do `resultado`).
  readonly motivo?: MotivoDeDerrotaWire | null;
  // Conquistas / Objetivos Globais (issue #145, glossário CONTEXT.md):
  // baseline dos contadores de chip na moldura. `geradoresLigados` é o espelho
  // exato do engine (pecaIds das Peças Gerador já ligadas — packages/engine/
  // src/partida.ts); `cartaoDeAcessoObtido` é monotônico: Limpeza não revoga.
  readonly geradoresLigados: readonly string[];
  readonly cartaoDeAcessoObtido: boolean;
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
  /**
   * Motivo quando `resultado === 'derrota'` (issue #145-exp). Opcional e
   * defensivo: payloads de binário anterior omitem o campo — o cliente trata
   * ausente/null como "motivo desconhecido". Nunca presente na vitória.
   */
  readonly motivo?: MotivoDeDerrotaWire | null;
}

// Um Monstro que disparou no gatilho, com os peões dentro do Alcance atual
// (inclusive os de Jogadores protegidos — o ataque contra eles é negado).
export interface AtacanteNoAlcance {
  readonly pecaId: PecaId;
  readonly tipo: 'vulto' | 'espectro';
  readonly peoesNoAlcance: readonly PeaoId[];
}

// Estado resultante das penalidades (issue #173) para um Jogador atingido
// cujo roster mudou no gatilho. Espelho de EstadoResultanteDoAtaque do
// engine: jogador imune (já Amedrontado) e jogador protegido não mudam e
// NÃO aparecem; ataque sem alvos atingidos ⇒ array vazio.
export interface EstadoResultanteNoAtaque {
  readonly jogadorId: string;
  readonly emBaixaIluminacao: boolean;
  readonly sanidade: number;
  readonly amedrontado: boolean;
}

// Ataque dos Monstros (issues #172/#173): broadcast nos gatilhos definitivos
// da Partida (posicionamento do Peão do Primeiro Turno e Confirmação de
// Posição com mudança de peça) quando ao menos um Monstro dispara — mesmo
// que ninguém seja atingido. Shape 1:1 com o evento de domínio;
// estadosAplicados (issue #173) carrega o estado RESULTANTE das penalidades
// (Baixa Iluminação, sanidade, Amedrontado) por Jogador mudado — o eco do
// feedback aos clientes, não os efeitos em si.
export interface AtaqueResolvidoWireEvento {
  readonly type: 'ATAQUE_RESOLVIDO';
  readonly atacantes: readonly AtacanteNoAlcance[];
  // Peões atingidos finais (pós-Proteção), na ordem canônica dos Peões.
  readonly peoesAtingidos: readonly PeaoId[];
  // Jogadores cuja Proteção foi consumida nesta resolução (ordem do roster).
  readonly protegidos: readonly string[];
  // Estado resultante das penalidades por Jogador mudado (issue #173).
  readonly estadosAplicados: readonly EstadoResultanteNoAtaque[];
}

// Resgate (issue #171): chegada do aliado por conexão à peça do afetado.
// Shape 1:1 com ResgateRealizadoEvento do domínio.
export interface ResgateRealizadoWireEvento {
  readonly type: 'RESGATE_REALIZADO';
  readonly pecaId: PecaId;
  readonly resgatadoJogadorId: string;
  readonly resgatadorJogadorId: string;
  readonly resgatadorPeaoId: PeaoId;
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
  | AtaqueResolvidoWireEvento
  | ResgateRealizadoWireEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
