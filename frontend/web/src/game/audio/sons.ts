/**
 * Duto de áudio da Partida — ponto único de asset com volume (issue #385,
 * follow-up — zera a duplicação dos helpers `tocarAsset*` de
 * `somDoAtaque`/`somDaConquista`/`somDoEncaixe`/`somDeRecusa`; issue #438
 * removeu o duto antigo de volume fixo `tocarSom`).
 *
 * Contrato de volume (ADR-0007 + issue #438): `audio.volume = camada ×
 * volumeBase`, com a camada (`volumesDasCamadas.ts`) presa a [0, 1] pelo
 * chamador no momento do toque (slider do modal de volume). Sem arquivo =
 * no-op silencioso (`new Audio(...)` + `play()` com `catch`, com guarda para
 * o jsdom, que não implementa `play()`). Nunca julga regra, só revela.
 */
export function tocarAsset(caminho: string, volumeBase: number, mestre = 1): void {
  try {
    const audio = new Audio(caminho)
    // Contrato de volume (ADR-0007 + issue #438): base fixa do ponto vezes a
    // camada (o chamador lê `volumesDasCamadas.ts` no momento do toque),
    // presa a [0, 1].
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
