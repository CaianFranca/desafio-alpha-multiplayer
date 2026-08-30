import { TAMANHO_CELULA, bordasAbertas } from './contrato'
import type { TipoDaPeca, Orientacao, BordaCardinal } from './contrato'

interface PecaPlaceholderProps {
  tipo: TipoDaPeca
  orientacao: Orientacao
  /** Posição local do placeholder (quando usado dentro da Reserva/Tabuleiro). */
  position?: [number, number, number]
}

const COR_POR_TIPO: Record<TipoDaPeca, string> = {
  inicial: '#d9c6a5',
  reta: '#a5c7d9',
  T: '#c9a5d9',
  cruz: '#a5d9b6',
}

const COR_BORDA_ABERTA = '#2b2b2b'

function offsetDaBorda(borda: BordaCardinal): [number, number, number] {
  const half = TAMANHO_CELULA * 0.44
  switch (borda) {
    case 'norte':
      return [0, 0.08, -half]
    case 'sul':
      return [0, 0.08, half]
    case 'leste':
      return [half, 0.08, 0]
    case 'oeste':
      return [-half, 0.08, 0]
  }
}

export function PecaPlaceholder({ tipo, orientacao, position }: PecaPlaceholderProps) {
  const bordas = bordasAbertas({ tipo, orientacao })
  const tamanhoPeca = TAMANHO_CELULA * 0.88
  const espessura = 0.12

  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[tamanhoPeca, espessura, tamanhoPeca]} />
        <meshStandardMaterial color={COR_POR_TIPO[tipo]} transparent opacity={0.88} />
      </mesh>
      {bordas.map((borda) => {
        const [x, y, z] = offsetDaBorda(borda)
        // Marca visual da borda aberta: pequeno box na lateral
        const isHorizontal = borda === 'norte' || borda === 'sul'
        const w = isHorizontal ? tamanhoPeca * 0.35 : 0.08
        const d = isHorizontal ? 0.08 : tamanhoPeca * 0.35
        return (
          <mesh key={borda} position={[x, y, z]}>
            <boxGeometry args={[w, 0.04, d]} />
            <meshStandardMaterial color={COR_BORDA_ABERTA} transparent opacity={0.95} />
          </mesh>
        )
      })}
    </group>
  )
}
