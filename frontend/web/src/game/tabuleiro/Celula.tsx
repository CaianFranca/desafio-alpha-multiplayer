import { CELULA_INSET, celulaParaMundo, COR_BORDA_CELULA, ESPESSURA_BORDA, TAMANHO_CELULA } from './contrato'
import type { Celula as CelulaTipo, PecaPosicionada } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - 0.02], args: [CELULA_INSET, 0.01, ESPESSURA_BORDA] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + 0.02], args: [CELULA_INSET, 0.01, ESPESSURA_BORDA] },
  { pos: [TAMANHO_CELULA / 2 - 0.02, 0, 0], args: [ESPESSURA_BORDA, 0.01, CELULA_INSET] },
  { pos: [-TAMANHO_CELULA / 2 + 0.02, 0, 0], args: [ESPESSURA_BORDA, 0.01, CELULA_INSET] },
]

export function Celula({ celula, peca }: CelulaProps) {
  const pos = celulaParaMundo(celula)
  const ocupada = Boolean(peca)

  return (
    <group position={pos}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
        <meshStandardMaterial
          color={ocupada ? '#5e4e36' : '#1b1915'}
          transparent
          opacity={ocupada ? 0.82 : 0.7}
        />
      </mesh>
      <group position={[0, 0.018, 0]}>
        {BORDAS_CONFIG.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <boxGeometry args={b.args} />
            <meshStandardMaterial color={COR_BORDA_CELULA} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>
      {peca ? (
        <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} position={[0, 0.02, 0]} />
      ) : null}
    </group>
  )
}
