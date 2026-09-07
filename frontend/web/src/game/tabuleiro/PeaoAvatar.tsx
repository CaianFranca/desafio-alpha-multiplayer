import { useEffect, useMemo } from 'react'
import { useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CorDoPeao } from './contrato'
import { AVATARES_POR_SLOT, slotDoAvatar } from './avatares'
import {
  COR_CONTORNO_PEAO_SELECIONADO,
  ESCALA_CONTORNO_PEAO,
  propsDoMaterialDeContorno,
} from './contorno'

interface PeaoAvatarProps {
  cor: CorDoPeao
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando o slot é menor. */
  escala?: number
  /** Destaque branco do selecionado (casca BackSide, mesma linguagem visual). */
  selecionado?: boolean
  /** Destaque emissivo suave quando este peão é o do Jogador Ativo (#118). */
  ativo?: boolean
  /**
   * Baixa Iluminação do jogador dono do peão (estado do Vulto): troca a
   * renderização para a variante *apagado* do modelo — sinal de perigo.
   */
  emBaixaIluminacao?: boolean
  /** Clique simples seleciona; sem handler, o peão é inerte ao ponteiro. */
  aoClicar?: () => void
}

/**
 * Mesh cujo span de mundo excede o limiar é nó decorativo de exportação
 * (a variante apagado traz uma superfície cobrindo ±15.9 u — sem a poda ela
 * cobriria a Mesa inteira).
 */
const LIMIAR_AMPLITUDE_MUNDO = 5

/** Altura alvo após a normalização (pegada do placeholder: altura 0.5). */
const ALTURA_ALVO = 0.5

/** Diâmetro máximo alvo da base após a normalização (pegada: ∅ 0.4). */
const BASE_ALVO = 0.4

const EMISSIVO_ATIVO = 0.35

/**
 * Clona os materiais da cena: o `useLoader` cacheia o GLTF bruto e o
 * `clone()` do Object3D compartilha materiais — sem clonar, mutar o emissivo
 * vazaria para todos os peões (precedente das texturas em `PecaPlaceholder`).
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
 * Normaliza um clone do modelo para a pegada do placeholder (issue #297):
 * poda meshes decorativos de span absurdo (superfície gigante do apagado),
 * escala uniforme para caber em ALTURA_ALVO × BASE_ALVO e origem na base
 * (y = 0), centralizado em x/z — o grupo pai decide onde o peão pousa
 * (`PEAO_Y` na célula, y = 0 na fileira da Mesa), como no placeholder.
 */
function normalizarModeloDoAvatar(original: THREE.Object3D): THREE.Object3D {
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

export function PeaoAvatar({
  cor,
  position,
  escala = 1,
  selecionado = false,
  ativo = false,
  emBaixaIluminacao = false,
  aoClicar,
}: PeaoAvatarProps) {
  // Os 2 GLBs sempre carregados (hooks incondicionais): a troca aceso↔apagado
  // é só trocar o objeto do `<primitive>` — sem reload, sem remontar a cena.
  const config = AVATARES_POR_SLOT.get(slotDoAvatar(cor))
  const urlAcesa = config?.urlAcesa ?? ''
  const urlApagada = config?.urlApagada ?? ''
  const [gltfAcesa, gltfApagada] = useLoader(GLTFLoader, [urlAcesa, urlApagada])

  const cenaAcesa = useMemo(
    () => normalizarModeloDoAvatar(gltfAcesa.scene),
    [gltfAcesa],
  )
  const cenaApagada = useMemo(
    () => normalizarModeloDoAvatar(gltfApagada.scene),
    [gltfApagada],
  )
  const cena = emBaixaIluminacao ? cenaApagada : cenaAcesa

  // Brilho emissivo no Jogador Ativo (suave, mesmo tom de linguagem do
  // placeholder); muta só o material clonado desta instância. Sob
  // `frameloop="demand"`, material mutado fora do commit React precisa de
  // invalidação explícita para re-renderizar.
  const invalidate = useThree((estado) => estado.invalidate)
  useEffect(() => {
    cena.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        obj.material instanceof THREE.MeshStandardMaterial
      ) {
        obj.material.emissive.set(0xffffff)
        obj.material.emissiveIntensity = ativo ? EMISSIVO_ATIVO : 0
      }
    })
    invalidate()
  }, [cena, ativo, invalidate])

  // Casca de contorno branca BackSide (mesma linguagem do placeholder),
  // derivada do modelo corrente; sem clique (`raycast` nulo) e sem geometria
  // nova (clone compartilha os BufferAttributes do corpo).
  const cascaContorno = useMemo(() => {
    if (!selecionado) return null
    const casca = cena.clone(true)
    casca.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const material = new THREE.MeshBasicMaterial(
        propsDoMaterialDeContorno(COR_CONTORNO_PEAO_SELECIONADO),
      )
      material.side = THREE.BackSide
      obj.material = material
      // Nunca rouba clique do corpo selecionável.
      obj.raycast = () => {}
    })
    casca.scale.multiplyScalar(ESCALA_CONTORNO_PEAO)
    return casca
  }, [cena, selecionado])

  // Só interage ao ponteiro quando há handler de seleção (idêntico ao
  // PeaoPlaceholder): os meshes do modelo borbulham até o grupo pai.
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
      <primitive object={cena} />
      {cascaContorno !== null ? <primitive object={cascaContorno} /> : null}
    </group>
  )
}
