// Re-export explícito da implementação canónica em @flicker/shared para garantir que
// testes de integração (game-server) cubram a mesma lógica usada em produção.
// Export wildcard evitado para não vazar símbolos de sala/protocol no namespace redis.
export {
  GAME_SERVERS_PREFIX,
  chaveGameServer,
  estaDisponivel,
  listarGameServersDisponiveis,
} from '@flicker/shared';
export type { GameServerDisponivel } from '@flicker/shared';
