import { act, waitFor } from '@testing-library/react'
import { MockWebSocket } from './mockWebSocket'

/** Conecta o socket da Partida e aguarda a abertura (padrão comum dos testes de partida). */
export async function conectarSocketDaPartida(): Promise<MockWebSocket> {
  await waitFor(() => expect(MockWebSocket.last()).toBeDefined())
  return MockWebSocket.last()!
}

/**
 * Envia um lote de eventos do wire na ordem dada, com flush assíncrono do
 * batch atômico (ADR-0013: TURNO_INICIADO e cia. coalescem via queueMicrotask
 * e exigem `await act(async ...)` — o `act` síncrono retorna antes do flush
 * e o assert seguinte lê estado parcial).
 *
 * Use para o lote de turno/desistência; para deltas avulsos fora do lote
 * (PECA_POSICIONADA, PEAO_*, etc., que despacham de imediato) prefira o `act`
 * síncrono. Nunca misture lote + não-lote na mesma chamada: isole o TURNO
 * num `enviarLote` e os deltas noutro — no mesmo `act` os deltas
 * ultrapassariam o TURNO ainda na fila (reordena).
 */
export async function enviarLote(ws: MockWebSocket, ...eventos: unknown[]): Promise<void> {
  await act(async () => {
    for (const evento of eventos) {
      ws.simulateMessage(evento)
    }
  })
}
