import { Suspense, useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  AJUSTES_DAS_DECORACOES,
  ALGEMAS_LARGURA,
  ALGEMAS_PROFUNDIDADE,
  POSICOES_DAS_DECORACOES,
  VELA_LARGURA,
  VELA_PROFUNDIDADE,
  escalaEfetivaDaDecoracao,
  luzDaChama,
  modeloDaDecoracao,
  type AjusteDaDecoracao,
  type LuzDaChama,
  type NomeDaDecoracao,
} from './decoracoesDaMesa'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'

/**
 * Primitiva da vela enquanto o GLB carrega ou se falhar: a cena nunca quebra.
 * Toco cilíndrico escuro coerente com o sanatório (sem luz própria — a
 * iluminação da cena já modela o volume).
 */
function VelaFallback() {
  return (
    <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.22, 0.26, 0.5, 12]} />
      <meshStandardMaterial color="#2a2320" />
    </mesh>
  )
}

/**
 * Primitiva genérica enquanto o GLB carrega ou se falhar (decorações sem
 * fallback próprio): volume baixo e escuro, coerente com o sanatório.
 */
function DecoracaoGenericaFallback() {
  return (
    <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.9, 0.16, 0.6]} />
      <meshStandardMaterial color="#241f1c" />
    </mesh>
  )
}

/**
 * Prepara os meshes do clone para mutação segura (precedente de `Caixa.tsx`):
 * clona cada material compartilhado do cache do `useLoader` antes de mutar,
 * desliga o tone mapping e o raycast decorativo. Idempotente via `userData`.
 * Decorativo nunca intercepta clique: o clique atravessa para a Mesa (que
 * desseleciona) — a vela não rouba `onClick` de peças/peões/bandeja.
 */
function prepararMeshesDoClone(objeto: THREE.Object3D): THREE.Material[] {
  const materiaisDoClone: THREE.Material[] = []
  objeto.traverse((filho) => {
    if (filho instanceof THREE.Mesh) {
      const atual = filho.material
      const lista = (Array.isArray(atual) ? atual : [atual]).map((m) => {
        if (m.userData.__cloneDecoracao === true) return m
        const clonado = m.clone()
        clonado.toneMapped = false
        clonado.userData.__cloneDecoracao = true
        return clonado
      })
      filho.material = (
        Array.isArray(atual) ? lista : lista[0]
      ) as THREE.Mesh['material']
      filho.raycast = () => null
      filho.castShadow = true
      filho.receiveShadow = true
      materiaisDoClone.push(...lista)
    }
  })
  return materiaisDoClone
}

interface DecoracaoNormalizadaProps {
  largura: number
  profundidade: number
  ajuste: AjusteDaDecoracao
  url: string
  /** Ponto de luz da chama (`null` = sem chama). */
  luz: LuzDaChama | null
}

/**
 * GLB normalizado na pegada (bounding box → escala uniforme de encaixe em
 * `largura × profundidade`, centralizado em XZ, base em y = 0 do grupo).
 * Com `luz`, um `pointLight` estático nasce acima do topo do modelo (a altura
 * deriva de `tamanho.y × escala`, então acompanha `AJUSTES` sozinha) e, com
 * `luz.sombra`, projeta a sombra dos elementos ao redor (cube map, no padrão
 * das props de sombra da direcional em `AmbienteCena`). Sem raycast — luz não
 * intercepta clique. Estático: compatível com `frameloop="demand"`.
 */
function DecoracaoNormalizada({
  largura,
  profundidade,
  ajuste,
  url,
  luz,
}: DecoracaoNormalizadaProps) {
  const gltf = useLoader(GLTFLoader, url)
  const { objeto, escala, deslocamento, topo } = useMemo(() => {
    const objeto = gltf.scene.clone(true)
    const caixa = new THREE.Box3().setFromObject(objeto)
    const tamanho = caixa.getSize(new THREE.Vector3())
    const centro = caixa.getCenter(new THREE.Vector3())
    const escala = escalaEfetivaDaDecoracao(
      largura,
      profundidade,
      tamanho,
      ajuste,
    )
    const deslocamento: [number, number, number] = [
      -centro.x,
      -caixa.min.y,
      -centro.z,
    ]
    // Topo do modelo em unidades de mundo (base em y = 0): a lâmpada fica
    // `folgaAcimaDoTopo` acima dele — fora da geometria, sem ajuste manual.
    const topo = tamanho.y * escala
    return { objeto, escala, deslocamento, topo }
  }, [gltf, largura, profundidade, ajuste])

  useLayoutEffect(() => {
    const materiaisDoClone = prepararMeshesDoClone(objeto)
    return () => {
      for (const material of materiaisDoClone) material.dispose()
    }
  }, [objeto])

  // Props de sombra do cube map (só com `luz.sombra`): a chama passa a
  // reagir aos elementos ao redor — Caixa, peças e peões projetam sombra sob
  // ela. `castShadow` desligado sem config: luz sem sombra, sem custo.
  const sombraProps =
    luz?.sombra != null
      ? {
          castShadow: true as const,
          'shadow-mapSize': [
            luz.sombra.tamanhoDoMapa,
            luz.sombra.tamanhoDoMapa,
          ] as [number, number],
          'shadow-camera-near': luz.sombra.near,
          'shadow-camera-far': luz.sombra.far,
          'shadow-bias': luz.sombra.bias,
        }
      : {}

  return (
    <>
      <group scale={[escala, escala, escala]} rotation={[0, ajuste.rotacaoY, 0]}>
        <primitive object={objeto} position={deslocamento} />
      </group>
      {luz ? (
        <pointLight
          position={[0, topo + luz.folgaAcimaDoTopo, 0]}
          color={luz.cor}
          intensity={luz.intensidade}
          distance={luz.distancia}
          decay={luz.decaimento}
          {...sombraProps}
        />
      ) : null}
    </>
  )
}

function Decoracao({
  nome,
  largura,
  profundidade,
}: {
  nome: NomeDaDecoracao
  largura: number
  profundidade: number
}) {
  const posicao = POSICOES_DAS_DECORACOES[nome]
  const url = modeloDaDecoracao(nome)
  const fallback = nome === 'vela' ? <VelaFallback /> : <DecoracaoGenericaFallback />
  return (
    <group position={[posicao[0], posicao[1], posicao[2]]}>
      <LimiteDeErroDoModelo
        key={url}
        resetKey={url}
        fallback={fallback}
      >
        <Suspense fallback={fallback}>
          <DecoracaoNormalizada
            largura={largura}
            profundidade={profundidade}
            ajuste={AJUSTES_DAS_DECORACOES[nome]}
            url={url}
            luz={luzDaChama(nome)}
          />
        </Suspense>
      </LimiteDeErroDoModelo>
    </group>
  )
}

/**
 * Decorações da Mesa: objetos 3D puramente visuais sobre o plano superior
 * (y = 0). Sem estado, sem clique, sem wire — só atmosfera. Com sombra
 * (castShadow + receiveShadow) e sem raycast, no padrão da Caixa.
 */
export function DecoracoesDaMesa() {
  return (
    <group>
      <Decoracao
        nome="vela"
        largura={VELA_LARGURA}
        profundidade={VELA_PROFUNDIDADE}
      />
      <Decoracao
        nome="algemas"
        largura={ALGEMAS_LARGURA}
        profundidade={ALGEMAS_PROFUNDIDADE}
      />
    </group>
  )
}
