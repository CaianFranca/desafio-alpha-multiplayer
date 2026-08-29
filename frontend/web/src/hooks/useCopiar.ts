import { useCallback, useState } from 'react'

export function useCopiar(timeoutMs = 2000) {
  const [copiado, setCopiado] = useState(false)

  const copiar = useCallback(
    async (texto: string) => {
      try {
        await navigator.clipboard.writeText(texto)
        setCopiado(true)
        window.setTimeout(() => setCopiado(false), timeoutMs)
        return true
      } catch {
        return false
      }
    },
    [timeoutMs],
  )

  return { copiado, copiar }
}
