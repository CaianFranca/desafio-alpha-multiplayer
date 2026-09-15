// Parsing de PARTIDA_CHAT_HISTORICO_MAXIMO (follow-up #398/F2, issue #388).
//
// `parsePartidaChatHistoricoMaximo` é privada — exercita-se pela API pública
// `getConfig()` (pura por chamada, sem cache): faixa 1..200, fallback 50.
// `getConfig()` chama `loadEnvFile()`, mas variável já setada vence o `.env`,
// então os casos definidos são determinísticos; o caso ausente cai em 50
// com ou sem `.env` (o `.env.example` fixa `=50`, que coincide com o default).

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getConfig } from '../src/index.ts';

const CHAVE = 'PARTIDA_CHAT_HISTORICO_MAXIMO';

let salvo: string | undefined;
let avisos = 0;
const warnOriginal = console.warn;

function comEnv(valor: string | undefined, fn: () => void): void {
  salvo = process.env[CHAVE];
  avisos = 0;
  console.warn = () => {
    avisos += 1;
  };
  try {
    if (valor === undefined) {
      delete process.env[CHAVE];
    } else {
      process.env[CHAVE] = valor;
    }
    fn();
  } finally {
    console.warn = warnOriginal;
    if (salvo === undefined) {
      delete process.env[CHAVE];
    } else {
      process.env[CHAVE] = salvo;
    }
  }
}

const CASOS: ReadonlyArray<{
  readonly nome: string;
  readonly env: string | undefined;
  readonly esperado: number;
  readonly avisa: boolean;
}> = [
  { nome: 'ausente cai no default 50 sem warn', env: undefined, esperado: 50, avisa: false },
  { nome: 'piso da faixa', env: '1', esperado: 1, avisa: false },
  { nome: 'meio da faixa', env: '50', esperado: 50, avisa: false },
  { nome: 'teto da faixa', env: '200', esperado: 200, avisa: false },
  { nome: 'zero recusa com warn', env: '0', esperado: 50, avisa: true },
  { nome: 'acima do teto recusa com warn', env: '201', esperado: 50, avisa: true },
  { nome: 'não-numérico recusa com warn', env: 'abc', esperado: 50, avisa: true },
  { nome: 'fracionário recusa com warn', env: '1.5', esperado: 50, avisa: true },
  { nome: 'vazio recusa com warn', env: '', esperado: 50, avisa: true },
];

for (const caso of CASOS) {
  test(`PARTIDA_CHAT_HISTORICO_MAXIMO: ${caso.nome}`, () => {
    comEnv(caso.env, () => {
      assert.equal(getConfig().partidaChatHistoricoMaximo, caso.esperado);
      assert.equal(avisos > 0, caso.avisa, `warn esperado=${caso.avisa}`);
    });
  });
}

afterEach(() => {
  console.warn = warnOriginal;
});
