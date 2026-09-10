// Serviço periódico de limpeza de contas bot efêmeras expiradas (Fase 1).
import { pool } from '../config/pg.ts';

const INTERVALO_LIMPEZA_MS = 60 * 1000; // a cada 1 minuto

export async function limparBotsExpirados(): Promise<number> {
  try {
    const res = await pool.query(
      `DELETE FROM usuarios
       WHERE bot = true
         AND expira_em IS NOT NULL
         AND expira_em < NOW()`
    );
    const count = res.rowCount ?? 0;
    if (count > 0) {
      console.log(`[limpeza-bots] ${count} bot(s) expirado(s) removido(s) do banco`);
    }
    return count;
  } catch (err) {
    console.error('[limpeza-bots] erro ao limpar bots expirados:', (err as Error).message);
    return 0;
  }
}

export function iniciarServicoDeLimpezaDeBots(): NodeJS.Timeout {
  // Executa uma vez no início
  void limparBotsExpirados();
  const timer = setInterval(() => {
    void limparBotsExpirados();
  }, INTERVALO_LIMPEZA_MS);
  timer.unref?.();
  return timer;
}
