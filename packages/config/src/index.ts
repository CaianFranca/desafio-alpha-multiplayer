import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  gameServerPort: number;
}

const DEFAULT_GAME_SERVER_PORT = 3000;

let envLoaded = false;

function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const here = dirname(fileURLToPath(import.meta.url));
  // .env na raiz do monorepo, resolvido de forma cwd-independente.
  const envPath = join(here, '../../../.env');

  try {
    process.loadEnvFile(envPath);
    envLoaded = true;
  } catch (error) {
    // Arquivo ausente não é erro: getConfig() cai nos defaults.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function getConfig(): Config {
  loadEnvFile();

  const rawPort = Number(process.env.GAME_SERVER_PORT ?? DEFAULT_GAME_SERVER_PORT);
  const gameServerPort =
    Number.isInteger(rawPort) && rawPort > 0 ? rawPort : DEFAULT_GAME_SERVER_PORT;
  return { gameServerPort };
}