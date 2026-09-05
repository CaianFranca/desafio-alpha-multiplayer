/**
 * Duto de áudio — limpeza com som único (issue #239, spec #238).
 *
 * Sem arquivo = no-op silencioso. O Audio falha em 404 ou por autoplay; o
 * catch silencioso evita throw. Caminho vem dos tokens centralizados
 * (`game/tabuleiro/animacao.ts`), nunca hardcoded no chamador.
 */

export async function tocarSom(caminho: string): Promise<void> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return
  try {
    const audio = new Audio(caminho)
    audio.volume = 0.7
    await audio.play().catch(() => {
      // sem asset ou autoplay bloqueado → silêncio
    })
  } catch {
    // no-op silencioso
  }
}
