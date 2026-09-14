/**
 * Gate compartilhado refresh-antes-da-reconexão (follow-up PR #383, F1).
 *
 * Partida (`usePartidaWebSocket`) e lobby (`useSalaWebSocket`) repetiam o
 * mesmo esqueleto no `onclose`: inicia o `refreshSession()` de imediato
 * (aproveita a janela de 1s), agenda o timer e só reconecta após o
 * assentamento do slide — sem isso, um refresh lento (>1s) corria contra o
 * timer e o upgrade abria com o cookie expirado (bug da #376). Falha
 * transitória nunca trava a reconexão (melhor esforço) e a guarda
 * `montadoRef` pós-`await` impede Conexão órfã após desmonte.
 */
export const ATRASO_RECONEXAO_APOS_QUEDA_MS = 1000

export function agendarReconexaoComSlide(
  timerRef: { current: number | null },
  montadoRef: { current: boolean },
  slide: Promise<unknown>,
  reconectar: () => void,
  atrasoMs = ATRASO_RECONEXAO_APOS_QUEDA_MS,
): void {
  if (timerRef.current !== null) return
  timerRef.current = window.setTimeout(() => {
    timerRef.current = null
    void (async () => {
      try {
        await slide
      } catch {
        // melhor esforço: mesmo com refresh falho, tenta reconectar.
      }
      if (!montadoRef.current) return
      reconectar()
    })()
  }, atrasoMs)
}
