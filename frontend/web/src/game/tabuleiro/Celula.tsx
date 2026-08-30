import { celulaParaMundo, TAMANHO_CELULA } from './contrato'
import type { Celula as CelulaTipo, PecaPosicionada } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
}

export function Celula({ celula, peca }: CelulaProps) {
  const pos = celulaParaMundo(celula)
  const ocupada = Boolean(peca)

  return (
    <group position={pos}>
      {/* Base da célula — variante A com translucidez para Mesa aparecer */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TAMANHO_CELULA * 0.98, TAMANHO_CELULA * 0.98]} />
        <meshStandardMaterial
          color={ocupada ? '#5e4e36' : '#1b1915'}
          transparent
          opacity={ocupada ? 0.82 : 0.7}
        />
      </mesh>
      {/* Borda da célula — frame de 4 barras finas cor clara */}
      <group position={[0, 0.018, 0]}>
        <mesh position={[0, 0, TAMANHO_CELULA / 2 - 0.02]}>
          <boxGeometry args={[TAMANHO_CELULA * 0.98, 0.01, 0.04]} />
          <meshStandardMaterial color="#f2e0b6" transparent opacity={0.95} />
        </mesh>
        <mesh position={[0, 0, -TAMANHO_CELULA / 2 + 0.02]}>
          <boxGeometry args={[TAMANHO_CELULA * 0.98, 0.01, 0.04]} />
          <meshStandardMaterial color="#f2e0b6" transparent opacity={0.95} />
        </mesh>
        <mesh position={[TAMANHO_CELULA / 2 - 0.02, 0, 0]}>
          <boxGeometry args={[0.04, 0.01, TAMANHO_CELULA * 0.98]} />
          <meshStandardMaterial color="#f2e0b6" transparent opacity={0.95} />
        </mesh>
        <mesh position={[-TAMANHO_CELULA / 2 + 0.02, 0, 0]}>
          <boxGeometry args={[0.04, 0.01, TAMANHO_CELULA * 0.98]} />
          <meshStandardMaterial color="#f2e0b6" transparent opacity={0.95} />
        </mesh>
      </group>
      {peca ? (
        <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} position={[0, 0.02, 0]} />
      ) : null}
    </group>
  )
}
