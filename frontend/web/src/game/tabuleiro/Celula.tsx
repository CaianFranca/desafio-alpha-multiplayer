import {
  BORDA_OFFSET,
  BORDA_Y,
  CELULA_INSET,
  CELULA_Y_BASE,
  CELULA_Y_BORDA,
  celulaParaMundo,
  COR_BORDA_CELULA,
  ESPESSURA_BORDA,
  PECA_Y,
  TAMANHO_CELULA,
} from './contrato'
import type { Celula as CelulaTipo, PecaPosicionada } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'
import { handlersDeCursor } from './cursor'
import type { ThreeEvent } from '@react-three/fiber'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
  /** Cursor da grade para a célula (ocupada/vazia; vazia só reage se há seleção). */
  cursor?: 'default' | 'pointer'
  /** Destaque visual da peça posicionada selecionada/em manipulação. */
  pecaDestacada?: boolean
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [TAMANHO_CELULA / 2 - BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
  { pos: [-TAMANHO_CELULA / 2 + BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
]

export function Celula({ celula, peca, cursor = 'default', pecaDestacada = false, onClick }: CelulaProps) {
  const pos = celulaParaMundo(celula)
  const ocupada = Boolean(peca)
  const cursorHandlers = handlersDeCursor(cursor)

  return (
    <group position={pos}>
      <mesh
        position={[0, CELULA_Y_BASE, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={onClick}
        {...cursorHandlers}
      >
        <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
        <meshStandardMaterial
          color={ocupada ? '#5e4e36' : '#1b1915'}
          transparent
          opacity={ocupada ? 0.82 : 0.7}
        />
      </mesh>
      <group position={[0, CELULA_Y_BORDA, 0]}>
        {BORDAS_CONFIG.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <boxGeometry args={b.args} />
            <meshStandardMaterial color={COR_BORDA_CELULA} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>
      {peca ? (
        <PecaPlaceholder
          tipo={peca.tipo}
          orientacao={peca.orientacao}
          position={[0, PECA_Y, 0]}
          destacada={pecaDestacada}
        />
      ) : null}
    </group>
  )
}
