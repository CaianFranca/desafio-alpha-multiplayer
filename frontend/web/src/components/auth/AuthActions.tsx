import { useContext } from 'react'
import { useAuth } from '../../state/useAuth'
import { SalaWebSocketContext } from '../../state/sala-web-socket-context'
import { CtaLink } from '../ui/CtaLink'

/** Rótulo único da ação de criar sala, compartilhado por cabeçalho e seções. */
export const criarSalaLabel = 'Criar / Entrar na Sala'
/** Rótulo do CTA quando o jogador já está em uma sala (melhor-esforço). */
export const retornarParaSalaLabel = 'Retornar para Sala'

interface AuthActionsProps {
  className?: string
}

export function AuthActions({ className }: AuthActionsProps) {
  const { authState } = useAuth()
  // O provider (SalaWebSocketProvider) normalmente envolve o App; quando
  // renderizado fora dele (ex.: testes com router customizado), o contexto é
  // null e o rótulo cai para o padrão "Criar / Entrar na Sala" (melhor-esforço).
  const value = useContext(SalaWebSocketContext)
  const emSala = value?.sala != null

  if (authState.status === 'authenticated') {
    return (
      <div className={className}>
        <CtaLink to="/salas/criar" variant="primary">{emSala ? retornarParaSalaLabel : criarSalaLabel}</CtaLink>
      </div>
    )
  }

  return (
    <div className={className}>
      <CtaLink to="/cadastro" variant="primary">Criar conta</CtaLink>
      <CtaLink to="/login" variant="secondary">Entrar</CtaLink>
    </div>
  )
}
