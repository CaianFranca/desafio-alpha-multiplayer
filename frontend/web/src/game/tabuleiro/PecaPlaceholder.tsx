import { TAMANHO_CELULA, bordasAbertas } from './contrato'
import type { TipoDaPeca, Orientacao, BordaCardinal } from './contrato'

interface PecaPlaceholderProps {
  tipo: TipoDaPeca
  orientacao: Orientacao
  position?: [number, number, number]
}

const COR_POR_TIPO: Record<TipoDaPeca, string> = {
  inicial: '#d9c6a5',
  reta: '#a5c7d9',
  T: '#c9a5d9',
  cruz: '#a5d9b6',
}

const COR_CAMINHO = '#111111'

const TAMANHO_PECA = TAMANHO_CELULA * 0.96
const ESPESSURA_PECA = 0.12
const LARGURA_TRILHA = TAMANHO_PECA * 0.22
const COMPRIMENTO_BRACO = TAMANHO_PECA / 2 - LARGURA_TRILHA / 2
const OFFSET_BRACO = (TAMANHO_PECA + LARGURA_TRILHA) / 4
const Y_CAMINHO = 0.08 + ESPESSURA_PECA / 2 + 0.015

const MAP_BORDA: Record<BordaCardinal, { pos: [number, number, number]; args: [number, number, number] }> = {
  norte: { pos: [0, 0, -OFFSET_BRACO], args: [LARGURA_TRILHA, 0.02, COMPRIMENTO_BRACO] },
  sul: { pos: [0, 0, OFFSET_BRACO], args: [LARGURA_TRILHA, 0.02, COMPRIMENTO_BRACO] },
  leste: { pos: [OFFSET_BRACO, 0, 0], args: [COMPRIMENTO_BRACO, 0.02, LARGURA_TRILHA] },
  oeste: { pos: [-OFFSET_BRACO, 0, 0], args: [COMPRIMENTO_BRACO, 0.02, LARGURA_TRILHA] },
}

export function PecaPlaceholder({ tipo, orientacao, position }: PecaPlaceholderProps) {
  const bordas = bordasAbertas({ tipo, orientacao })

  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial color={COR_POR_TIPO[tipo]} transparent opacity={0.88} />
      </mesh>
      <group position={[0, Y_CAMINHO, 0]}>
        <mesh>
          <boxGeometry args={[LARGURA_TRILHA, 0.02, LARGURA_TRILHA]} />
          <meshStandardMaterial color={COR_CAMINHO} />
        </mesh>
        {bordas.map((borda) => {
          const { pos, args } = MAP_BORDA[borda]
          return (
            <mesh key={borda} position={pos}>
              <boxGeometry args={args} />
              <meshStandardMaterial color={COR_CAMINHO} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}
