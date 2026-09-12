import type { Redis } from 'ioredis';
import type { ServerId } from '@flicker/shared';

export interface ContextoDoGameServer {
  readonly redis: Redis;
  readonly serverId: ServerId;
  readonly jwtSecret: string;
  readonly partidaPreparadaTtlSegundos: number;
  readonly partidaNaoInicioSegundos?: number;
  readonly partidaTerminadaTtlSegundos?: number;
  readonly lobbyRetornoCallbackUrl?: string;
  readonly lobbyDesistenciaCallbackUrl?: string;
}
