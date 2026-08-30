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
      {/* Base da célula */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TAMANHO_CELULA * 0.98, TAMANHO_CELULA * 0.98]} />
        <meshStandardMaterial
          color={ocupada ? '#4a3f35' : '#2f2a26'}
          transparent
          opacity={ocupada ? 0.95 : 0.85}
        />
      </mesh>
      {/* Borda da grade */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TAMANHO_CELULA, TAMANHO_CELULA]} />
        <meshStandardMaterial color="#1a1614" wireframe={false} transparent opacity={0.15} />
      </mesh>
      {peca ? (
        <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} position={[0, 0.02, 0]} />
      ) : null}
    </group>
  )
}
