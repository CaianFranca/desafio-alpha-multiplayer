// Parsing da config de endurecimento do WS (issue #409), no estilo de
// partida-chat-historico-maximo.test.ts.
//
// `getConfig()` é pura por chamada e env definida vence o `.env`, então os
// casos definidos são determinísticos; env ausente cai no default.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getConfig } from '../src/index.ts';

const warnOriginal = console.warn;

let avisos = 0;

function comEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const salvo = new Map<string, string | undefined>();
  avisos = 0;
  console.warn = () => {
    avisos += 1;
  };
  try {
    for (const [chave, valor] of Object.entries(vars)) {
      salvo.set(chave, process.env[chave]);
      if (valor === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = valor;
      }
    }
    fn();
  } finally {
    console.warn = warnOriginal;
    for (const [chave, valor] of salvo) {
      if (valor === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = valor;
      }
    }
  }
}

type CampoNumericoWs = 'wsMaxPayloadBytes' | 'wsLimiteMensagens' | 'wsJanelaLimiteMensagensMs' | 'wsSessaoRevalidacaoMs';

const CASOS_NUMERICOS: ReadonlyArray<{
  readonly nome: string;
  readonly chave: string;
  readonly campo: CampoNumericoWs;
  readonly env: string | undefined;
  readonly esperado: number;
  readonly avisa: boolean;
}> = [
  { nome: 'WS_MAX_PAYLOAD_BYTES ausente cai no default 65536', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: undefined, esperado: 65536, avisa: false },
  { nome: 'WS_MAX_PAYLOAD_BYTES piso', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '1024', esperado: 1024, avisa: false },
  { nome: 'WS_MAX_PAYLOAD_BYTES teto', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '1048576', esperado: 1048576, avisa: false },
  { nome: 'WS_MAX_PAYLOAD_BYTES zero recusa com warn', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '0', esperado: 65536, avisa: true },
  { nome: 'WS_MAX_PAYLOAD_BYTES acima do teto recusa com warn', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '1048577', esperado: 65536, avisa: true },
  { nome: 'WS_MAX_PAYLOAD_BYTES não-numérico recusa com warn', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: 'abc', esperado: 65536, avisa: true },
  { nome: 'WS_MAX_PAYLOAD_BYTES fracionário recusa com warn', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '1.5', esperado: 65536, avisa: true },
  { nome: 'WS_MAX_PAYLOAD_BYTES vazio recusa com warn', chave: 'WS_MAX_PAYLOAD_BYTES', campo: 'wsMaxPayloadBytes', env: '', esperado: 65536, avisa: true },
  { nome: 'WS_LIMITE_MENSAGENS ausente cai no default 100', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: undefined, esperado: 100, avisa: false },
  { nome: 'WS_LIMITE_MENSAGENS piso', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '1', esperado: 1, avisa: false },
  { nome: 'WS_LIMITE_MENSAGENS teto', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '10000', esperado: 10000, avisa: false },
  { nome: 'WS_LIMITE_MENSAGENS zero recusa com warn', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '0', esperado: 100, avisa: true },
  { nome: 'WS_LIMITE_MENSAGENS acima do teto recusa com warn', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '10001', esperado: 100, avisa: true },
  { nome: 'WS_LIMITE_MENSAGENS não-numérico recusa com warn', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: 'abc', esperado: 100, avisa: true },
  { nome: 'WS_LIMITE_MENSAGENS fracionário recusa com warn', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '1.5', esperado: 100, avisa: true },
  { nome: 'WS_LIMITE_MENSAGENS vazio recusa com warn', chave: 'WS_LIMITE_MENSAGENS', campo: 'wsLimiteMensagens', env: '', esperado: 100, avisa: true },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS ausente cai no default 10000', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: undefined, esperado: 10000, avisa: false },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS piso', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '100', esperado: 100, avisa: false },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS teto', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '600000', esperado: 600000, avisa: false },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS zero recusa com warn', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '0', esperado: 10000, avisa: true },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS acima do teto recusa com warn', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '600001', esperado: 10000, avisa: true },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS não-numérico recusa com warn', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: 'abc', esperado: 10000, avisa: true },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS fracionário recusa com warn', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '1.5', esperado: 10000, avisa: true },
  { nome: 'WS_JANELA_LIMITE_MENSAGENS_MS vazio recusa com warn', chave: 'WS_JANELA_LIMITE_MENSAGENS_MS', campo: 'wsJanelaLimiteMensagensMs', env: '', esperado: 10000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS ausente cai no default 30000', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: undefined, esperado: 30000, avisa: false },
  { nome: 'WS_SESSAO_REVALIDACAO_MS piso', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '1000', esperado: 1000, avisa: false },
  { nome: 'WS_SESSAO_REVALIDACAO_MS teto', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '60000', esperado: 60000, avisa: false },
  { nome: 'WS_SESSAO_REVALIDACAO_MS zero recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '0', esperado: 30000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS acima do teto recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '60001', esperado: 30000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS antigo teto 300000 agora recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '300000', esperado: 30000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS não-numérico recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: 'abc', esperado: 30000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS fracionário recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '1.5', esperado: 30000, avisa: true },
  { nome: 'WS_SESSAO_REVALIDACAO_MS vazio recusa com warn', chave: 'WS_SESSAO_REVALIDACAO_MS', campo: 'wsSessaoRevalidacaoMs', env: '', esperado: 30000, avisa: true },
];

for (const caso of CASOS_NUMERICOS) {
  test(caso.nome, () => {
    comEnv({ [caso.chave]: caso.env }, () => {
      assert.equal(getConfig()[caso.campo], caso.esperado);
      assert.equal(avisos > 0, caso.avisa, `warn esperado=${caso.avisa}`);
    });
  });
}

test('WS_ORIGENS_PERMITIDAS sem env deriva o origin da URL pública (ignora subpath)', () => {
  comEnv(
    { WS_ORIGENS_PERMITIDAS: undefined, LOBBY_PUBLIC_URL: 'https://host/server01', NODE_ENV: undefined },
    () => {
      const origens = getConfig().wsOrigensPermitidas;
      assert.ok(origens.includes('https://host'));
      assert.ok(!origens.includes('https://host/server01'));
    },
  );
});

test('WS_ORIGENS_PERMITIDAS sem env inclui o Vite local fora de produção', () => {
  comEnv(
    { WS_ORIGENS_PERMITIDAS: undefined, LOBBY_PUBLIC_URL: 'https://host', NODE_ENV: undefined },
    () => {
      const origens = getConfig().wsOrigensPermitidas;
      assert.ok(origens.includes('http://localhost:5173'));
      assert.ok(origens.includes('http://127.0.0.1:5173'));
    },
  );
});

test('WS_ORIGENS_PERMITIDAS sem env em produção não inclui o Vite local', () => {
  comEnv(
    {
      WS_ORIGENS_PERMITIDAS: undefined,
      LOBBY_PUBLIC_URL: 'https://host/server01',
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-jwt-secret',
      JWT_REFRESH_SECRET: 'prod-jwt-refresh-secret',
      POSTGRES_PASSWORD: 'prod-postgres-password',
      TRUST_PROXY_HOPS: '3',
    },
    () => {
      assert.deepEqual(getConfig().wsOrigensPermitidas, ['https://host']);
    },
  );
});

test('WS_ORIGENS_PERMITIDAS explícita usa exatamente as origens com trim e dedup', () => {
  comEnv(
    {
      WS_ORIGENS_PERMITIDAS: 'https://a.com, https://b.com/ ,https://a.com',
      LOBBY_PUBLIC_URL: 'https://host',
      NODE_ENV: undefined,
    },
    () => {
      assert.deepEqual(getConfig().wsOrigensPermitidas, ['https://a.com', 'https://b.com']);
    },
  );
});

const ORIGENS_INVALIDAS: ReadonlyArray<{ readonly nome: string; readonly env: string }> = [
  { nome: 'wildcard', env: 'https://*.a.com' },
  { nome: 'sem protocolo', env: 'a.com' },
  { nome: 'com path', env: 'https://a.com/ws' },
];

for (const caso of ORIGENS_INVALIDAS) {
  test(`WS_ORIGENS_PERMITIDAS rejeita origem inválida: ${caso.nome}`, () => {
    comEnv(
      { WS_ORIGENS_PERMITIDAS: caso.env, LOBBY_PUBLIC_URL: 'https://host', NODE_ENV: undefined },
      () => {
        assert.throws(() => getConfig(), /WS_ORIGENS_PERMITIDAS/);
      },
    );
  });
}

afterEach(() => {
  console.warn = warnOriginal;
});
