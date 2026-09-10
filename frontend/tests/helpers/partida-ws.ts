import { waitFor } from '@testing-library/react'
import { MockWebSocket } from './mockWebSocket'

/** Conecta o socket da Partida e aguarda a abertura (padrão comum dos testes de partida). */
export async function conectarSocketDaPartida(): Promise<MockWebSocket> {
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  return MockWebSocket.last()!
}
