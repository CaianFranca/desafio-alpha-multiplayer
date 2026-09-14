// Chaves Redis do game-server — módulo comum para evitar ciclo partidas.ts ↔ estado.ts (RN3).
// Prefixos compartilhados com o lobby em `@flicker/config` (review JF532, O1).
import {
  GAME_SERVERS_PARTIDA_CHAT_PREFIXO,
  GAME_SERVERS_PARTIDA_ESTADO_PREFIXO,
  GAME_SERVERS_PARTIDA_PREFIXO,
} from '@flicker/config';

export function chaveDaPartida(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_PREFIXO}${partidaId}`;
}

export function chaveDoEstadoDaPartida(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_ESTADO_PREFIXO}${partidaId}`;
}

/**
 * Histórico do chat de Partida (issue #388): lista Redis própria por Partida,
 * fora do blob de estado, capped em ~50 (humanas + bot). Nasce no primeiro
 * `RPUSH` (lista vazia não existe no Redis) com `EXPIRE` da preparada,
 * `PERSIST` em `em_andamento`, `EXPIRE` com retenção de término e `DEL` em
 * cancelamento/não-início.
 */
export function chaveDoChatDaPartida(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_CHAT_PREFIXO}${partidaId}`;
}

/**
 * Pendência de Retorno ao lobby (issue #290, item 4): gravada ANTES do envio
 * e apagada após a conclusão (aceito ou rejeição definitiva — o cliente de
 * retorno só retorna nesses casos). Crash-restart no meio do envio deixa a
 * chave para o re-drive em `anunciarTurnoAtual`/comandos pós-término; o
 * retorno do lobby é idempotente, então reenviar é seguro.
 */
export function chaveDoRetornoPendente(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_PREFIXO}retorno-pendente:${partidaId}`;
}
