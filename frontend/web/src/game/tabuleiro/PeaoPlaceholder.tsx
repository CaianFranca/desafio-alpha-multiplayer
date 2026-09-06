import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { HEX_COR_PEAO } from './contrato'
import type { CorDoPeao } from './contrato'
import {
  COR_CONTORNO_PEAO_SELECIONADO,
  ESCALA_CONTORNO_PEAO,
  propsDoMaterialDeContorno,
} from './contorno'

/**
 * Placeholder do Peão (issue #90 — ST-10).
 *
 * Peão de xadrez montado a partir de primitivas three.js: base cilíndrica,
 * corpo cônico, colarinho e cabeça esférica. A origem da geometria fica na
 * BASE (y = 0) e cresce para cima, de modo que o grupo pai decide onde o peão
 * pousa (topo da peça via `PEAO_Y`, ou plano da Mesa via y = 0). Arte final
 * substituível: nada aqui depende de estado de jogo — cor e posição vêm do
 * chamador.
 *
 * Interação: quando `aoClicar` é fornecido, o peão reage ao ponteiro (cursor
 * pointer + clique que seleciona e para a propagação). A seleção é estado
 * visual local da cena (skill threejs-board-pieces); comandos wire virão na
 * #92.
 */

interface PeaoPlaceholderProps {
  cor: CorDoPeao
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando o slot é menor. */
  escala?: number
  /** Destaque por contorno branco quando este peão é o selecionado. */
  selecionado?: boolean
  /** Destaque emissivo suave quando este peão é o do Jogador Ativo (#118). */
  ativo?: boolean
  /** Clique simples seleciona; sem handler, o peão é inerte ao ponteiro. */
  aoClicar?: () => void
}

// Empilhamento a partir da base (y = 0). Cada segmento parte do topo anterior.
const BASE_ALTURA = 0.06
const BASE_RAIO = 0.2
const CORPO_ALTURA = 0.22
const CORPO_RAIO_BASE = 0.13
const CORPO_RAIO_TOPO = 0.06
const COLARINHO_ALTURA = 0.04
const COLARINHO_RAIO = 0.09
const CABECA_RAIO = 0.09

const Y_BASE = BASE_ALTURA / 2
const Y_CORPO = BASE_ALTURA + CORPO_ALTURA / 2
const Y_COLARINHO = BASE_ALTURA + CORPO_ALTURA + COLARINHO_ALTURA / 2
const Y_CABECA =
  BASE_ALTURA + CORPO_ALTURA + COLARINHO_ALTURA + CABECA_RAIO * 0.9

const EMISSIVO_ATIVO = 0.35

export function PeaoPlaceholder({
  cor,
  position,
  escala = 1,
  selecionado = false,
  ativo = false,
  aoClicar,
}: PeaoPlaceholderProps) {
  const hex = HEX_COR_PEAO[cor]
  // A seleção virou contorno branco por casca invertida (legível até no peão
  // branco, sem lavar a cor); só o Jogador Ativo usa brilho emissivo, suave,
  // e os dois indicadores coexistem no peão da vez selecionado.
  const emissiveIntensity = ativo ? EMISSIVO_ATIVO : 0
  const contornoSelecionado = propsDoMaterialDeContorno(
    COR_CONTORNO_PEAO_SELECIONADO,
  )

  // Só interage ao ponteiro quando há handler de seleção.
  const handlers = aoClicar
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        },
        onPointerOut: () => {
          document.body.style.cursor = 'auto'
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          aoClicar()
        },
      }
    : {}

  return (
    <group position={position} scale={[escala, escala, escala]} {...handlers}>
      {/* Base cilíndrica */}
      <mesh position={[0, Y_BASE, 0]}>
        <cylinderGeometry args={[BASE_RAIO, BASE_RAIO, BASE_ALTURA, 20]} />
        <meshStandardMaterial
          color={hex}
          emissive={hex}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {/* Corpo cônico (cone apontando para cima) */}
      <mesh position={[0, Y_CORPO, 0]}>
        <cylinderGeometry
          args={[CORPO_RAIO_TOPO, CORPO_RAIO_BASE, CORPO_ALTURA, 20]}
        />
        <meshStandardMaterial
          color={hex}
          emissive={hex}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {/* Colarinho */}
      <mesh position={[0, Y_COLARINHO, 0]}>
        <cylinderGeometry
          args={[COLARINHO_RAIO, COLARINHO_RAIO, COLARINHO_ALTURA, 20]}
        />
        <meshStandardMaterial
          color={hex}
          emissive={hex}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {/* Cabeça esférica */}
      <mesh position={[0, Y_CABECA, 0]}>
        <sphereGeometry args={[CABECA_RAIO, 20, 16]} />
        <meshStandardMaterial
          color={hex}
          emissive={hex}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {selecionado ? (
        <>
          {/* Cascas de contorno: mesma geometria, BackSide, sem clique */}
          <mesh
            position={[0, Y_BASE, 0]}
            scale={ESCALA_CONTORNO_PEAO}
            raycast={() => null}
          >
            <cylinderGeometry args={[BASE_RAIO, BASE_RAIO, BASE_ALTURA, 20]} />
            <meshBasicMaterial
              {...contornoSelecionado}
              side={THREE.BackSide}
            />
          </mesh>
          <mesh
            position={[0, Y_CORPO, 0]}
            scale={ESCALA_CONTORNO_PEAO}
            raycast={() => null}
          >
            <cylinderGeometry
              args={[CORPO_RAIO_TOPO, CORPO_RAIO_BASE, CORPO_ALTURA, 20]}
            />
            <meshBasicMaterial
              {...contornoSelecionado}
              side={THREE.BackSide}
            />
          </mesh>
          <mesh
            position={[0, Y_COLARINHO, 0]}
            scale={ESCALA_CONTORNO_PEAO}
            raycast={() => null}
          >
            <cylinderGeometry
              args={[COLARINHO_RAIO, COLARINHO_RAIO, COLARINHO_ALTURA, 20]}
            />
            <meshBasicMaterial
              {...contornoSelecionado}
              side={THREE.BackSide}
            />
          </mesh>
          <mesh
            position={[0, Y_CABECA, 0]}
            scale={ESCALA_CONTORNO_PEAO}
            raycast={() => null}
          >
            <sphereGeometry args={[CABECA_RAIO, 20, 16]} />
            <meshBasicMaterial
              {...contornoSelecionado}
              side={THREE.BackSide}
            />
          </mesh>
        </>
      ) : null}
    </group>
  )
}
