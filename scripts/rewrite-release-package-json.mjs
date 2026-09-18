#!/usr/bin/env node
// rewrite-release-package-json.mjs — reescreve os package.json JÁ COPIADOS no
// staging de release para apontar main/types/exports para dist/ (build tsc).
//
// Uso: node scripts/rewrite-release-package-json.mjs <staging>
//
// Só toca no staging; nunca nos package.json do repositório. Idempotente.
// Sai com código 2 (mensagem clara) se faltar o arg, se algum arquivo não
// existir ou se alguma chave esperada não existir.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fail(message) {
  console.error(`[rewrite-release-package-json] ERRO: ${message}`);
  process.exit(2);
}

const staging = process.argv[2];
if (!staging) {
  fail('falta o diretório de staging (uso: rewrite-release-package-json.mjs <staging>)');
}

const targets = [
  {
    file: 'packages/config/package.json',
    rewrites: [
      [['main'], 'dist/index.js'],
      [['types'], 'dist/index.d.ts'],
    ],
  },
  {
    file: 'packages/shared/package.json',
    rewrites: [
      [['main'], 'dist/index.js'],
      [['types'], 'dist/index.d.ts'],
      [['exports', '.', 'types'], './dist/index.d.ts'],
      [['exports', '.', 'default'], './dist/index.js'],
      [['exports', './server', 'types'], './dist/server.d.ts'],
      [['exports', './server', 'default'], './dist/server.js'],
    ],
  },
  {
    file: 'packages/engine/package.json',
    rewrites: [
      [['main'], 'dist/index.js'],
      [['types'], 'dist/index.d.ts'],
    ],
  },
];

for (const { file, rewrites } of targets) {
  const absolute = join(staging, file);
  if (!existsSync(absolute)) {
    fail(`arquivo não encontrado: ${absolute}`);
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`JSON inválido em ${absolute}: ${error.message}`);
  }

  for (const [path, value] of rewrites) {
    let parent = pkg;
    for (let i = 0; i < path.length - 1; i += 1) {
      parent = parent?.[path[i]];
    }
    const key = path[path.length - 1];
    if (parent === null || typeof parent !== 'object' || !(key in parent)) {
      fail(`chave esperada ausente em ${file}: ${path.join('.')}`);
    }
    parent[key] = value;
  }

  writeFileSync(absolute, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`[rewrite-release-package-json] reescrito ${file}`);
}
