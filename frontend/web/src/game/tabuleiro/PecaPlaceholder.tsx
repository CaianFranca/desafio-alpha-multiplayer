import { TAMANHO_CELULA, bordasAbertas } from './contrato'
import type { TipoDaPeca, Orientacao, BordaCardinal } from './contrato'
import type { ThreeEvent } from '@react-three/fiber'
import { handlersDeCursor } from './cursor'

interface PecaPlaceholderProps {
  tipo: TipoDaPeca
  orientacao: Orientacao
  position?: [number, number, number]
  /** Destaque visual da peça selecionada/em manipulação. */
  destacada?: boolean
  /** Cursor do ponteiro ao pairar (reserva selecionável). */
  cursor?: 'default' | 'pointer'
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}

const COR_POR_TIPO: Record<TipoDaPeca, string> = {
  inicial: '#d9c6a5',
  reta: '#a5c7d9',
  T: '#c9a5d9',
  cruz: '#a5d9b6',
  gerador: '#ff9f1c',
  sala_do_diretor: '#e76f51',
  sala_medica: '#a8ff60',
  portao_de_saida: '#6c757d',
  // Cores provisórias (ST-15/#169 fora de escopo): neutras, definir na implementação
  // visual dos monstros.
  vulto: '#8a8a8a',
  espectro: '#b0b0b0',
}

const COR_CAMINHO = '#111111'

// Destaque da peça selecionada/em manipulação: realce quente na borda para
// distinguir visualmente da composição padrão.
/** Cor do destaque de destino válido (vizinha conectada ao peão selecionado). */
const COR_DESTAQUE = '#ffe08a'
const INTENSIDADE_DESTAQUE = 0.7

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

export function PecaPlaceholder({
  tipo,
  orientacao,
  position,
  destacada = false,
  cursor = 'default',
  onClick,
}: PecaPlaceholderProps) {
  const bordas = bordasAbertas({ tipo, orientacao })
  const cursorHandlers = handlersDeCursor(cursor)

  const handleClick = onClick
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        onClick(e)
      }
    : undefined

  return (
    <group position={position}>
      <mesh
        position={[0, 0.08, 0]}
        onClick={handleClick}
        {...cursorHandlers}
      >
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial
          color={COR_POR_TIPO[tipo]}
          transparent
          opacity={0.88}
          emissive={destacada ? COR_DESTAQUE : '#000000'}
          emissiveIntensity={destacada ? INTENSIDADE_DESTAQUE : 0}
        />
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
