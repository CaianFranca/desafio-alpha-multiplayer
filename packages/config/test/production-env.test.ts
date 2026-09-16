// Fail-fast de configuração em produção: TRUST_PROXY_HOPS precisa ser explícita
// e válida — sem valor o rate limit por IP de auth vira bucket global e o erro
// passaria silencioso no boot.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_REDIS_PASSWORD, getConfig } from '../src/index.ts';

const CHAVES = [
  'NODE_ENV',
  'TRUST_PROXY_HOPS',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'POSTGRES_PASSWORD',
  'LOBBY_PUBLIC_URL',
  'REDIS_PASSWORD',
] as const;

let salvo = new Map<string, string | undefined>();

function comProducao(trustProxy: string | undefined, fn: () => void): void {
  salvo = new Map();
  for (const chave of CHAVES) {
    salvo.set(chave, process.env[chave]);
  }
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'prod_jwt_secret_test';
  process.env.JWT_REFRESH_SECRET = 'prod_jwt_refresh_secret_test';
  process.env.POSTGRES_PASSWORD = 'prod_pg_password_test';
  process.env.REDIS_PASSWORD = 'prod_redis_password_test';
  process.env.LOBBY_PUBLIC_URL = 'https://exemplo.teste';
  if (trustProxy === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = trustProxy;
  }
  fn();
}

afterEach(() => {
  for (const [chave, valor] of salvo) {
    if (valor === undefined) {
      delete process.env[chave];
    } else {
      process.env[chave] = valor;
    }
  }
  salvo = new Map();
});

test('produção: TRUST_PROXY_HOPS ausente lança no boot', () => {
  comProducao(undefined, () => {
    assert.throws(() => getConfig(), /TRUST_PROXY_HOPS/);
  });
});

test('produção: TRUST_PROXY_HOPS vazia lança no boot', () => {
  comProducao('', () => {
    assert.throws(() => getConfig(), /TRUST_PROXY_HOPS/);
  });
});

test('produção: TRUST_PROXY_HOPS não-inteira lança no boot', () => {
  comProducao('abc', () => {
    assert.throws(() => getConfig(), /TRUST_PROXY_HOPS/);
  });
});

test('produção: TRUST_PROXY_HOPS fora da faixa lança no boot', () => {
  comProducao('99', () => {
    assert.throws(() => getConfig(), /TRUST_PROXY_HOPS/);
  });
});

test('produção: TRUST_PROXY_HOPS válida é aceita', () => {
  comProducao('3', () => {
    assert.equal(getConfig().trustProxyHops, 3);
  });
});

test('produção: REDIS_PASSWORD ausente lança no boot', () => {
  comProducao('3', () => {
    delete process.env.REDIS_PASSWORD;
    assert.throws(() => getConfig(), /REDIS_PASSWORD/);
  });
});

test('produção: REDIS_PASSWORD com default de dev lança no boot', () => {
  comProducao('3', () => {
    process.env.REDIS_PASSWORD = DEFAULT_REDIS_PASSWORD;
    assert.throws(() => getConfig(), /REDIS_PASSWORD/);
  });
});

test('produção: REDIS_PASSWORD válida é aceita', () => {
  comProducao('3', () => {
    process.env.REDIS_PASSWORD = 'prod_redis_segura_123';
    assert.equal(getConfig().redis.password, 'prod_redis_segura_123');
  });
});

test('produção: REDIS_PASSWORD com espaços/newline é trimada', () => {
  comProducao('3', () => {
    process.env.REDIS_PASSWORD = '  prod_redis_segura_123 \n';
    assert.equal(getConfig().redis.password, 'prod_redis_segura_123');
  });
});

test('produção: REDIS_PASSWORD só espaços/newline lança no boot', () => {
  comProducao('3', () => {
    process.env.REDIS_PASSWORD = '  \n  ';
    assert.throws(() => getConfig(), /REDIS_PASSWORD/);
  });
});
