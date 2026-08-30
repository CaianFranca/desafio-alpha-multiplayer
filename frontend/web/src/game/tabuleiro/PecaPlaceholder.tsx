import { TAMANHO_CELULA, bordasAbertas } from './contrato'
import type { TipoDaPeca, Orientacao } from './contrato'

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

export function PecaPlaceholder({ tipo, orientacao, position }: PecaPlaceholderProps) {
  const bordas = bordasAbertas({ tipo, orientacao })
  const tamanhoPeca = TAMANHO_CELULA * 0.96
  const espessura = 0.12
  const larguraTrilha = tamanhoPeca * 0.22
  const comprimentoBraco = tamanhoPeca / 2 - larguraTrilha / 2
  const offsetBraco = (tamanhoPeca + larguraTrilha) / 4
  const yCaminho = 0.08 + espessura / 2 + 0.015

  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[tamanhoPeca, espessura, tamanhoPeca]} />
        <meshStandardMaterial color={COR_POR_TIPO[tipo]} transparent opacity={0.88} />
      </mesh>
      <group position={[0, yCaminho, 0]}>
        <mesh>
          <boxGeometry args={[larguraTrilha, 0.02, larguraTrilha]} />
          <meshStandardMaterial color={COR_CAMINHO} />
        </mesh>
        {bordas.map((borda) => {
          const isNS = borda === 'norte' || borda === 'sul'
          const args: [number, number, number] = isNS
            ? [larguraTrilha, 0.02, comprimentoBraco]
            : [comprimentoBraco, 0.02, larguraTrilha]
          const pos: [number, number, number] =
            borda === 'norte'
              ? [0, 0, -offsetBraco]
              : borda === 'sul'
                ? [0, 0, offsetBraco]
                : borda === 'leste'
                  ? [offsetBraco, 0, 0]
                  : [-offsetBraco, 0, 0]
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
