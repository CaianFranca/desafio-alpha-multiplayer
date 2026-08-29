import type { CodigoDeSala } from '@flicker/shared'

/** Normaliza e valida um Código de Sala: trim + maiúsculas + exatamente 6 caracteres. */
export function normalizarCodigoDeSala(raw: string): CodigoDeSala | null {
  const codigo = raw.trim().toUpperCase()
  return codigo.length === 6 ? codigo : null
}