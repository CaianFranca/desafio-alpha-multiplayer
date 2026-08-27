import type { Redis } from 'ioredis';
import type { ServerId } from '@flicker/shared';

export interface ContextoDoGameServer {
  readonly redis: Redis;
  readonly serverId: ServerId;
  readonly jwtSecret: string;
  readonly partidaPreparadaTtlSegundos: number;
}
