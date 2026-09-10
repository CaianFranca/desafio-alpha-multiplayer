/**
 * Paleta de cores do PainelDeDepuração (issue #340).
 *
 * Centralizada e ajustável: cores de fonte/tipo e fundos de fase vivem só
 * aqui — trocar a paleta não toca componente. Paleta inicial por spec:
 *   fases: login = azul, registro = verde, sala = amarelo, turnos = 4 tons
 *   (ciano, magenta, laranja, verde-limão)
 *   fontes: erro = vermelho, boundary = vermelho escuro, backend = roxo,
 *   ws→/ws← = cinza; warn = âmbar (nível).
 * O fundo de fase aplica-se a TODAS as fontes (console, ws, backend, fase).
 */

import type { FaseDoDepurador, FonteDoDepurador, NivelDoDepurador } from '../../utils/coletorDeDepuracao'

/** Cor do texto por fonte (nível warn sobrepõe — ver `corDoTexto`). */
export const CORES_DA_FONTE: Record<FonteDoDepurador, string> = {
  console: '#e2e8f0',
  erro: '#ef4444',
  boundary: '#b91c1c',
  'ws→': '#9ca3af',
  'ws←': '#9ca3af',
  backend: '#a78bfa',
  fase: '#67e8f9',
}

/** Cor de texto por nível; null = herda a cor da fonte. */
export const CORES_DO_NIVEL: Record<NivelDoDepurador, string | null> = {
  info: null,
  warn: '#fbbf24',
  error: null,
}

/** Cor da borda esquerda (3px) da entrada: identifica a fonte a um olhar,
 * sem introduzir cores novas — reutiliza a paleta de texto das fontes. */
export function bordaDaFonte(fonte: FonteDoDepurador): string {
  return CORES_DA_FONTE[fonte]
}

/** Fundo histórico por fase (aplicado com transparência — ver FUNDO_DA_FASE). */
export const FUNDO_DA_FASE: Record<FaseDoDepurador, string> = {
  login: '#2563eb',
  registro: '#16a34a',
  sala: '#eab308',
  'turno-1': '#06b6d4',
  'turno-2': '#d946ef',
  'turno-3': '#f97316',
  'turno-4': '#84cc16',
}

/** Cor do texto da entrada: nível warn vence (âmbar), senão a cor da fonte. */
export function corDoTexto(fonte: FonteDoDepurador, nivel: NivelDoDepurador): string {
  const doNivel = CORES_DO_NIVEL[nivel]
  return doNivel ?? CORES_DA_FONTE[fonte]
}

/** Fundo da linha (fase vigente no registro), com transparência para leitura. */
export function fundoDaFase(fase: FaseDoDepurador | null): string | undefined {
  if (fase === null) return undefined
  return `${FUNDO_DA_FASE[fase]}33`
}
