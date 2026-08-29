export type * from './sala.ts';
export type * from './encaminhamento.ts';
export type {
  ClientMessage,
  PingMessage,
  PongMessage,
  SalaClientMessage,
  SalaServerMessage,
  ServerMessage,
} from './protocol.ts';
export type {
  Jogador,
  CampoDeErroDeAutenticacao,
  ErroAuthItem,
  ErroAuth,
  CadastroPayload,
  LoginPayload,
} from './autenticacao.ts';
// Somente DTOs (type-only) no entry raiz para o bundle do browser continuar seguro.
// Helpers de runtime (redis) vivem no entry server-side: `@flicker/shared/server`.
