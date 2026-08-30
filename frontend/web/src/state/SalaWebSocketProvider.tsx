import { useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { useSalaWebSocket } from '../hooks/useSalaWebSocket'
import { ModalDeExpulsao } from '../components/sala/ModalDeExpulsao'
import { SalaWebSocketContext } from './sala-web-socket-context'

interface SalaWebSocketProviderProps {
  children: ReactNode
}

/**
 * Eleva o WebSocket da sala para o nível do App: o Header e as páginas
 * compartilham o mesmo estado "em sala" sem depender de um registro vindo da
 * página. A conexão é condicionada à autenticação (jogadorId presente).
 */
export function SalaWebSocketProvider({ children }: SalaWebSocketProviderProps) {
  const { authState } = useAuth()
  const jogadorId = authState.status === 'authenticated' ? authState.jogador.id : undefined
  const valor = useSalaWebSocket(jogadorId)
  const navigate = useNavigate()

  const fecharExpulsao = useCallback(() => {
    valor.descartarExpulsao()
    navigate('/salas/criar')
  }, [valor, navigate])

  return (
    <SalaWebSocketContext.Provider value={valor}>
      {children}
      {valor.expulso && <ModalDeExpulsao onOk={fecharExpulsao} />}
    </SalaWebSocketContext.Provider>
  )
}
