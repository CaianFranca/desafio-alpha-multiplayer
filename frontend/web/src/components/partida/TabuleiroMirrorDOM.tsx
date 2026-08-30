import { chaveCelula } from '../../game/tabuleiro/contrato'
import type { Celula, PecaDaReserva, PecaPosicionada } from '../../game/tabuleiro/contrato'

interface TabuleiroMirrorDOMProps {
  todasCelulas: readonly Celula[]
  ocupadasSet: ReadonlySet<string>
  reserva: readonly PecaDaReserva[]
  posicionadas: readonly PecaPosicionada[]
}

export function TabuleiroMirrorDOM({
  todasCelulas,
  ocupadasSet,
  reserva,
  posicionadas,
}: TabuleiroMirrorDOMProps) {
  return (
    <div data-testid="tabuleiro" aria-hidden="true" className="pointer-events-none absolute inset-0">
      {todasCelulas.map((celula) => {
        const ocupada = ocupadasSet.has(chaveCelula(celula))
        return (
          <div
            key={chaveCelula(celula)}
            data-testid="tabuleiro-celula"
            data-ocupada={ocupada ? 'true' : 'false'}
            data-linha={celula.linha}
            data-coluna={celula.coluna}
          />
        )
      })}
      <div data-testid="reserva">
        {reserva.map((peca) => (
          <div
            key={peca.pecaId}
            data-testid="reserva-peca"
            data-tipo={peca.tipo}
            data-peca-id={peca.pecaId}
          />
        ))}
      </div>
      {posicionadas.map((p) => (
        <div key={p.pecaId} data-testid="peca-posicionada" data-peca-id={p.pecaId} />
      ))}
    </div>
  )
}
