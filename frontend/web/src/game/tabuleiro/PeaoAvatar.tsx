import { useMemo } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CorDoPeao } from './contrato'
import { AVATARES_POR_SLOT, slotDoAvatar } from './avatares'
import {
  COR_CONTORNO_GUIA,
  COR_CONTORNO_PEAO_SELECIONADO,
  propsDoMaterialDeContorno,
} from './contorno'
import { handlersDeCursor } from './cursor'

interface PeaoAvatarProps {
  cor: CorDoPeao
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando o slot é menor. */
  escala?: number
  /** Destaque branco do selecionado (anel no chão; nunca pinta o corpo). */
  selecionado?: boolean
  /**
   * Guia de turno (issue #441): anel ciano sobre o peão acionável do passo
   * atual — linguagem inédita, fora do raio do anel de seleção para os dois
   * coexistirem; nunca pinta o corpo nem intercepta cliques.
   */
  emGuia?: boolean
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

/** Altura alvo após a normalização: maior que a pegada do placeholder (0.5)
 * para dar presença de Diretor na cena. */
const ALTURA_ALVO = 0.93

/** Diâmetro máximo alvo da base após a normalização (mesma proporção da altura). */
const BASE_ALVO = 0.74

/**
 * Raio interno/externo do anel de seleção (unidades do grupo normalizado,
 * escala default 1): fica logo além da pegada do corpo (escalado junto com o
 * modelo), sem invadir o corpo — nenhum branco sobre a textura.
 */
const ANEL_SELECAO_INTERNO = 0.35
const ANEL_SELECAO_EXTERNO = 0.50
/**
 * Anel do guia (issue #441): mesma linguagem do anel de seleção, no ciano
 * inédito e num raio externo — coexiste com a seleção sem sobrepor.
 */
const ANEL_GUIA_INTERNO = 0.56
const ANEL_GUIA_EXTERNO = 0.68
/**
 * Clona os materiais da cena: o `useLoader` cacheia o GLTF bruto e o
 * `clone()` do Object3D compartilha materiais — o clone por instância isola
 * os materiais do modelo aqui (precedente das texturas em `PecaPlaceholder`).
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

  // O peão reage às luzes gerando sombra (direcional + chamas das velas):
  // todos os meshes restantes projetam e recebem. O anel de seleção e a
  // hitbox invisível nascem depois, fora daqui — seguem sem sombra.
  cena.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = true
  })

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
  emGuia = false,
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

  // Destaque do selecionado: anel branco chapado no chão (sem `tone mapping`,
  // fiel à semântica em cena ACES). A casca BackSide usada no placeholder não
  // se aplica ao avatar: a geometria artística (figura não hermética) deixa o
  // branco da casca vazar por cima da textura do GLB — o anel sinaliza a
  // seleção sem tocar nos materiais do modelo (issue #297).
  const anelDeSelecao = useMemo(() => {
    if (!selecionado) return null
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(ANEL_SELECAO_INTERNO, ANEL_SELECAO_EXTERNO, 64),
      new THREE.MeshBasicMaterial(
        propsDoMaterialDeContorno(COR_CONTORNO_PEAO_SELECIONADO),
      ),
    )
    anel.rotation.x = -Math.PI / 2
    anel.position.y = 0.005
    anel.material.side = THREE.FrontSide
    anel.material.transparent = true
    anel.material.opacity = 0.9
    anel.material.depthWrite = false
    // Nunca rouba clique do corpo selecionável.
    anel.raycast = () => { }
    return anel
  }, [selecionado])

  // Anel do guia: mesmo método do anel de seleção (anel chapado no chão,
  // sem tone mapping), só o tom ciano e o raio externo mudam — sem duplicar
  // a técnica, sem animação (compatível com `frameloop="demand"` e com
  // `prefers-reduced-motion`: estático nos dois modos).
  const anelDoGuia = useMemo(() => {
    if (!emGuia) return null
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(ANEL_GUIA_INTERNO, ANEL_GUIA_EXTERNO, 64),
      new THREE.MeshBasicMaterial(
        propsDoMaterialDeContorno(COR_CONTORNO_GUIA),
      ),
    )
    anel.rotation.x = -Math.PI / 2
    anel.position.y = 0.005
    anel.material.side = THREE.FrontSide
    anel.material.transparent = true
    anel.material.opacity = 0.9
    anel.material.depthWrite = false
    // Nunca rouba clique do corpo selecionável.
    anel.raycast = () => { }
    return anel
  }, [emGuia])

  // Só interage ao ponteiro quando há handler de seleção (idêntico ao
  // PeaoPlaceholder): os meshes do modelo borbulham até o grupo pai.
  // Group cuida do cursor via padrão global handlersDeCursor; hitbox cuida do clique (evita double-fire).
  const baseCursor = handlersDeCursor(aoClicar ? 'pointer' : 'default')
  const groupHandlers = aoClicar
    ? {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        baseCursor.onPointerOver(e)
      },
      onPointerOut: baseCursor.onPointerOut,
      onPointerLeave: baseCursor.onPointerLeave,
    }
    : {}
  const hitboxClick = aoClicar
    ? (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      aoClicar()
    }
    : undefined

  return (
    <group position={position} scale={[escala, escala, escala]} {...groupHandlers}>
      <primitive object={cena} />
      {anelDeSelecao !== null ? <primitive object={anelDeSelecao} /> : null}
      {anelDoGuia !== null ? <primitive object={anelDoGuia} /> : null}
      {hitboxClick ? (
        <mesh position={[0, 0.46, 0]} onClick={hitboxClick}>
          <cylinderGeometry args={[0.56, 0.56, 0.93, 24]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}
