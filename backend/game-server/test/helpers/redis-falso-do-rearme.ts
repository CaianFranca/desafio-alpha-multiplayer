import type { Redis } from 'ioredis';

// Falso Redis compartilhado dos testes do rearme do não-início (review
// interna #304): SCAN filtra por prefixo e observa os argumentos/chaves.
export interface ObservacaoDoRearme {
  readonly scanArgs?: unknown[][];
  readonly matchUsados?: string[];
  readonly gets?: string[];
}

export function redisFalsoDoRearme(store: Map<string, string>, observacao: ObservacaoDoRearme): Redis {
  return {
    async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      observacao.scanArgs?.push(args);
      const idx = args.indexOf('MATCH');
      const pattern = idx >= 0 ? String(args[idx + 1]) : '*';
      observacao.matchUsados?.push(pattern);
      const prefixo = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      const chaves = [...store.keys()].filter((k) => k.startsWith(prefixo));
      void cursor;
      return ['0', chaves];
    },
    async get(chave: string): Promise<string | null> {
      observacao.gets?.push(chave);
      return store.get(chave) ?? null;
    },
    async ttl(): Promise<number> {
      return 100;
    },
  } as unknown as Redis;
}
