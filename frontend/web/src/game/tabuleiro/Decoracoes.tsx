import { Suspense, useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  AJUSTES_DAS_DECORACOES,
  POSICOES_DAS_DECORACOES,
  VELA_LARGURA,
  VELA_PROFUNDIDADE,
  escalaEfetivaDaDecoracao,
  modeloDaDecoracao,
  type AjusteDaDecoracao,
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
}

/**
 * GLB normalizado na pegada (bounding box → escala uniforme de encaixe em
 * `largura × profundidade`, centralizado em XZ, base em y = 0 do grupo).
 */
function DecoracaoNormalizada({
  largura,
  profundidade,
  ajuste,
  url,
}: DecoracaoNormalizadaProps) {
  const gltf = useLoader(GLTFLoader, url)
  const { objeto, escala, deslocamento } = useMemo(() => {
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
    return { objeto, escala, deslocamento }
  }, [gltf, largura, profundidade, ajuste])

  useLayoutEffect(() => {
    const materiaisDoClone = prepararMeshesDoClone(objeto)
    return () => {
      for (const material of materiaisDoClone) material.dispose()
    }
  }, [objeto])

  return (
    <group scale={[escala, escala, escala]} rotation={[0, ajuste.rotacaoY, 0]}>
      <primitive object={objeto} position={deslocamento} />
    </group>
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
  return (
    <group position={[posicao[0], posicao[1], posicao[2]]}>
      <LimiteDeErroDoModelo
        key={url}
        resetKey={url}
        fallback={<VelaFallback />}
      >
        <Suspense fallback={<VelaFallback />}>
          <DecoracaoNormalizada
            largura={largura}
            profundidade={profundidade}
            ajuste={AJUSTES_DAS_DECORACOES[nome]}
            url={url}
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
    </group>
  )
}
