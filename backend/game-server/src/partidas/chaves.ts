// Chaves Redis do game-server — módulo comum para evitar ciclo partidas.ts ↔ estado.ts (RN3).
// Prefixos compartilhados com o lobby em `@flicker/config` (review JF532, O1).
import {
  GAME_SERVERS_PARTIDA_ESTADO_PREFIXO,
  GAME_SERVERS_PARTIDA_PREFIXO,
} from '@flicker/config';

export function chaveDaPartida(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_PREFIXO}${partidaId}`;
}

export function chaveDoEstadoDaPartida(partidaId: string): string {
  return `${GAME_SERVERS_PARTIDA_ESTADO_PREFIXO}${partidaId}`;
}
