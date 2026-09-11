// Serviço periódico de expiração de Cadastros de bot efêmeros (#352).
// "Expiração/purga" aqui é GC de Cadastros com expira_em vencido — não
// confundir com a Limpeza do tabuleiro (ADR-0005, remoção de peças sem
// Iluminação). Nomes seguem o glossário: Cadastro, expiração, purga.
import { pool } from '../config/pg.ts';

const INTERVALO_EXPIRACAO_MS = 60 * 1000; // a cada 1 minuto

export async function purgarBotsExpirados(): Promise<number> {
  try {
    // NOT EXISTS: `salas_historico.anfitriao_id` referencia usuarios sem
    // ON DELETE — um bot que herdou a Anfitria não pode ser deletado (FK).
    // Sem o guarda, uma única linha referenciada aborta o DELETE em lote e
    // bloqueia a purga de TODOS os expirados. Referenciados são pulados aqui
    // (vazam até follow-up) — TODO #352: migração ON DELETE SET NULL p/ anfitriao_id.
    const res = await pool.query(
      `DELETE FROM usuarios
       WHERE bot = true
         AND expira_em IS NOT NULL
         AND expira_em < NOW()
         AND NOT EXISTS (
           SELECT 1 FROM salas_historico WHERE salas_historico.anfitriao_id = usuarios.id
         )`
    );
    const count = res.rowCount ?? 0;
    if (count > 0) {
      console.log(`[expiracao-bots] ${count} bot(s) expirado(s) removido(s) do banco`);
    }
    return count;
  } catch (err) {
    console.error('[expiracao-bots] erro ao purgar bots expirados:', (err as Error).message);
    return 0;
  }
}

// Aliases legados (remover na próxima fatia após atualizar callers externos).
/** @deprecated use purgarBotsExpirados */
export const limparBotsExpirados = purgarBotsExpirados;

export function iniciarServicoDeExpiracaoDeBots(): NodeJS.Timeout {
  // Executa uma vez no início
  void purgarBotsExpirados();
  const timer = setInterval(() => {
    void purgarBotsExpirados();
  }, INTERVALO_EXPIRACAO_MS);
  timer.unref?.();
  return timer;
}

/** @deprecated use iniciarServicoDeExpiracaoDeBots */
export const iniciarServicoDeLimpezaDeBots = iniciarServicoDeExpiracaoDeBots;
