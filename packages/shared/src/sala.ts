// Protocolo WS de Sala — DTOs tipados compartilhados via @flicker/shared.
// Vocabulário canônico: Sala, Membro, Anfitrião, Código de Sala, Convite, Presença, Prontidão, Estado da Sala.
// Apenas type/interface, sem runtime, sem validação, sem dependência de @flicker/engine.

// --- Tipos base ---

export type CodigoDeSala = string; // seis caracteres alfanuméricos maiúsculos

export type Presenca = 'conectado' | 'em_reconexao';

export type EstadoDaSala = 'aberta' | 'encerrada';

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

export interface Sala {
  id: string;
  codigoDeSala: CodigoDeSala;
  estado: EstadoDaSala;
  anfitriaoId: string | null;
  membros: readonly MembroDaSala[];
  convite: Convite;
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

export type SalaComandoDoCliente =
  | CriarSalaComando
  | EntrarNaSalaComando
  | SairDaSalaComando
  | AlternarProntidaoComando
  | EnviarMensagemDeChatComando
  | ExpulsarMembroComando
  | DesbloquearJogadorComando
  | EncerrarSalaComando
  | IniciarPartidaComando;

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

export interface ErroDaSalaEvento {
  type: 'ERRO_DA_SALA';
  codigo: string;
  mensagem: string;
}

export type SalaEventoDoServidor =
  | SalaAtualizadaEvento
  | MembroEntrouEvento
  | MembroSaiuEvento
  | MembroDesconectadoEvento
  | MembroExpulsoEvento
  | AnfitriaoSubstituidoEvento
  | ProntidaoAtualizadaEvento
  | MensagemDeChatEvento
  | ErroDaSalaEvento;
