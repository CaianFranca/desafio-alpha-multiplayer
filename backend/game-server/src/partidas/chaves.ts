// Chaves Redis do game-server — módulo comum para evitar ciclo partidas.ts ↔ estado.ts (RN3).

export function chaveDaPartida(partidaId: string): string {
  return `game-server:partida:${partidaId}`;
}

export function chaveDoEstadoDaPartida(partidaId: string): string {
  return `game-server:partida-estado:${partidaId}`;
}
