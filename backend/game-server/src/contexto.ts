import type { Redis } from 'ioredis';
import type { ServerId } from '@flicker/shared';

export interface ContextoDoGameServer {
  readonly redis: Redis;
  readonly serverId: ServerId;
  readonly jwtSecret: string;
  readonly partidaPreparadaTtlSegundos: number;
  readonly partidaNaoInicioSegundos?: number;
  readonly partidaReconexaoEmAndamentoSegundos?: number;
  readonly partidaTerminadaTtlSegundos?: number;
  readonly partidaChatHistoricoMaximo?: number;
  readonly lobbyRetornoCallbackUrl?: string;
  readonly lobbyDesistenciaCallbackUrl?: string;
  /**
   * Endurecimento do WS (issue #409): allowlist de Origem, teto de payload e
   * rate limit geral por conexão. Quando ausente, `ws.ts` deriva de
   * `getConfig()` (mantém os testes antigos operando com os defaults).
   */
  readonly wsSeguranca?: {
    readonly origensPermitidas: readonly string[];
    readonly maxPayloadBytes: number;
    readonly limiteMensagens: number;
    readonly janelaLimiteMensagensMs: number;
  };
}
