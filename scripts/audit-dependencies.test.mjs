// Testes das funções puras da auditoria de dependências (#417).
//
// O script só expõe as funções puras via `import` (a execução direta é
// detectada por `foiExecutadoDireto`), então aqui não se toca rede/registry:
// exercita-se `extrairChave`, `avaliarRelatorio`, `carregarAllowlist` e
// `deduplicar` com relatórios sintéticos no formato do `npm audit --json`.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { avaliarRelatorio, carregarAllowlist, deduplicar, extrairChave } from './audit-dependencies.mjs';

const URL_GHSA = 'https://github.com/advisories/GHSA-abcd-1234-wxyz';
const CHAVE_GHSA = 'GHSA-ABCD-1234-WXYZ';

const viaBase = {
  source: 1098391,
  name: 'lodash',
  dependency: 'lodash',
  severity: 'high',
  url: URL_GHSA,
  title: 'Prototype Pollution in lodash',
  range: '<4.17.21',
};

function relatorio(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities };
}

function allowlistCom(entradas) {
  return { policy: 'policy de teste', allowlist: entradas };
}

const dirTemp = mkdtempSync(join(tmpdir(), 'audit-deps-test-'));
after(() => rmSync(dirTemp, { recursive: true, force: true }));

function arquivoTemp(nome, conteudo) {
  const caminho = join(dirTemp, nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

// --- extrairChave -----------------------------------------------------------

test('extrairChave: extrai o GHSA da url em maiúsculo', () => {
  const { chave, aviso } = extrairChave({ url: URL_GHSA, source: 1098391 });
  assert.equal(chave, CHAVE_GHSA);
  assert.equal(aviso, null);
});

test('extrairChave: url sem GHSA cai no source numérico com aviso', () => {
  const { chave, aviso } = extrairChave({ url: 'https://example.test/advisories/1', source: 42 });
  assert.equal(chave, '42');
  assert.match(aviso, /source 42/);
});

test('extrairChave: sem GHSA e sem source devolve chave null com aviso', () => {
  const { chave, aviso } = extrairChave({ url: 'https://example.test/advisories/1' });
  assert.equal(chave, null);
  assert.match(aviso, /sem GHSA e sem source/);
});

test('extrairChave: regex estrita não casa GHSA com segmentos curtos', () => {
  const { chave } = extrairChave({
    url: 'https://example.test/GHSA-abc-def-ghi',
    source: 7,
  });
  assert.equal(chave, '7');
});

// --- avaliarRelatorio -------------------------------------------------------

test('avaliarRelatorio: severidade moderate é ignorada', () => {
  const report = relatorio({
    lodash: { severity: 'moderate', fixAvailable: true, via: [{ ...viaBase, severity: 'moderate' }] },
  });
  const { pendencias, permitidos } = avaliarRelatorio(report, allowlistCom([]));
  assert.equal(pendencias.length, 0);
  assert.equal(permitidos.length, 0);
});

test('avaliarRelatorio: high sem exceção vira pendência sem-excecao', () => {
  const report = relatorio({
    lodash: { severity: 'high', fixAvailable: true, via: [viaBase] },
  });
  const { pendencias } = avaliarRelatorio(report, allowlistCom([]));
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].motivo, 'sem-excecao');
  assert.equal(pendencias[0].advisory, CHAVE_GHSA);
});

test('avaliarRelatorio: high com exceção mas fixAvailable true vira pendência com-correcao', () => {
  const report = relatorio({
    lodash: { severity: 'high', fixAvailable: true, via: [viaBase] },
  });
  const allowlist = allowlistCom([
    { advisory: CHAVE_GHSA, package: 'lodash', justification: 'risco aceito' },
  ]);
  const { pendencias, permitidos } = avaliarRelatorio(report, allowlist);
  assert.equal(permitidos.length, 0);
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].motivo, 'com-correcao');
});

test('avaliarRelatorio: high com exceção e fixAvailable false é permitido', () => {
  const report = relatorio({
    lodash: { severity: 'high', fixAvailable: false, via: [viaBase] },
  });
  const allowlist = allowlistCom([
    { advisory: CHAVE_GHSA, package: 'lodash', justification: 'risco aceito' },
  ]);
  const { pendencias, permitidos } = avaliarRelatorio(report, allowlist);
  assert.equal(pendencias.length, 0);
  assert.equal(permitidos.length, 1);
  assert.equal(permitidos[0].justificativa, 'risco aceito');
});

test('avaliarRelatorio: mesmo GHSA em 2 pacotes vira 1 pendência com 2 pacotes', () => {
  const report = relatorio({
    'pkg-a': { severity: 'high', fixAvailable: true, via: [{ ...viaBase, dependency: 'dep-a' }] },
    'pkg-b': { severity: 'high', fixAvailable: true, via: [{ ...viaBase, dependency: 'dep-b' }] },
  });
  const { pendencias } = avaliarRelatorio(report, allowlistCom([]));
  assert.equal(pendencias.length, 1);
  assert.deepEqual(pendencias[0].pacotes, ['dep-a', 'dep-b']);
});

test('avaliarRelatorio: package divergente na allowlist gera aviso (não erro)', () => {
  const report = relatorio({
    lodash: { severity: 'high', fixAvailable: false, via: [viaBase] },
  });
  const allowlist = allowlistCom([
    { advisory: CHAVE_GHSA, package: 'outro-pacote', justification: 'risco aceito' },
  ]);
  const { permitidos, avisos } = avaliarRelatorio(report, allowlist);
  assert.equal(permitidos.length, 1);
  assert.ok(avisos.some((a) => a.includes('declara package "outro-pacote"')));
});

// --- carregarAllowlist ------------------------------------------------------

test('carregarAllowlist: arquivo válido é lido e normalizado', () => {
  const caminho = arquivoTemp(
    'ok.json',
    JSON.stringify({
      policy: 'política',
      allowlist: [{ advisory: CHAVE_GHSA, package: 'lodash', justification: 'motivo' }],
    }),
  );
  const { policy, allowlist } = carregarAllowlist(caminho);
  assert.equal(policy, 'política');
  assert.equal(allowlist.length, 1);
  assert.deepEqual(allowlist[0], { advisory: CHAVE_GHSA, package: 'lodash', justification: 'motivo' });
});

test('carregarAllowlist: JSON inválido lança', () => {
  const caminho = arquivoTemp('invalido.json', '{ não é json');
  assert.throws(() => carregarAllowlist(caminho), /JSON inválido/);
});

test('carregarAllowlist: sem policy lança', () => {
  const caminho = arquivoTemp('sem-policy.json', JSON.stringify({ allowlist: [] }));
  assert.throws(() => carregarAllowlist(caminho), /policy/);
});

test('carregarAllowlist: entrada sem justification lança', () => {
  const caminho = arquivoTemp(
    'sem-justificativa.json',
    JSON.stringify({ policy: 'p', allowlist: [{ advisory: CHAVE_GHSA }] }),
  );
  assert.throws(() => carregarAllowlist(caminho), /justification/);
});

// --- deduplicar -------------------------------------------------------------

test('deduplicar: funde itens da mesma chave acumulando pacotes', () => {
  const itens = [
    { advisory: 'A', pacote: 'p1', outro: 1 },
    { advisory: 'A', pacote: 'p2', outro: 2 },
    { advisory: 'B', pacote: 'p3', outro: 3 },
  ];
  const dedup = deduplicar(itens, (i) => i.advisory);
  assert.equal(dedup.length, 2);
  assert.deepEqual(dedup[0].pacotes, ['p1', 'p2']);
  assert.deepEqual(dedup[1].pacotes, ['p3']);
});

test('deduplicar: preserva pacotes já acumulados (segunda passada)', () => {
  const itens = [
    { advisory: 'A', pacotes: ['p1', 'p2'] },
    { advisory: 'A', pacote: 'p3' },
  ];
  const dedup = deduplicar(itens, (i) => i.advisory);
  assert.equal(dedup.length, 1);
  assert.deepEqual(dedup[0].pacotes, ['p1', 'p2', 'p3']);
});
