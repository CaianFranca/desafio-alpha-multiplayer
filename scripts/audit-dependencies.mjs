#!/usr/bin/env node
// audit-dependencies.mjs — auditoria de dependências de produção do Flicker.
//
// Roda `npm audit --omit=dev` em cada root npm (raiz/workspaces, db e frontend)
// e REPROVA (exit 1) em vulnerabilidade high/critical sem exceção registrada.
// Exceção só é aceita para advisory SEM correção disponível (fixAvailable
// estritamente false) e exige justificativa em dependency-audit-allowlist.json.
//
// Uso: node scripts/audit-dependencies.mjs [--roots .,db,frontend] [--allowlist <path>]
//   --roots      roots npm relativos à raiz do repo (default: .,db,frontend)
//   --allowlist  caminho da allowlist (default: <repo>/dependency-audit-allowlist.json)
//
// Exit: 0 = sem pendência; 1 = high/critical pendente; 2 = erro operacional/allowlist inválida.
//
// Usado pelo job `quality` do CI (.github/workflows/deploy.yml) em deploys
// normais; o rollback (workflow_dispatch com input `sha`) é isento do gate.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS_PADRAO = ['.', 'db', 'frontend'];
const ALLOWLIST_PADRAO = join(REPO_ROOT, 'dependency-audit-allowlist.json');
const SEVERIDADES_GATE = new Set(['high', 'critical']);

const log = (msg) => console.log(`[audit-deps] ${msg}`);
const warn = (msg) => console.warn(`[audit-deps] AVISO: ${msg}`);
const erro = (msg) => console.error(`[audit-deps] ERRO: ${msg}`);

// Extrai a chave estável de um advisory: GHSA id da url (MAIÚSCULO) ou, na
// ausência dela, o `source` numérico do npm (com aviso — a chave fica frágil).
function extrairChave(advisory) {
  const url = typeof advisory.url === 'string' ? advisory.url : '';
  const ghsa = url.match(/GHSA-[0-9a-z-]+/i);
  if (ghsa) return { chave: ghsa[0].toUpperCase(), aviso: null };
  if (advisory.source !== undefined && advisory.source !== null) {
    return {
      chave: String(advisory.source),
      aviso: `advisory sem GHSA na url (${url || 'url ausente'}); usando source ${advisory.source} como chave`,
    };
  }
  return { chave: null, aviso: `advisory sem GHSA e sem source (${url || 'url ausente'}); ignorado` };
}

// Normaliza a allowlist aceitando tanto o objeto persistido ({ policy, allowlist })
// quanto um array de entradas. A validação de forma é feita em carregarAllowlist.
function normalizarEntradas(allowlist) {
  const lista = Array.isArray(allowlist) ? allowlist : allowlist?.allowlist;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      advisory: typeof e.advisory === 'string' ? e.advisory.trim() : '',
      package: typeof e.package === 'string' ? e.package.trim() : '',
      justification: typeof e.justification === 'string' ? e.justification.trim() : '',
    }))
    .filter((e) => e.advisory);
}

// Função pura: decide o que aprova, o que permite por exceção e o que está
// pendente. Recebe o JSON do `npm audit` (auditReportVersion 2) e a allowlist.
// Entradas não utilizadas são tratadas na CLI (agregação entre roots).
export function avaliarRelatorio(report, allowlist) {
  const pendencias = [];
  const permitidos = [];
  const avisos = [];
  const entradas = normalizarEntradas(allowlist);
  const porAdvisory = new Map(entradas.map((e) => [e.advisory.toUpperCase(), e]));

  const vulnerabilities =
    report && typeof report === 'object' && report.vulnerabilities && typeof report.vulnerabilities === 'object'
      ? report.vulnerabilities
      : {};

  for (const [nomePacote, entrada] of Object.entries(vulnerabilities)) {
    const vias = Array.isArray(entrada?.via) ? entrada.via : [];
    for (const via of vias) {
      // Strings em `via` são dependências indiretas, não advisories.
      if (!via || typeof via !== 'object' || Array.isArray(via)) continue;

      const severidade = String(via.severity ?? entrada?.severity ?? '').toLowerCase();
      if (!SEVERIDADES_GATE.has(severidade)) continue;

      const { chave, aviso } = extrairChave(via);
      if (aviso) avisos.push(`${nomePacote}: ${aviso}`);
      if (!chave) continue;

      const fixAvailable = entrada?.fixAvailable;
      const pendencia = {
        pacote: via.dependency || via.name || nomePacote,
        severidade,
        advisory: chave,
        titulo: via.title || '(sem título)',
        url: via.url || '',
        range: via.range || entrada?.range || '',
        fixAvailable,
      };

      const excecao = porAdvisory.get(chave);
      if (!excecao) {
        pendencias.push({ ...pendencia, motivo: 'sem-excecao' });
      } else if (fixAvailable === false) {
        permitidos.push({ ...pendencia, justificativa: excecao.justification });
      } else {
        pendencias.push({ ...pendencia, motivo: 'com-correcao', justificativa: excecao.justification });
      }
    }
  }

  return { pendencias, permitidos, avisos };
}

// Lê e valida a allowlist. Formato: { policy: <string>, allowlist: [ { advisory,
// package, justification } ] }. advisory e justification não-vazios; qualquer
// desvio lança (a CLI converte em exit 2).
export function carregarAllowlist(caminho) {
  let bruto;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch (e) {
    throw new Error(`não foi possível ler ${caminho}: ${e.message}`);
  }

  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch {
    throw new Error(`JSON inválido em ${caminho}`);
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new Error('a raiz deve ser um objeto { policy, allowlist }');
  }
  if (typeof dados.policy !== 'string' || dados.policy.trim() === '') {
    throw new Error('campo "policy" obrigatório (string não-vazia)');
  }
  if (!Array.isArray(dados.allowlist)) {
    throw new Error('campo "allowlist" deve ser um array');
  }

  const allowlist = dados.allowlist.map((entrada, i) => {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      throw new Error(`allowlist[${i}] deve ser um objeto`);
    }
    const advisory = typeof entrada.advisory === 'string' ? entrada.advisory.trim() : '';
    if (!advisory) throw new Error(`allowlist[${i}].advisory obrigatório (string não-vazia)`);
    const justification = typeof entrada.justification === 'string' ? entrada.justification.trim() : '';
    if (!justification) throw new Error(`allowlist[${i}].justification obrigatório (string não-vazia)`);
    const pacote = typeof entrada.package === 'string' ? entrada.package.trim() : '';
    return { advisory, package: pacote, justification };
  });

  return { policy: dados.policy.trim(), allowlist };
}

function parseArgs(argv) {
  let roots = ROOTS_PADRAO;
  let allowlist = ALLOWLIST_PADRAO;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--roots') {
      const valor = argv[++i];
      if (!valor) throw new Error('--roots exige um valor');
      roots = valor.split(',').map((r) => r.trim()).filter(Boolean);
    } else if (arg === '--allowlist') {
      const valor = argv[++i];
      if (!valor) throw new Error('--allowlist exige um valor');
      allowlist = valor;
    } else {
      throw new Error(`argumento desconhecido: ${arg}`);
    }
  }
  if (roots.length === 0) throw new Error('--roots não pode ser vazio');
  return { roots, allowlist };
}

// Roda `npm audit` em um root. Nunca decide aprovação: devolve { report } ou
// { erro }. Lê o stdout mesmo com exit ≠ 0 (npm sinaliza vulnerabilidade com
// exit 1 e o relatório vem no stdout).
function auditarRoot(rootAbs) {
  log(`auditando ${rootAbs}`);
  const res = spawnSync('npm', ['audit', '--omit=dev', '--package-lock-only', '--json'], {
    cwd: rootAbs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (res.error) return { erro: `falha ao executar npm audit em ${rootAbs}: ${res.error.message}` };

  const stdout = (res.stdout || '').trim();
  if (!stdout) {
    const stderr = (res.stderr || '').trim();
    return { erro: `saída vazia do npm audit em ${rootAbs}${stderr ? ` (stderr: ${stderr})` : ''}` };
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return { erro: `JSON inválido do npm audit em ${rootAbs}` };
  }

  // Formato de erro operacional (ex.: {"error":{"code":"ENOLOCK"}}) — nunca é
  // "há vulnerabilidades", então não pode virar exit 1.
  if (report && typeof report === 'object' && report.error) {
    const { code, summary } = report.error;
    return { erro: `npm audit em ${rootAbs} falhou: ${code || 'erro'}${summary ? ` — ${summary}` : ''}` };
  }

  return { report };
}

function imprimirPendencia(pendencia) {
  console.error(`  - ${pendencia.pacote} (${pendencia.severidade}) ${pendencia.advisory}`);
  console.error(`      título: ${pendencia.titulo}`);
  console.error(`      url: ${pendencia.url || '(sem url)'}`);
  console.error(`      range: ${pendencia.range || '(sem range)'}`);
  console.error(`      fixAvailable: ${JSON.stringify(pendencia.fixAvailable)}`);
  if (pendencia.motivo === 'com-correcao') {
    console.error(
      '      >>> HÁ CORREÇÃO DISPONÍVEL: a allowlist só cobre advisories SEM correção ' +
        '(fixAvailable === false). Corrija a dependência e remova a exceção.',
    );
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    erro(e.message);
    return 2;
  }

  let allowlist;
  try {
    allowlist = carregarAllowlist(args.allowlist);
  } catch (e) {
    erro(`allowlist inválida (${args.allowlist}): ${e.message}`);
    return 2;
  }
  log(`allowlist: ${args.allowlist} (${allowlist.allowlist.length} entrada(s))`);

  const erros = [];
  const pendencias = [];
  const avisos = [];
  const advisoriesTratados = new Set();
  let excecoesAplicadas = 0;

  for (const root of args.roots) {
    const rootAbs = isAbsolute(root) ? root : resolve(REPO_ROOT, root);
    const resultado = auditarRoot(rootAbs);
    if (resultado.erro) {
      erros.push(resultado.erro);
      continue;
    }
    const avaliacao = avaliarRelatorio(resultado.report, allowlist);
    for (const aviso of avaliacao.avisos) avisos.push(`${root}: ${aviso}`);
    for (const item of avaliacao.permitidos) {
      excecoesAplicadas++;
      advisoriesTratados.add(item.advisory.toUpperCase());
      log(`[allow] ${item.advisory} (${item.pacote}) — ${item.justificativa}`);
    }
    for (const item of avaliacao.pendencias) {
      advisoriesTratados.add(item.advisory.toUpperCase());
      pendencias.push({ ...item, root });
    }
  }

  // "Não utilizada" é global: uma exceção vale se casar em QUALQUER root.
  const naoUsados = allowlist.allowlist.filter((e) => !advisoriesTratados.has(e.advisory.toUpperCase()));

  for (const aviso of avisos) warn(aviso);
  for (const item of naoUsados) {
    warn(`entrada da allowlist não utilizada: ${item.advisory}${item.package ? ` (${item.package})` : ''} — remova-a`);
  }

  if (erros.length > 0) {
    for (const e of erros) erro(e);
    erro('auditoria interrompida por erro operacional — pipeline REPROVADO');
    return 2;
  }

  if (pendencias.length > 0) {
    erro('vulnerabilidades de produção high/critical pendentes:');
    for (const p of pendencias) {
      console.error(`[${p.root}]`);
      imprimirPendencia(p);
    }
    erro('pipeline REPROVADO — corrija as dependências ou registre exceção apenas sem correção');
    return 1;
  }

  log(`OK — nenhuma vulnerabilidade high/critical pendente (${excecoesAplicadas} exceção(ões) aplicada(s))`);
  return 0;
}

// Só executa quando chamado direto; `import` apenas expõe as funções puras.
const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDireto) {
  process.exitCode = main();
}
