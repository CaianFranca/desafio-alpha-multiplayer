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

/**
 * Duto único de asset com volume (issue #385, follow-up — zera a duplicação
 * dos helpers `tocarAsset*` de `somDoAtaque`/`somDaConquista`/`somDoEncaixe`/
 * `somDeRecusa`).
 *
 * Contrato de volume (ADR-0007): `audio.volume = master × volumeBase`, com
 * master preso a [0, 1] (padrão 1 — sem novo controle de volume). Sem
 * arquivo = no-op silencioso (`new Audio(...)` + `play()` com `catch`,
 * com guarda para o jsdom, que não implementa `play()`). Nunca julga regra,
 * só revela.
 */
export function tocarAsset(caminho: string, volumeBase: number, mestre = 1): void {
  try {
    const audio = new Audio(caminho)
    // Contrato de volume (ADR-0007): base fixa do ponto vezes o mestre
    // (futuro botão de volume), preso a [0, 1].
    const mestrePreso = Math.min(1, Math.max(0, mestre))
    audio.volume = mestrePreso * volumeBase
    const tocando: unknown = audio.play()
    // jsdom não implementa play(): retorna undefined em vez de Promise.
    if (
      typeof tocando === 'object' &&
      tocando !== null &&
      'catch' in tocando &&
      typeof (tocando as { catch: unknown }).catch === 'function'
    ) {
      ;(tocando as Promise<void>).catch(() => {})
    }
  } catch {
    // Sem asset ou autoplay bloqueado: silêncio sem quebrar a Partida.
  }
}
