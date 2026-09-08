// Cliente de callback de retorno ao lobby (issue #177, ADR-0006).
//
// Disparado uma vez por término (evento `partida_terminada`), entrega ao lobby
// o resultado e os jogadores para reabertura da sala. Espelho do fetch
// injetável do lobby (`ofertarEncaminhamento`): o `fetch` vem do contexto e
// nos testes aponta para um fake HTTP server. Retentativa contínua com backoff
// crescente (cap 30s) até o lobby aceitar.

import { assinarServiceToken } from '@flicker/config';
const BACKOFF_INICIAL_MS_DEFAULT = 1000;
const BACKOFF_CAP_MS = 30000;
const TIMEOUT_DA_TENTATIVA_MS_DEFAULT = 5000;

export interface AvisoDeRetorno {
  readonly salaId: string;
  readonly partidaId: string;
  readonly serverId: string;
  readonly resultado: 'vitoria' | 'derrota' | 'nao-inicio';
  readonly jogadores: readonly string[];
}

export interface RetornoClienteConfig {
  readonly lobbyRetornoCallbackUrl: string;
  readonly jwtSecret: string;
  /** Injetável nos testes — default é o fetch global. */
  readonly buscarHttp?: typeof fetch;
  /** Delay inicial do backoff em ms — injetável para testes rápidos. */
  readonly backoffInicialMs?: number;
  readonly capMs?: number;
  /** Timeout de cada request — evita uma tentativa presa indefinidamente. */
  readonly timeoutMs?: number;
  /** Injetável nos testes para tornar Retry-After determinístico. */
  readonly sleep?: (ms: number) => Promise<void>;
}

function ehRetentavel(status: number, codigo: unknown): boolean {
  if (status === 408 || status === 429) return true;
  if (status === 503) return true;
  if (status === 409 && codigo === 'SALA_INCONSISTENTE') return true;
  if (status >= 500) return true;
  return false;
}

export function extrairRetryAfterMs(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined;
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const segundos = Number(raw.trim());
  if (Number.isFinite(segundos) && segundos >= 0) {
    return segundos * 1000;
  }
  const data = Date.parse(raw);
  if (Number.isFinite(data)) {
    const diff = data - Date.now();
    return diff > 0 ? diff : 0;
  }
  return undefined;
}

export function criarClienteDeRetorno(config: RetornoClienteConfig): (aviso: AvisoDeRetorno) => Promise<void> {
  const buscarHttp = config.buscarHttp ?? fetch;
  const backoffInicialMs = config.backoffInicialMs ?? BACKOFF_INICIAL_MS_DEFAULT;
  const capMs = config.capMs ?? BACKOFF_CAP_MS;
  const timeoutMs = config.timeoutMs ?? TIMEOUT_DA_TENTATIVA_MS_DEFAULT;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); }));

  return async (aviso: AvisoDeRetorno): Promise<void> => {
    const payload = {
      salaId: aviso.salaId,
      partidaId: aviso.partidaId,
      serverId: aviso.serverId,
      resultado: aviso.resultado,
      jogadores: [...aviso.jogadores],
    };

    let tentativa = 0;

    while (true) {
      tentativa += 1;
      const token = assinarServiceToken(config.jwtSecret);
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const resposta = await buscarHttp(config.lobbyRetornoCallbackUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        if (resposta.ok) {
          console.info('[retorno] callback aceito', {
            salaId: aviso.salaId,
            partidaId: aviso.partidaId,
            resultado: aviso.resultado,
            tentativa,
          });
          return;
        }

        let codigo: unknown;
        try {
          const corpo = (await resposta.json()) as { codigo?: unknown };
          codigo = corpo.codigo;
        } catch {
          codigo = undefined;
        }

        if (ehRetentavel(resposta.status, codigo)) {
          const retryAfterMs = extrairRetryAfterMs(resposta.headers);
          console.warn('[retorno] falha retentável, reagendando', {
            salaId: aviso.salaId,
            status: resposta.status,
            codigo,
            tentativa,
            retryAfterMs,
          });
          const backoffMs = Math.min(backoffInicialMs * 2 ** (tentativa - 1), capMs);
          const delayMs = retryAfterMs !== undefined ? Math.min(Math.max(backoffMs, retryAfterMs), capMs) : backoffMs;
          await sleep(delayMs);
          continue;
        } else {
          console.error('[retorno] rejeição definitiva, interrompendo retry', {
            salaId: aviso.salaId,
            partidaId: aviso.partidaId,
            status: resposta.status,
            codigo,
            tentativa,
          });
          return;
        }
      } catch (erro) {
        console.warn('[retorno] erro de rede, reagendando', {
          salaId: aviso.salaId,
          tentativa,
          erro: (erro as Error).message,
        });
      } finally {
        clearTimeout(timeout);
      }

      const delayMs = Math.min(backoffInicialMs * 2 ** (tentativa - 1), capMs);
      await sleep(delayMs);
    }
  };
}
