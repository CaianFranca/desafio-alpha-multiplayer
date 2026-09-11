// API de Bots — POST /api/bots/adicionar no lobby-server.
// Só disponível quando o servidor está rodando com BOTS_HABILITADOS=true.

import { apiFetch } from './client'

export interface BotAdicionado {
  apelido: string
  email: string
  jogadorId: string
}

export type FaseDoBot = 'admitindo' | 'ativo' | 'falhou' | 'encerrado'

export interface EstadoDoBot {
  jogadorId: string
  apelido: string
  salaId: string
  codigoDeSala: string
  fase: FaseDoBot
  codigo?: string
  mensagem?: string
  atualizadoEm: string
}

export class BotIndisponivelError extends Error {
  constructor() {
    super('Bots não disponíveis neste ambiente.')
    this.name = 'BotIndisponivelError'
  }
}

export class BotErroError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'BotErroError'
  }
}

/**
 * Adiciona um bot efêmero à sala atual do Anfitrião.
 * Lança BotIndisponivelError (404) ou BotErroError (outros erros HTTP).
 */
export async function adicionarBot(): Promise<BotAdicionado> {
  const res = await apiFetch('/api/bots/adicionar', { method: 'POST' })

  if (res.status === 404) throw new BotIndisponivelError()

  if (!res.ok) {
    let mensagem = 'Falha ao adicionar bot.'
    try {
      const body = (await res.json()) as { mensagem?: string }
      if (body.mensagem) mensagem = body.mensagem
    } catch {
      // ignora erro de parse
    }
    throw new BotErroError(mensagem)
  }

  return (await res.json()) as BotAdicionado
}

/** Descoberta de feature: evita descobrir o 404 só no clique (#365). */
export async function verificarBotsDisponiveis(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/bots/disponivel')
    return res.ok
  } catch {
    return false
  }
}

/**
 * Status pós-202 para polling (falha de admissão vira `falhou` com
 * codigo/mensagem). 404 = bot desconhecido (restart limpou o estado volátil
 * ou rota desabilitada) — o caller trata como "sem informação".
 */
export async function consultarStatusDoBot(jogadorId: string): Promise<EstadoDoBot | null> {
  const res = await apiFetch(`/api/bots/status/${encodeURIComponent(jogadorId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new BotErroError('Falha ao consultar status do bot.')
  return (await res.json()) as EstadoDoBot
}
