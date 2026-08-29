import type { CodigoDeSala } from '@flicker/shared'

export const CODIGO_DE_SALA_TAMANHO = 6

/** Normaliza e valida um Código de Sala: trim + maiúsculas + exatamente CODIGO_DE_SALA_TAMANHO caracteres. */
export function normalizarCodigoDeSala(raw: string): CodigoDeSala | null {
  const codigo = raw.trim().toUpperCase()
  return codigo.length === CODIGO_DE_SALA_TAMANHO ? codigo : null
}