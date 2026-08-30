import {
  POSICAO_RESERVA,
  COLUNAS_RESERVA,
  ESPACAMENTO_RESERVA,
  reservaIndiceParaLocal,
} from './contrato'
import type { PecaDaReserva } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'

interface ReservaProps {
  reserva: readonly PecaDaReserva[]
}

export function Reserva({ reserva }: ReservaProps) {
  const total = reserva.length
  const linhas = Math.ceil(total / COLUNAS_RESERVA) || 1

  return (
    <group position={[POSICAO_RESERVA[0], POSICAO_RESERVA[1], POSICAO_RESERVA[2]]}>
      {/* Base da reserva */}
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry
          args={[COLUNAS_RESERVA * ESPACAMENTO_RESERVA + 0.4, linhas * ESPACAMENTO_RESERVA + 0.4]}
        />
        <meshStandardMaterial color="#1f1a18" transparent opacity={0.9} />
      </mesh>
      {reserva.map((peca, indice) => {
        const [lx, , lz] = reservaIndiceParaLocal(indice)
        return (
          <PecaPlaceholder
            key={peca.pecaId}
            tipo={peca.tipo}
            orientacao={peca.orientacao}
            position={[lx, 0.02, lz]}
          />
        )
      })}
    </group>
  )
}
