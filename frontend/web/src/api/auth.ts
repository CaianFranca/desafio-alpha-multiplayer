export interface Jogador {
  id: string
  apelido: string
  email: string
}

export type ResultadoJogador =
  | { ok: true; jogador: Jogador }
  | { ok: false; motivo: 'sessao-invalida' | 'falha-desconhecida' }

/** GET /api/auth/me — reidrata o Jogador da Sessão ativa (contrato OpenAPI). */
export async function obterJogadorAutenticado(): Promise<ResultadoJogador> {
  let resposta: Response
  try {
    resposta = await fetch('/api/auth/me', { credentials: 'include' })
  } catch {
    return { ok: false, motivo: 'falha-desconhecida' }
  }
  if (resposta.status === 401) return { ok: false, motivo: 'sessao-invalida' }
  if (!resposta.ok) return { ok: false, motivo: 'falha-desconhecida' }
  const jogador = (await resposta.json()) as Jogador
  return { ok: true, jogador }
}

/** POST /api/auth/logout — melhor esforço: o estado local volta a Visitante independentemente do resultado. */
export async function encerrarSessao(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    // melhor esforço
  }
}
