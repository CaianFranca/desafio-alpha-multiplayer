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
//   shared type:'DESISTIR_DA_PARTIDA' + jogadorId <-> engine tipo:'desistir_da_partida' + ator — issue #288 (rota própria: vale no próprio turno ou fora dele, só o próprio Jogador; PARTIDA_TERMINADA antes de tudo; JOGADOR_NAO_NA_PARTIDA para fora do roster/já-saído)
//   shared type:'ENVIAR_MENSAGEM_DE_CHAT' + jogadorId — SEM par no engine (issue #390): o Chat de Partida não é Ação de jogo; o julgamento tem rota própria no game-server (recusas MENSAGEM_VAZIA/MENSAGEM_LONGA_DEMAIS/LIMITE_DE_MENSAGENS, fora das guardas de turno e de término). O literal coincide com o comando do chat da Sala (./sala.ts) — canais são servidores distintos e as sub-uniões narrow separadamente.
//   Eventos:
//   shared type:'TURNO_INICIADO' { jogadorId, rodada } <-> engine tipo:'turno_iniciado' { jogadorId, rodada }
//   (Tempo de turno #429: o wire carrega ainda `deadlineDoTurnoEm?` — epoch ms
//   do relógio do game-server — sem par no engine, que é puro e sem timers;
//   o snapshot `EstadoDaPartidaSnapshot.deadlineDoTurnoEm?` espelha o mesmo marco.)
//   shared type:'TURNO_AVISO_30S' { jogadorId, segundosRestantes } — sem par no
//   engine (#429): aviso único do relógio aos 30s restantes (urgência + bipes no HUD).
//   shared type:'PRIMEIRO_TURNO_AVISO_FINAL' { jogadorId, segundosExtras } — sem
//   par no engine (#429): o engine emite `aviso_final_do_primeiro_turno` no domínio
//   e o relógio estende aquele turno em +30s únicos.
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
//   shared type:'PARTIDA_TERMINADA' { resultado, motivo? } <-> engine tipo:'partida_terminada' { desfecho } — issue #179; motivo da derrota (#145-exp, 'desistencia' pela #289/ADR-0013, consumida na #288)
//   shared type:'DESISTENCIA_REGISTRADA' { jogadorId, peaoId, causa? } <-> engine tipo:'desistencia_registrada' idem — núcleo #289 (ADR-0013), fiação/aviso #288 (abre o lote do comando, antes de celulas_iluminadas/limpeza_aplicada e da Passagem de Vez); causa #295 ('desistencia'|'expiracao', ausente = desistencia implícita) + 'tempo' pela #429 (Desistência automática do relógio do turno: 4ª falta ou 2º expiry do Primeiro Turno incompleto)
//   shared type:'JOGADOR_EM_RECONEXAO' { jogadorId } — sem par no engine (#295, spec #292 história 2): anúncio de presença da entrada na janela, broadcast só em `em_andamento` (a `preparada` nunca emite)
//   shared type:'JOGADOR_RECONECTADO' { jogadorId } — sem par no engine (#295): anúncio de presença da volta dentro da janela, broadcast só na re-admissão em `em_andamento` (exclui as admissões iniciais)
//   (O Resultado wire é 'vitoria' | 'derrota' (ResultadoDaPartidaWire) e o
//   motivo da derrota viaja em campo opcional separado (MotivoDeDerrotaWire,
//   sync com DesfechoDaPartida — engine/src/partida.ts:156-161; 'desistencia'
//   incluído pela ADR-0013/#289): presente só
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

// --- Comandos cliente → servidor (14 + 2 de controle de debug) ---

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

// Atravessar o Escuro (issue #264 / spec #272, fluxo canônico sob demanda em
// Baixa pela ADR-0017 / issue #377 — Opção B): o comando wire do canal de
// Partida — o `jogadorId` viaja aqui (forma do ST-11). O saque de 1 peça
// acontece neste gesto (após a escolha da célula escura), seguido de
// posicionar → mover compulsório → confirmar.
export interface AtravessarOEscuroPartidaComando {
  readonly type: 'ATRAVESSAR_O_ESCURO';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly celula: Celula;
}

export interface EncerrarTurnoComando {
  readonly type: 'ENCERRAR_TURNO';
  readonly jogadorId: string;
}

// Desistência (issue #288): ato irreversível de sair da Partida em andamento.
// Rota própria — vale no próprio turno ou fora dele, sem FORA_DA_VEZ; só o
// próprio Jogador desiste (ator = sessão autenticada, o `jogadorId` do wire é
// vestigial como nos demais comandos, #155).
export interface DesistirDaPartidaComando {
  readonly type: 'DESISTIR_DA_PARTIDA';
  readonly jogadorId: string;
}

// Chat de Partida (issue #390): comando wire do canal de Partida com rota
// própria de julgamento no game-server — NÃO é Ação de jogo (sem par no
// engine, fora de `mapearComandoDaPartida`). O `jogadorId` segue o padrão
// vestigial (#155): obrigatório pela guarda de forma, o ator é sempre a
// sessão autenticada do socket.
export interface EnviarMensagemDeChatDaPartidaComando {
  readonly type: 'ENVIAR_MENSAGEM_DE_CHAT';
  readonly jogadorId: string;
  readonly conteudo: string;
}

// Controle do stream de debug (issue #340, "Modo Desenvolvedor"): interceptados
// na camada `ws.ts` do game-server, ANTES de `aplicarMensagem` — a guarda do
// contrato (`ehComandoDaPartida`) os recusaria como DADOS_INVALIDOS. Sem
// payload: o escopo é a Partida da conexão (o `partida-id` do upgrade).
export interface AtivarDebugDaPartidaComando {
  readonly type: 'ATIVAR_DEBUG';
}

export interface DesativarDebugDaPartidaComando {
  readonly type: 'DESATIVAR_DEBUG';
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
  | AtravessarOEscuroPartidaComando
  | EncerrarTurnoComando
  | DesistirDaPartidaComando
  | EnviarMensagemDeChatDaPartidaComando
  | AtivarDebugDaPartidaComando
  | DesativarDebugDaPartidaComando;

// --- Eventos servidor → cliente (18: Turno/posição/iluminação/limpeza,
// sorteio+vaga da #138, iniciada+estado, término da #179, ataque #172/#173,
// resgate #171, desistência #288, presença em reconexão #295, chat #390,
// avisos de tempo de turno #429) ---

export interface TurnoIniciadoEvento {
  readonly type: 'TURNO_INICIADO';
  readonly jogadorId: string;
  readonly rodada: number;
  // Tempo de turno (issue #429, spec #405): deadline absoluto do turno (epoch
  // ms, autoridade do game-server, ticket 2/3) — o HUD deriva a contagem MM:SS
  // sem eventos por segundo. Opcional/defensivo: payloads de binário anterior
  // omitem o campo e o cliente normaliza ausente para null (sem cronômetro).
  readonly deadlineDoTurnoEm?: number | null;
}

export interface TurnoEncerradoEvento {
  readonly type: 'TURNO_ENCERRADO';
  readonly jogadorId: string;
}

// Tempo de turno (issue #429, spec #405): aviso único aos 30s restantes do
// turno vigente — o relógio (game-server, ticket 2/3) o emite uma única vez
// por turno; o HUD entra em urgência e toca os 3 bipes (ticket 3/3) na chegada.
// `segundosRestantes` viaja no evento para o cliente não fixar a carência.
export interface TurnoAviso30sEvento {
  readonly type: 'TURNO_AVISO_30S';
  readonly jogadorId: string;
  readonly segundosRestantes: number;
}

// Tempo de turno (issue #429, spec #405): aviso final do Primeiro Turno com a
// etapa da Peça Inicial ou do peão incompleta ("jogue ou a Desistência é
// automática") —
// evento próprio com destaque no HUD (ticket 3/3); o relógio estende aquele
// turno em +30s únicos (flag por Jogador, uma vez por Partida, no engine).
// `segundosExtras` viaja no evento para o cliente não fixar a carência.
export interface PrimeiroTurnoAvisoFinalEvento {
  readonly type: 'PRIMEIRO_TURNO_AVISO_FINAL';
  readonly jogadorId: string;
  readonly segundosExtras: number;
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
// DesfechoDaPartida do engine (packages/engine/src/partida.ts:156-161) —
// 'caixa_esgotada' (Caixa Esgotada sem objetivos alcançáveis,
// caixaEsgotadaSemObjetivos), 'equipe_amedrontada' (Sanidade 0 em toda a
// equipe) e 'desistencia' (quórum mínimo — um Jogador restante após
// desistências, ADR-0013/#289; precede a vitória). Tipo fechado: a vitória
// não tem motivo no domínio e o wire não inventa um. Terminais do glossário
// (CONTEXT.md): Caixa, Amedrontado, Desistência.
export type MotivoDeDerrotaWire = 'caixa_esgotada' | 'equipe_amedrontada' | 'desistencia';

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

export type PresencaNaPartidaWire = 'conectado' | 'em_reconexao';

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
  // Presença na Partida em andamento (issue #294, spec #292): indica se o
  // jogador está em janela de reconexão (`em_reconexao`) ou conectado.
  // Opcional com fallback `conectado` (compat com snapshots antigos sem campo).
  readonly presenca?: PresencaNaPartidaWire;
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
  // Tempo de turno (issue #429, spec #405): deadline absoluto do turno vigente
  // (epoch ms, autoridade do game-server, ticket 2/3) — o HUD deriva a contagem
  // MM:SS sem eventos por segundo. Opcional/defensivo como `iniciadaEm?`: snapshots
  // persistidos por binário anterior omitem o campo e o cliente normaliza
  // ausente para null.
  readonly deadlineDoTurnoEm?: number | null;
  // Fase da Travessia do Escuro (ADR-0017 / issue #377): pelo contrário da
  // posição confirmada, a readmissão NÃO re-aprende por deltas (o servidor só
  // re-entrega ESTADO_DA_PARTIDA) — sem os campos, recarregar/reconectar no
  // meio do turno órfã a fase (marcadores voltam e o auto-mover não dispara).
  // Opcional/defensivo: snapshots persistidos por binário anterior omitem.
  readonly atravessouNoTurno?: boolean;
  readonly pecaDaTravessiaId?: string | null;
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
  // Marco autoritativo do início da Partida (epoch ms, issue #259): o HUD
  // deriva o cronômetro dele, então os Jogadores mostram o mesmo MM:SS e a
  // retomada não reinicia. Opcional/defensivo: snapshots produzidos por
  // binário anterior omitem o campo — o cliente normaliza ausente para null
  // (cronômetro sem origem) e a partida `preparada` traz null.
  readonly iniciadaEm?: number | null;
  // Histórico do chat de Partida (issue #388): as últimas mensagens aprovadas
  // (humanas + bot, limitado com aparo no topo — default 50) em ordem
  // oldest→newest, fora do blob de estado. Opcional/defensivo como
  // `iniciadaEm?`/`motivo?`: ausente quando o chamador sem histórico não o
  // fornece e o cliente normaliza ausente para [].
  readonly historicoDeChat?: readonly MensagemDeChatDaPartidaEvento[];
}

export interface PartidaIniciadaEvento {
  readonly type: 'PARTIDA_INICIADA';
  readonly partidaId: string;
  // Marco autoritativo do início (epoch ms, issue #259): os Jogadores que
  // receberam snapshot `preparada` (iniciadaEm null) obtêm o marco por este
  // broadcast no instante atômico da virada para em_andamento.
  // Opcional/defensivo (review PR #374): espelha `EstadoDaPartidaSnapshot.
  // iniciadaEm?` — binário legado pode omitir o campo e o reducer do cliente
  // preserva o marco vigente em vez de gravar `undefined`.
  readonly iniciadaEm?: number | null;
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
// (inclusive os de Jogadores protegidos — o ataque contra eles é negado) e
// as peças do Alcance na ordem canônica do engine (issue #384: campo
// observacional para a coreografia do ataque; nenhum cliente julga por ele).
// Opcional para compat: payload de servidor antigo omite o campo.
export interface AtacanteNoAlcance {
  readonly pecaId: PecaId;
  readonly tipo: 'vulto' | 'espectro';
  readonly peoesNoAlcance: readonly PeaoId[];
  readonly pecasNoAlcance?: readonly PecaId[];
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

// Ataque dos Monstros (issues #172/#173, centrado no atuante pela #237 —
// fiação na Partida pela #236): broadcast nos gatilhos definitivos do
// ATUANTE — o posicionamento do Peão no Primeiro Turno (entrada), a
// Confirmação de Posição com mudança de peça (entrada/saída) e a Permanência
// (permanecer dentro dispara) — quando ao menos um Monstro dispara, mesmo
// que ninguém seja atingido (saída do alcance com zero restantes). Fora→fora
// é silêncio: mover sem confirmar, encerrar o turno e posicionamentos de
// peça nunca disparam. Shape 1:1 com o evento de domínio;
// estadosAplicados (issue #173) carrega o estado RESULTANTE das penalidades
// (Baixa Iluminação, sanidade, Amedrontado) por Jogador mudado — o eco do
// feedback aos clientes, não os efeitos em si. Cada atacante carrega ainda
// `pecasNoAlcance` (issue #384, opcional para aceitar payload de servidor
// antigo sem o campo).
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
// Carrega o estado resultante do resgatado (emBaixaIluminacao/sanidade), pois
// a cura pode ser parcial — o cliente aplica exatamente, sem adivinhar.
export interface ResgateRealizadoWireEvento {
  readonly type: 'RESGATE_REALIZADO';
  readonly pecaId: PecaId;
  readonly resgatadoJogadorId: string;
  readonly resgatadorJogadorId: string;
  readonly resgatadorPeaoId: PeaoId;
  readonly emBaixaIluminacao: boolean;
  readonly sanidade: number;
}

// Desistência (issue #288): eco do domínio — o Jogador saiu da Partida em
// andamento; o peão indicado foi removido e a vez saiu da ordem. Abre o lote
// do comando e serve de aviso aos restantes (com a nova ordem via
// TURNO_INICIADO e o tabuleiro via CELULAS_ILUMINADAS/LIMPEZA_APLICADA do
// mesmo lote). Shape 1:1 com DesistenciaRegistradaEvento do domínio.
// Causa (issue #295): ausente = 'desistencia' implícita (compat com binários
// antigos); 'expiracao' = conversão automática da janela de reconexão.
// Causa (issue #429, spec #405): 'tempo' = Desistência automática do relógio
// do turno (4ª falta ou 2º expiry do Primeiro Turno ainda incompleto), com o
// mesmo efeito e eventos da Desistência.
// Alias local por pacote: mesmo shape do `CausaDesistencia` do engine — sync
// manual entre os dois (o shared não pode depender do engine).
export type CausaDesistencia = 'desistencia' | 'expiracao' | 'tempo';

export interface DesistenciaRegistradaWireEvento {
  readonly type: 'DESISTENCIA_REGISTRADA';
  readonly jogadorId: string;
  readonly peaoId: PeaoId;
  readonly causa?: CausaDesistencia;
}

// Presença em reconexão (issue #295, spec #292 história 2): a entrada na
// janela e a volta dentro dela são anunciadas aos restantes para que o
// cliente projete o indicador "reconectando" (#294) — sem par no engine (o
// domínio não conhece presença de conexão) e sem espelho no snapshot (a
// #294 não deriva o indicador dali). Broadcast só em `em_andamento`: a
// `preparada` nunca emite (não tem janela, só não-início).
export interface JogadorEmReconexaoWireEvento {
  readonly type: 'JOGADOR_EM_RECONEXAO';
  readonly jogadorId: string;
}

// Volta dentro da janela (#295): broadcast na re-admissão que encontra a
// partida em `em_andamento` com presença efetivamente restaurada
// (`transicao.mudou && !iniciou`) — exclui as N admissões iniciais que viram
// `em_andamento`, que anunciam PARTIDA_INICIADA em vez disto.
export interface JogadorReconectadoWireEvento {
  readonly type: 'JOGADOR_RECONECTADO';
  readonly jogadorId: string;
}

// Mensagem de chat aprovada (issue #390): broadcast serial ao roster vigente
// do canal de Partida — o servidor gera `enviadoEm` (ISO 8601, mesma ordem
// serial dos eventos de jogo, cadeia por Partida). `apelido` é resolvido pelo
// servidor (Conexão do JWT da admissão, fallback ao roster da PartidaPreparada)
// e `jogadorId` é a Sessão do ator — bots comentam pelo MESMO evento com a
// identidade do roster (apelido e cor do peão) e não leem o chat humano.
export interface MensagemDeChatDaPartidaEvento {
  readonly type: 'MENSAGEM_DE_CHAT_DA_PARTIDA';
  readonly jogadorId: string;
  readonly apelido: string;
  readonly conteudo: string;
  readonly enviadoEm: string;
}

export type PartidaEventoDoServidor =
  | TurnoIniciadoEvento
  | TurnoEncerradoEvento
  | TurnoAviso30sEvento
  | PrimeiroTurnoAvisoFinalEvento
  | PosicaoConfirmadaEvento
  | CelulasIluminadasWireEvento
  | LimpezaAplicadaWireEvento
  | PecaSorteadaEvento
  | VagaDaPecaRecebidaEscolhidaEvento
  | PartidaIniciadaEvento
  | EstadoDaPartidaEvento
  | PartidaTerminadaWireEvento
  | AtaqueResolvidoWireEvento
  | ResgateRealizadoWireEvento
  | DesistenciaRegistradaWireEvento
  | JogadorEmReconexaoWireEvento
  | JogadorReconectadoWireEvento
  | MensagemDeChatDaPartidaEvento;

// --- Erro ---
// Alias documentativo — os 5 códigos de turno vivem em CodigoDeErroDoTabuleiro (./tabuleiro.ts:116-120)
// e viajam via ERRO_DO_TABULEIRO (SalaServerMessage via TabuleiroEventoDoServidor).
export type CodigoDeErroDaPartida = CodigoDeErroDoTabuleiro;
