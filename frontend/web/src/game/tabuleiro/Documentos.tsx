import { Suspense, useLayoutEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import {
  INSTANCIAS_DOS_DOCUMENTOS,
  PARAMETROS_DO_CARTAO,
  parametrosDaPagina,
  type ParametrosDaLamina,
} from './decoracoesDaMesa'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'

/**
 * Lâmina sem impressão enquanto a textura carrega: mesma pegada, sem
 * textura — o layout da Mesa já aparece correto antes dela.
 */
function LaminaEmBranco({ parametros }: { parametros: ParametrosDaLamina }) {
  const [x, y, z] = parametros.posicao
  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, parametros.rotacaoY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry
        args={[parametros.largura, parametros.espessura, parametros.profundidade]}
      />
      <meshStandardMaterial color={parametros.corBorda} roughness={0.9} />
    </mesh>
  )
}

function Lamina({ parametros }: { parametros: ParametrosDaLamina }) {
  const carregada = useLoader(THREE.TextureLoader, parametros.url)
  // Cópia com espaço de cor sRGB: o topo da lâmina é cor, não dado linear.
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

  const [x, y, z] = parametros.posicao
  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, parametros.rotacaoY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry
        args={[parametros.largura, parametros.espessura, parametros.profundidade]}
      />
      {/* Lâmina: face +y (índice 2) recebe a textura; as demais são a borda.
          O clique borbulha ao grupo da cena e desseleciona, como o clique
          direto na Mesa. */}
      <meshStandardMaterial attach="material-0" color={parametros.corBorda} />
      <meshStandardMaterial attach="material-1" color={parametros.corBorda} />
      <meshStandardMaterial
        attach="material-2"
        map={mapa}
        roughness={0.9}
      />
      <meshStandardMaterial attach="material-3" color={parametros.corBorda} />
      <meshStandardMaterial attach="material-4" color={parametros.corBorda} />
      <meshStandardMaterial attach="material-5" color={parametros.corBorda} />
    </mesh>
  )
}

function LaminaComTextura({
  chave,
  parametros,
}: {
  chave: string
  parametros: ParametrosDaLamina
}) {
  return (
    <LimiteDeErroDoModelo
      key={chave}
      resetKey={parametros.url}
      fallback={<LaminaEmBranco parametros={parametros} />}
    >
      <Suspense fallback={<LaminaEmBranco parametros={parametros} />}>
        <Lamina parametros={parametros} />
      </Suspense>
    </LimiteDeErroDoModelo>
  )
}

/**
 * Documentos largados na Mesa: páginas 3D (lâmina fina + textura no topo) e
 * o cartão de acesso sobre o horizontal do canto inferior direito, sem GLB.
 * Sem estado, sem wire — só atmosfera. Enquanto a textura carrega ou se
 * falhar, a lâmina segue em branco: a cena nunca quebra e o layout se mantém.
 */
export function DocumentosDaMesa() {
  return (
    <group>
      {INSTANCIAS_DOS_DOCUMENTOS.map((instancia, indice) => (
        <LaminaComTextura
          key={`${instancia.tipo}#${indice}`}
          chave={`${instancia.tipo}#${indice}`}
          parametros={parametrosDaPagina(instancia)}
        />
      ))}
      <LaminaComTextura chave="cartao" parametros={PARAMETROS_DO_CARTAO} />
    </group>
  )
}
