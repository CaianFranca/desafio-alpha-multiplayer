export interface Config {
  gameServerPort: number;
}

const DEFAULT_GAME_SERVER_PORT = 3000;

export function getConfig(): Config {
  const rawPort = Number(process.env.GAME_SERVER_PORT ?? DEFAULT_GAME_SERVER_PORT);
  const gameServerPort =
    Number.isInteger(rawPort) && rawPort > 0 ? rawPort : DEFAULT_GAME_SERVER_PORT;
  return { gameServerPort };
}