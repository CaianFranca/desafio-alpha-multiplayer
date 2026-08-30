import { celulaParaMundo, TAMANHO_CELULA } from './contrato'
import type { Celula as CelulaTipo, PecaPosicionada } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - 0.02], args: [TAMANHO_CELULA * 0.98, 0.01, 0.04] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + 0.02], args: [TAMANHO_CELULA * 0.98, 0.01, 0.04] },
  { pos: [TAMANHO_CELULA / 2 - 0.02, 0, 0], args: [0.04, 0.01, TAMANHO_CELULA * 0.98] },
  { pos: [-TAMANHO_CELULA / 2 + 0.02, 0, 0], args: [0.04, 0.01, TAMANHO_CELULA * 0.98] },
]

function BordaCelula({ pos, args }: { pos: [number, number, number]; args: [number, number, number] }) {
  return (
    <mesh position={pos}>
      <boxGeometry args={args} />
      <meshStandardMaterial color="#f2e0b6" transparent opacity={0.95} />
    </mesh>
  )
}

export function Celula({ celula, peca }: CelulaProps) {
  const pos = celulaParaMundo(celula)
  const ocupada = Boolean(peca)

  return (
    <group position={pos}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TAMANHO_CELULA * 0.98, TAMANHO_CELULA * 0.98]} />
        <meshStandardMaterial
          color={ocupada ? '#5e4e36' : '#1b1915'}
          transparent
          opacity={ocupada ? 0.82 : 0.7}
        />
      </mesh>
      <group position={[0, 0.018, 0]}>
        {BORDAS_CONFIG.map((b, i) => (
          <BordaCelula key={i} pos={b.pos} args={b.args} />
        ))}
      </group>
      {peca ? (
        <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} position={[0, 0.02, 0]} />
      ) : null}
    </group>
  )
}
