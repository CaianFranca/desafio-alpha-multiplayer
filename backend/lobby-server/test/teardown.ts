// Teardown único dos recursos compartilhados entre os arquivos de teste:
// o singleton `redisClient` (src/config/redis.ts) e o `pool` PG (src/config/pg.ts).
// Os arquivos de teste rodam em paralelo num mesmo processo e compartilham esses
// singletons; fechá-los no `after()` de um arquivo qualquer quebra os demais que
// ainda os usam (e travava o CI). Por isso contamos os arquivos e só encerramos
// quando o ÚLTIMO terminar — independente da ordem ou concorrência do glob.
import { redisClient } from '../src/config/redis.ts';
import { pool } from '../src/config/pg.ts';

let arquivosAtivos = 0;
let encerrado = false;

export function registrarArquivoDeTeste(): void {
  arquivosAtivos += 1;
}

export async function finalizarArquivoDeTeste(): Promise<void> {
  arquivosAtivos -= 1;
  if (arquivosAtivos === 0 && !encerrado) {
    encerrado = true;
    await Promise.allSettled([
      redisClient.quit().catch(() => undefined),
      pool.end().catch(() => undefined),
    ]);
  }
}
