import { Suspense, useMemo } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { TAMANHO_CELULA } from './contrato'
import type { TipoDaPeca, Orientacao } from './contrato'
import {
  EXPANSAO_CONTORNO_PECA_XZ,
  corDoContornoDaPeca,
  propsDoMaterialDeContorno,
} from './contorno'
import { handlersDeCursor } from './cursor'
import { rotacaoDoMotivo, texturaDaPeca } from './texturasDasPecas'

interface PecaPlaceholderProps {
  tipo: TipoDaPeca
  orientacao: Orientacao
  position?: [number, number, number]
  /** Destaque visual da peça selecionada/em manipulação. */
  destacada?: boolean
  /**
   * Tom do contorno de destaque (default `COR_DESTAQUE` quente). Destino de
   * resgate passa `COR_DESTAQUE_RESGATE` — sóbria, sem arte nova.
   */
  corDestaque?: string
  /** Cursor do ponteiro ao pairar (peça da mesa selecionável). */
  cursor?: 'default' | 'pointer'
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}

/**
 * Cor chapada por tipo — agora só fallback até a textura carregar (face do
 * `Suspense` interno). O corpo final é caixa lisa com topo texturizado.
 */
const COR_POR_TIPO: Record<TipoDaPeca, string> = {
  inicial: '#d9c6a5',
  reta: '#a5c7d9',
  T: '#c9a5d9',
  cruz: '#a5d9b6',
  gerador: '#ff9f1c',
  sala_do_diretor: '#e76f51',
  sala_medica: '#a8ff60',
  portao_de_saida: '#6c757d',
  // Monstros (issue #143): tons escuros distintos; arte final substitui o
  // placeholder, não os ids.
  vulto: '#4a3b6b',
  espectro: '#37474f',
}

/** Laterais em tom neutro escuro (o motivo vive só na face superior). */
const COR_LATERAL = '#2b2521'

// Destaque da peça selecionada/em manipulação: realce quente na borda para
// distinguir visualmente da composição padrão.
/** Cor do destaque de destino válido (vizinha conectada ao peão selecionado). */
const COR_DESTAQUE = '#ffe08a'
/**
 * Cor do destaque de destino de RESGATE (peça que abriga peão AFETADO sob o
 * teto elevado — exceção #171). Tom frio sóbrio que contrasta do âmbar quente
 * do movimento sem exigir arte nova (issue #145-exp F1).
 */
export const COR_DESTAQUE_RESGATE = '#7fd1e0'

export const TAMANHO_PECA = TAMANHO_CELULA * 0.96
export const ESPESSURA_PECA = 0.12
const Y_CORPO = 0.08

/**
 * Fator do relevo do topo (normalScale acima do default 1: ponto de partida
 * afinado por screenshot; realça o relevo do normalMap sob a luz rasante da
 * cena sem amplificar ruído além do motivo).
 */
const RELEVO_TOPO_NORMAL_SCALE: readonly [number, number] = [1.6, 1.6]

interface CorpoProps extends PecaPlaceholderProps {
  destacada: boolean
  corDestaque: string
  cursor: 'default' | 'pointer'
}

/**
 * Contorno da peça por casca invertida: caixa ligeiramente maior em XZ,
 * mesma altura/centro, `BackSide`, sem handlers e com `raycast` nulo para
 * nunca roubar clique. Extraído para uso único nos dois corpos (texturizado
 * e fallback do `Suspense`) — a cor vem da semântica de `corDestaque`.
 */
function ContornoDaPeca({
  visivel,
  corDestaque,
}: {
  visivel: boolean
  corDestaque: string
}) {
  const contorno = propsDoMaterialDeContorno(corDoContornoDaPeca(corDestaque))
  return (
    <mesh
      position={[0, Y_CORPO, 0]}
      visible={visivel}
      raycast={() => null}
    >
      <boxGeometry
        args={[
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
          ESPESSURA_PECA,
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
        ]}
      />
      <meshBasicMaterial {...contorno} side={THREE.BackSide} />
    </mesh>
  )
}

function usarClique(
  onClick: PecaPlaceholderProps['onClick'],
): ((e: ThreeEvent<MouseEvent>) => void) | undefined {
  if (!onClick) return undefined
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onClick(e)
  }
}

/**
 * Corpo final: caixa lisa nas mesmas dimensões, face superior (`material-2`,
 * +y — mesmo precedente da Mesa em `AmbienteCena`) com map (sRGB) +
 * normalMap (linear) do tipo, motivo girando com a `orientacao`; laterais
 * neutras. O topo ignora o tone mapping da cena (fiel à textura); o destaque
 * é contorno por casca invertida, sem emissivo sobre a textura.
 */
function CorpoTexturizado({
  tipo,
  orientacao,
  destacada,
  corDestaque,
  cursor,
  onClick,
}: CorpoProps) {
  const { map, normalMap } = texturaDaPeca(tipo)
  const [mapCarregado, normalCarregado] = useLoader(THREE.TextureLoader, [
    map,
    normalMap,
  ])
  // Clona para não mutar o cache do useLoader (precedente da Mesa): cor no
  // map, dado linear no normal; centro no meio para girar o motivo.
  const { mapaTopo, normalTopo } = useMemo(() => {
    const rotacao = rotacaoDoMotivo(orientacao)
    const mapa = mapCarregado.clone()
    mapa.colorSpace = THREE.SRGBColorSpace
    mapa.center.set(0.5, 0.5)
    mapa.rotation = rotacao
    mapa.needsUpdate = true
    const normal = normalCarregado.clone()
    normal.center.set(0.5, 0.5)
    normal.rotation = rotacao
    normal.needsUpdate = true
    return { mapaTopo: mapa, normalTopo: normal }
  }, [mapCarregado, normalCarregado, orientacao])

  const cursorHandlers = handlersDeCursor(cursor)
  const handleClick = usarClique(onClick)

  return (
    <>
      <mesh
        position={[0, Y_CORPO, 0]}
        onClick={handleClick}
        {...cursorHandlers}
      >
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial attach="material-0" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-1" color={COR_LATERAL} />
        <meshStandardMaterial
          attach="material-2"
          map={mapaTopo}
          normalMap={normalTopo}
          normal-scale={RELEVO_TOPO_NORMAL_SCALE}
          toneMapped={false}
        />
        <meshStandardMaterial attach="material-3" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-4" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-5" color={COR_LATERAL} />
      </mesh>
      <ContornoDaPeca visivel={destacada} corDestaque={corDestaque} />
    </>
  )
}

/** Fallback de suspensão: caixa lisa na cor chapada do tipo (sem braços). */
function CorpoFallback({
  tipo,
  destacada,
  corDestaque,
  cursor,
  onClick,
}: CorpoProps) {
  const cursorHandlers = handlersDeCursor(cursor)
  const handleClick = usarClique(onClick)

  return (
    <>
      <mesh
        position={[0, Y_CORPO, 0]}
        onClick={handleClick}
        {...cursorHandlers}
      >
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial
          color={COR_POR_TIPO[tipo]}
          transparent
          opacity={0.88}
        />
      </mesh>
      <ContornoDaPeca visivel={destacada} corDestaque={corDestaque} />
    </>
  )
}

export function PecaPlaceholder({
  tipo,
  orientacao,
  position,
  destacada = false,
  corDestaque = COR_DESTAQUE,
  cursor = 'default',
  onClick,
}: PecaPlaceholderProps) {
  const corpo: CorpoProps = {
    tipo,
    orientacao,
    destacada,
    corDestaque,
    cursor,
    onClick,
  }

  return (
    <group position={position}>
      <Suspense fallback={<CorpoFallback {...corpo} />}>
        <CorpoTexturizado {...corpo} />
      </Suspense>
    </group>
  )
}
