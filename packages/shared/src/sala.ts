// Protocolo WS de Sala — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Sala, Membro, Anfitrião, Código de Sala, Convite, Presença, Prontidão, Estado da Sala.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.
//
// Fronteira shared (DTO de transporte) vs engine (domínio): propositalmente
// divergem para desacoplar wire do modelo interno. Sync manual quando engine evolui.
//   shared.Sala.codigoDeSala  <-> engine.Sala.codigo
//   shared.MembroDaSala       <-> engine.Membro
//   shared type:'CRIAR_SALA'  <-> engine tipo:'criar_sala' (UPPER_SNAKE no wire, snake no domínio)
//   shared client type:'TYPE' <-> engine Comando.tipo
// Ver ADR correspondente para convenção de literais wire (UPPER_SNAKE em type, ver Presenca abaixo).

// --- Tipos base ---

export const CODIGO_DE_SALA_TAMANHO = 6
export type CodigoDeSala = string; // seis caracteres alfanuméricos maiúsculos (ver CODIGO_DE_SALA_TAMANHO)

/**
 * Presença do Membro no wire. Usa snake_case para literal composto ('em_reconexao'),
 * distinto de engine.MotivoDeEncerramento ('saida' sem underscore) — domínios diferentes.
 * Mantido snake para consistência com `type` UPPER_SNAKE no wire; ver comentário de fronteira no topo.
 * Se ADR futuro padronizar kebab/camel para literais, renomear aqui antes de breaking.
 */
export type Presenca = 'conectado' | 'em_reconexao';

export type EstadoDaSala = 'aberta' | 'encaminhada' | 'encerrada' | 'expirada';

export interface Convite {
  codigoDeSala: CodigoDeSala;
  link: string;
}

export interface MembroDaSala {
  id: string;
  jogadorId: string;
  apelido: string;
  ordemDeEntrada: number;
  presenca: Presenca;
  prontidao: boolean;
}

export interface EncaminhamentoDaSala {
  serverId: string;
  partidaId: string;
}

export interface Sala {
  id: string;
  codigoDeSala: CodigoDeSala;
  estado: EstadoDaSala;
  anfitriaoId: string | null;
  membros: readonly MembroDaSala[];
  convite: Convite;
  /** Alvo do redirect quando a Sala está encaminhada (visível após o aceite, inclusive para quem reconectou). */
  encaminhamento?: EncaminhamentoDaSala | null;
}

// --- Comandos cliente → servidor (9) ---

export interface CriarSalaComando {
  type: 'CRIAR_SALA';
}

export interface EntrarNaSalaComando {
  type: 'ENTRAR_NA_SALA';
  codigoDeSala: CodigoDeSala;
}

export interface SairDaSalaComando {
  type: 'SAIR_DA_SALA';
}

export interface AlternarProntidaoComando {
  type: 'ALTERNAR_PRONTIDAO';
}

export interface EnviarMensagemDeChatComando {
  type: 'ENVIAR_MENSAGEM_DE_CHAT';
  conteudo: string;
}

export interface ExpulsarMembroComando {
  type: 'EXPULSAR_MEMBRO';
  membroId: string;
}

export interface DesbloquearJogadorComando {
  type: 'DESBLOQUEAR_JOGADOR';
  jogadorId: string;
}

export interface EncerrarSalaComando {
  type: 'ENCERRAR_SALA';
}

export interface IniciarPartidaComando {
  type: 'INICIAR_PARTIDA';
}

// Controle do stream de debug (issue #340, "Modo Desenvolvedor"): interceptados
// na camada `ws.ts` do lobby-server, ANTES dos handlers — os handlers os
// recusariam como DADOS_INVALIDOS (o switch não conhece estas variantes). Sem
// payload: o escopo é a Sala do jogador, resolvida pelo servidor no ato.
export interface AtivarDebugComando {
  type: 'ATIVAR_DEBUG';
}

export interface DesativarDebugComando {
  type: 'DESATIVAR_DEBUG';
}

export type SalaComandoDoCliente =
  | CriarSalaComando
  | EntrarNaSalaComando
  | SairDaSalaComando
  | AlternarProntidaoComando
  | EnviarMensagemDeChatComando
  | ExpulsarMembroComando
  | DesbloquearJogadorComando
  | EncerrarSalaComando
  | IniciarPartidaComando
  | AtivarDebugComando
  | DesativarDebugComando;

// --- Eventos servidor → cliente (9) ---

export interface SalaAtualizadaEvento {
  type: 'SALA_ATUALIZADA';
  sala: Sala;
}

export interface MembroEntrouEvento {
  type: 'MEMBRO_ENTROU';
  membro: MembroDaSala;
  sala: Sala;
}

export interface MembroSaiuEvento {
  type: 'MEMBRO_SAIU';
  membroId: string;
  jogadorId: string;
  sala: Sala;
}

export interface MembroDesconectadoEvento {
  type: 'MEMBRO_DESCONECTADO';
  membroId: string;
  jogadorId: string;
  presenca: Presenca;
  sala: Sala;
}

export interface MembroReconectadoEvento {
  type: 'MEMBRO_RECONECTADO';
  membroId: string;
  jogadorId: string;
  presenca: 'conectado';
  sala: Sala;
}

export interface MembroExpulsoEvento {
  type: 'MEMBRO_EXPULSO';
  membroId: string;
  jogadorId: string;
  sala: Sala;
}

export interface AnfitriaoSubstituidoEvento {
  type: 'ANFITRIAO_SUBSTITUIDO';
  anfitriaoId: string | null;
  anfitriaoAnteriorId: string | null;
  sala: Sala;
}

export interface ProntidaoAtualizadaEvento {
  type: 'PRONTIDAO_ATUALIZADA';
  membroId: string;
  prontidao: boolean;
  sala: Sala;
}

export interface MensagemDeChatEvento {
  type: 'MENSAGEM_DE_CHAT';
  membroId: string;
  apelido: string;
  conteudo: string;
  enviadoEm: string;
}

export type CodigoDeErroComum =
  | 'DADOS_INVALIDOS'
  | 'SALA_NAO_ENCONTRADA'
  | 'SALA_ENCERRADA';

export type CodigoDeErroDaSala =
  | CodigoDeErroComum
  | 'SALA_JA_EXISTE'
  | 'CODIGO_SALA_JA_EXISTE'
  | 'MEMBRO_ID_JA_EXISTE'
  | 'SALA_CHEIA'
  | 'JOGADOR_JA_ASSOCIADO'
  | 'MEMBRO_NAO_ENCONTRADO'
  | 'MEMBRO_NAO_ATIVO'
  | 'APENAS_ANFITRIAO'
  | 'JOGADOR_EXPULSO'
  | 'JOGADOR_NAO_BLOQUEADO'
  | 'SALA_INCONSISTENTE'
  | 'SALA_ENCAMINHADA'
  | 'ENCAMINHAMENTO_INVALIDO';

export interface ErroDaSalaEvento {
  type: 'ERRO_DA_SALA';
  codigo: CodigoDeErroDaSala;
  mensagem: string;
}

export type SalaEventoDoServidor =
  | SalaAtualizadaEvento
  | MembroEntrouEvento
  | MembroSaiuEvento
  | MembroDesconectadoEvento
  | MembroReconectadoEvento
  | MembroExpulsoEvento
  | AnfitriaoSubstituidoEvento
  | ProntidaoAtualizadaEvento
  | MensagemDeChatEvento
  | ErroDaSalaEvento;
