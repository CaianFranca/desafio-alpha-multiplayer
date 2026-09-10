// API de Bots — chama POST /api/bots/adicionar no lobby-server.
// Só disponível quando o servidor está rodando com BOTS_HABILITADOS=true.

import { apiFetch } from './client'

export interface BotAdicionado {
  apelido: string
  email: string
  jogadorId: string
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
