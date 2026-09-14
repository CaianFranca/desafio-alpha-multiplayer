import { useMemo } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { urlDoModeloDeMonstro, type TipoDeMonstro } from './monstros'
import { handlersDeCursor } from './cursor'

interface MonstroAvatarProps {
  tipo: TipoDeMonstro
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando menor. */
  escala?: number
  /**
   * Clique no modelo equivale ao clique na própria peça (uma coisa só): o
   * handler é o mesmo `onClick` da peça — sem handler, o modelo é inerte.
   */
  aoClicar?: (event: ThreeEvent<MouseEvent>) => void
}

/**
 * Mesh cujo span de mundo excede o limiar é nó decorativo de exportação —
 * mesmo precedente de `PeaoAvatar` (a variante apagado do Diretor trazia
 * uma superfície cobrindo ±15.9 u).
 */
const LIMIAR_AMPLITUDE_MUNDO = 5

/** Altura alvo após a normalização: presença que paira sobre a base da peça. */
const ALTURA_ALVO = 1.1

/** Diâmetro máximo alvo da base após a normalização. */
const BASE_ALVO = 0.7

/**
 * Clona os materiais da cena: o `useLoader` cacheia o GLTF bruto e o
 * `clone()` do Object3D compartilha materiais — o clone por instância isola
 * os materiais do modelo aqui (precedente de `PeaoAvatar`).
 */
function clonarMateriais(cena: THREE.Object3D): void {
  cena.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.material = Array.isArray(obj.material)
      ? obj.material.map((m) => m.clone())
      : obj.material.clone()
  })
}

/**
 * Normaliza um clone do modelo para a pegada da peça (espelho de
 * `normalizarModeloDoAvatar` em `PeaoAvatar`): poda meshes decorativos de
 * span absurdo, escala uniforme para caber em ALTURA_ALVO × BASE_ALVO e
 * origem na base (y = 0), centralizado em x/z — o pai decide onde o modelo
 * pousa (topo da base da peça).
 */
function normalizarModeloDoMonstro(original: THREE.Object3D): THREE.Object3D {
  const cena = original.clone()
  clonarMateriais(cena)

  const paraRemover: THREE.Object3D[] = []
  cena.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.geometry.computeBoundingBox()
    const local = obj.geometry.boundingBox
    if (local === null) return
    const tamanho = local.getSize(new THREE.Vector3())
    const escalaMundo = obj.getWorldScale(new THREE.Vector3())
    if (
      tamanho.x * escalaMundo.x > LIMIAR_AMPLITUDE_MUNDO ||
      tamanho.y * escalaMundo.y > LIMIAR_AMPLITUDE_MUNDO ||
      tamanho.z * escalaMundo.z > LIMIAR_AMPLITUDE_MUNDO
    ) {
      paraRemover.push(obj)
    }
  })
  for (const obj of paraRemover) {
    obj.parent?.remove(obj)
  }
  paraRemover.length = 0

  cena.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(cena)
  const tamanho = bounds.getSize(new THREE.Vector3())
  const centro = bounds.getCenter(new THREE.Vector3())
  if (tamanho.y === 0 || Math.max(tamanho.x, tamanho.z) === 0) return cena

  const escala = Math.min(
    ALTURA_ALVO / tamanho.y,
    BASE_ALVO / Math.max(tamanho.x, tamanho.z),
  )
  // Wrapper próprio: o transform da raiz do GLTF nunca é pressuposto (a
  // normalização vive aqui, não no nó de origem).
  const grupo = new THREE.Group()
  grupo.add(cena)
  grupo.scale.setScalar(escala)
  grupo.position.set(
    -centro.x * escala,
    -bounds.min.y * escala,
    -centro.z * escala,
  )
  return grupo
}

export function MonstroAvatar({
  tipo,
  position,
  escala = 1.30,
  aoClicar,
}: MonstroAvatarProps) {
  const gltf = useLoader(GLTFLoader, urlDoModeloDeMonstro(tipo))

  const cena = useMemo(
    () => normalizarModeloDoMonstro(gltf.scene),
    [gltf],
  )

  // Clique único com a peça: os meshes do modelo borbulham até o grupo, que
  // dispara o mesmo handler da peça (e para a propagação — sem double-fire
  // com a hitbox invisível da peça). Sem handler, inerte ao ponteiro.
  const baseCursor = handlersDeCursor(aoClicar ? 'pointer' : 'default')
  const groupHandlers = aoClicar
    ? {
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        aoClicar(e)
      },
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        baseCursor.onPointerOver(e)
      },
      onPointerOut: baseCursor.onPointerOut,
      onPointerLeave: baseCursor.onPointerLeave,
    }
    : {}

  return (
    <group position={position} scale={[escala, escala, escala]} {...groupHandlers}>
      <primitive object={cena} />
    </group>
  )
}
