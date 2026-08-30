// Helpers do Encaminhamento para o frontend (issue #45).
// Vocabulário canônico: Encaminhamento, Partida, Alvo da Partida.

export function buildGameWsUrl(serverId: string, partidaId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // O lobby faz proxy de /ws/game/* para o upstream game_servers (SETUP.md).
  // Query carrega partida-id kebab-case conforme backend/game-server/src/ws/ws.ts:74.
  return `${protocol}//${window.location.host}/ws/game/${encodeURIComponent(serverId)}?partida-id=${encodeURIComponent(partidaId)}`
}

export function buildGameRedirectHref(serverId: string, partidaId: string): string {
  // Rota SPA da partida — a PartidaPage abrirá o WS de jogo.
  return `/partida?serverId=${encodeURIComponent(serverId)}&partidaId=${encodeURIComponent(partidaId)}`
}

/** URL legível exibida como alvo do redirect (ex.: wss://host/ws/game/...). */
export function alvoDoRedirectLegivel(serverId: string, partidaId: string): string {
  return buildGameWsUrl(serverId, partidaId)
}

const MENSAGENS_POR_CODIGO: Record<string, string> = {
  ENCAMINHAMENTO_RECUSADO: 'O servidor de jogo recusou a partida. Tente iniciar novamente.',
  ENCAMINHAMENTO_FALHOU: 'Falha ao preparar a partida. Verifique a conexão e tente novamente.',
  ROSTER_INVALIDO: 'A composição da Sala mudou. Confirme que todos estão conectados e prontos.',
  PARTIDA_NAO_ENCONTRADA: 'Partida não encontrada no servidor de jogo.',
  SALA_NAO_ENCONTRADA: 'Sala não encontrada.',
  SALA_ENCERRADA: 'A Sala foi encerrada.',
  DADOS_INVALIDOS: 'Não foi possível iniciar a partida. Verifique os dados e tente novamente.',
}

export function mensagemDeErroDoEncaminhamento(codigo: string | undefined, motivo: string | undefined): string {
  if (codigo !== undefined && MENSAGENS_POR_CODIGO[codigo] !== undefined) return MENSAGENS_POR_CODIGO[codigo]
  if (motivo !== undefined && motivo.trim().length > 0) return motivo
  return 'Falha ao preparar a partida. Tente novamente.'
}
