export type * from './sala.ts';
export type * from './encaminhamento.ts';
export type {
  ClientMessage,
  PingMessage,
  PongMessage,
  SalaClientMessage,
  SalaServerMessage,
  ServerMessage,
  AdmissaoAceitaEvento,
  AdmissaoRejeitadaEvento,
  AdmissaoEventoDoServidor,
  CodigoDeErroDeAdmissao,
} from './protocol.ts';