// Parsing das envs de endurecimento da autenticação HTTP (issue #408).
//
// Os parsers são privados — exercita-se pela API pública `getConfig()` (pura
// por chamada, sem cache). Cada env tem default e faixa próprios; env ausente
// cai silenciosamente no default, env presente e inválida (inclusive vazia)
// cai no default com warn. `getConfig()` chama `loadEnvFile()`, mas variável já
// setada vence o `.env`, então os casos definidos são determinísticos; o caso
// ausente cai no default mesmo que o `.env` local defina a env com o default.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getConfig } from '../src/index.ts';

type Campo =
  | 'trustProxyHops'
  | 'authRateLimitJanelaSegundos'
  | 'authRateLimitMaxPorIp'
  | 'authRateLimitMaxPorConta';

const DESCRITORES: ReadonlyArray<{
  readonly chave: string;
  readonly campo: Campo;
  readonly padrao: number;
  readonly piso: number;
  readonly teto: number;
}> = [
  { chave: 'TRUST_PROXY_HOPS', campo: 'trustProxyHops', padrao: 1, piso: 0, teto: 10 },
  {
    chave: 'AUTH_RATE_LIMIT_JANELA_SEGUNDOS',
    campo: 'authRateLimitJanelaSegundos',
    padrao: 900,
    piso: 1,
    teto: 86400,
  },
  { chave: 'AUTH_RATE_LIMIT_MAX_POR_IP', campo: 'authRateLimitMaxPorIp', padrao: 30, piso: 1, teto: 100000 },
  {
    chave: 'AUTH_RATE_LIMIT_MAX_POR_CONTA',
    campo: 'authRateLimitMaxPorConta',
    padrao: 10,
    piso: 1,
    teto: 100000,
  },
];

let salvo: string | undefined;
let avisos = 0;
const warnOriginal = console.warn;

function comEnv(chave: string, valor: string | undefined, fn: () => void): void {
  salvo = process.env[chave];
  avisos = 0;
  console.warn = () => {
    avisos += 1;
  };
  try {
    if (valor === undefined) {
      delete process.env[chave];
    } else {
      process.env[chave] = valor;
    }
    fn();
  } finally {
    console.warn = warnOriginal;
    if (salvo === undefined) {
      delete process.env[chave];
    } else {
      process.env[chave] = salvo;
    }
  }
}

for (const { chave, campo, padrao, piso, teto } of DESCRITORES) {
  const CASOS: ReadonlyArray<{
    readonly nome: string;
    readonly env: string | undefined;
    readonly esperado: number;
    readonly avisa: boolean;
  }> = [
    { nome: 'ausente cai no default sem warn', env: undefined, esperado: padrao, avisa: false },
    { nome: 'valor válido no default', env: String(padrao), esperado: padrao, avisa: false },
    { nome: 'piso da faixa', env: String(piso), esperado: piso, avisa: false },
    { nome: 'teto da faixa', env: String(teto), esperado: teto, avisa: false },
    { nome: 'abaixo do piso recusa com warn', env: String(piso - 1), esperado: padrao, avisa: true },
    { nome: 'acima do teto recusa com warn', env: String(teto + 1), esperado: padrao, avisa: true },
    { nome: 'não-numérico recusa com warn', env: 'abc', esperado: padrao, avisa: true },
    { nome: 'fracionário recusa com warn', env: '1.5', esperado: padrao, avisa: true },
    { nome: 'vazio recusa com warn', env: '', esperado: padrao, avisa: true },
  ];

  for (const caso of CASOS) {
    test(`${chave}: ${caso.nome}`, () => {
      comEnv(chave, caso.env, () => {
        assert.equal(getConfig()[campo], caso.esperado);
        assert.equal(avisos > 0, caso.avisa, `warn esperado=${caso.avisa}`);
      });
    });
  }
}

afterEach(() => {
  console.warn = warnOriginal;
});
