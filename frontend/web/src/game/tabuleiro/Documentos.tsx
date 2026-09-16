import { Suspense, useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import {
  COR_BORDA_DO_PAPEL,
  DIMENSOES_DOS_DOCUMENTOS,
  ESPESSURA_DO_DOCUMENTO,
  INSTANCIAS_DOS_DOCUMENTOS,
  texturaDoDocumento,
  type InstanciaDeDocumento,
} from './decoracoesDaMesa'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'

/**
 * Página largada enquanto a textura carrega: lâmina de papel sem impressão,
 * na mesma pegada — o layout da Mesa já aparece correto antes da textura.
 */
function PaginaEmBranco({ instancia }: { instancia: InstanciaDeDocumento }) {
  const { largura, profundidade } = DIMENSOES_DOS_DOCUMENTOS[instancia.tipo]
  const [x, y, z] = instancia.posicao
  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, instancia.rotacaoY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[largura, ESPESSURA_DO_DOCUMENTO, profundidade]} />
      <meshStandardMaterial color={COR_BORDA_DO_PAPEL} roughness={0.9} />
    </mesh>
  )
}

function Pagina({ instancia }: { instancia: InstanciaDeDocumento }) {
  const url = texturaDoDocumento(instancia.tipo)
  const { largura, profundidade } = DIMENSOES_DOS_DOCUMENTOS[instancia.tipo]
  const [x, y, z] = instancia.posicao
  const carregada = useLoader(THREE.TextureLoader, url)
  // Cópia com espaço de cor sRGB: o topo da página é cor, não dado linear.
  // Clonar evita mutar a textura cacheada pelo useLoader.
  const mapa = useMemo(() => {
    const copia = carregada.clone()
    copia.colorSpace = THREE.SRGBColorSpace
    copia.needsUpdate = true
    return copia
  }, [carregada])

  useLayoutEffect(() => {
    return () => {
      mapa.dispose()
    }
  }, [mapa])

  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, instancia.rotacaoY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[largura, ESPESSURA_DO_DOCUMENTO, profundidade]} />
      {/* Lâmina: face +y (índice 2) recebe a textura; as demais são o corte
          do papel. O clique borbulha ao grupo da cena e desseleciona, como
          o clique direto na Mesa. */}
      <meshStandardMaterial attach="material-0" color={COR_BORDA_DO_PAPEL} />
      <meshStandardMaterial attach="material-1" color={COR_BORDA_DO_PAPEL} />
      <meshStandardMaterial
        attach="material-2"
        map={mapa}
        roughness={0.9}
      />
      <meshStandardMaterial attach="material-3" color={COR_BORDA_DO_PAPEL} />
      <meshStandardMaterial attach="material-4" color={COR_BORDA_DO_PAPEL} />
      <meshStandardMaterial attach="material-5" color={COR_BORDA_DO_PAPEL} />
    </mesh>
  )
}

/**
 * Documentos largados na Mesa: páginas 3D (lâmina fina + textura no topo),
 * sem GLB. Sem estado, sem wire — só atmosfera. Enquanto a textura carrega
 * ou se falhar, a página segue em branco (papel sem impressão): a cena nunca
 * quebra e o layout se mantém.
 */
export function DocumentosDaMesa() {
  return (
    <group>
      {INSTANCIAS_DOS_DOCUMENTOS.map((instancia, indice) => {
        const url = texturaDoDocumento(instancia.tipo)
        return (
          <LimiteDeErroDoModelo
            key={`${url}#${indice}`}
            resetKey={url}
            fallback={<PaginaEmBranco instancia={instancia} />}
          >
            <Suspense fallback={<PaginaEmBranco instancia={instancia} />}>
              <Pagina instancia={instancia} />
            </Suspense>
          </LimiteDeErroDoModelo>
        )
      })}
    </group>
  )
}
