export type {
  CodigoDeErro,
  Comando,
  CriarSalaComando,
  EntrarNaSalaComando,
  ErroDeDominio,
  EstadoDaSala,
  EstadoDoLobby,
  EstadoDoVinculo,
  EventoDeDominio,
  Membro,
  MotivoDeEncerramento,
  Resultado,
  Sala,
  SairDaSalaComando,
} from './lobby.ts';

export {
  MOTIVOS_DE_ENCERRAMENTO,
  aplicarComando,
  admitirMembro,
  criarSala,
  estadoDoLobbyVazio,
  entrarNaSala,
  sairDaSala,
} from './lobby.ts';
