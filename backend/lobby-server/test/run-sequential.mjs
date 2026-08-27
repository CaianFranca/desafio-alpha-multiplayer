// Executa os arquivos de teste em processos separados, em ordem, e repassa o
// código de saída. `tsx --test test/*.test.ts` roda os arquivos em paralelo no
// mesmo processo; como eles compartilham o singleton do pool PG, o `TRUNCATE
// ... CASCADE` do salas.integration.test.ts disputa conexões e trava o CI.
// Processos separados isolam o pool e o redisClient,eliminando o deadlock.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const arquivos = readdirSync('test')
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

let falhou = false;
for (const arquivo of arquivos) {
  console.log(`\n=== test/${arquivo} ===`);
  const resultado = spawnSync('npx', ['tsx', '--test', `test/${arquivo}`], {
    stdio: 'inherit',
  });
  if (resultado.status !== 0) falhou = true;
}

process.exit(falhou ? 1 : 0);
