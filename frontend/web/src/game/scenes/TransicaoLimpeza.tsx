import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { celulaParaMundo } from '../tabuleiro/contrato'
import type { PecaPosicionada } from '../tabuleiro/contrato'
import { PecaPlaceholder } from '../tabuleiro/PecaPlaceholder'
import {
  CAMINHO_SOM_SOMBRIO_LIMPEZA,
  DURACAO_FADE_LIMPEZA_MS,
  easeOutCubic,
} from '../tabuleiro/animacao'
import { tocarSom } from '../audio/sons'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

interface SaindoProps {
  peca: PecaPosicionada
  inicioMs: number
  onFim: (pecaId: string) => void
}

function PecaSaindo({ peca, inicioMs, onFim }: SaindoProps) {
  const groupRef = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  const jaFinalizou = useRef(false)

  useFrame(() => {
    if (!groupRef.current) return
    const agora = performance.now()
    const t = Math.min(1, (agora - inicioMs) / DURACAO_FADE_LIMPEZA_MS)
    const eased = easeOutCubic(t)
    // encolhimento 1 → 0.7 e fade 0.88 → 0
    const escala = 1 - 0.3 * eased
    groupRef.current.scale.set(escala, escala, escala)
    // opacidade via traverse nos materiais
    groupRef.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.transparent) {
          mat.opacity = 0.88 * (1 - eased)
        }
      }
    })
    invalidate()
    if (t >= 1 && !jaFinalizou.current) {
      jaFinalizou.current = true
      onFim(peca.pecaId)
    }
  })

  const pos = celulaParaMundo(peca.celula)

  return (
    <group ref={groupRef} position={pos as [number, number, number]}>
      <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} />
    </group>
  )
}

interface TransicaoLimpezaProps {
  posicionadas: readonly PecaPosicionada[]
}

/**
 * Transição de limpeza — fade out + encolher na névoa (issue #239).
 * Vive no ponto mais alto (cena do ambiente), disparada pela mesma mudança
 * de `posicionadas` que o reducer já aplica; estado final pixel-igual.
 * Som único por comando de limpeza, reduce = snap instantâneo.
 */
export function TransicaoLimpeza({ posicionadas }: TransicaoLimpezaProps) {
  const reduce = usePrefersReducedMotion()
  const prevRef = useRef<readonly PecaPosicionada[]>(posicionadas)
  const [saindo, setSaindo] = useState<readonly (PecaPosicionada & { inicioMs: number })[]>([])

  useEffect(() => {
    const prev = prevRef.current
    const removidas = prev.filter(
      (p) => !posicionadas.some((c) => c.pecaId === p.pecaId),
    )

    if (removidas.length > 0) {
      // Som único por comando, qualquer quantidade; com reduce também soa
      tocarSom(CAMINHO_SOM_SOMBRIO_LIMPEZA)

      if (!reduce) {
        const agora = performance.now()
        setSaindo((atuais) => [
          ...atuais,
          ...removidas.map((p) => ({ ...p, inicioMs: agora })),
        ])
      }
      // com reduce: snap instantâneo — não adiciona em saindo, deixa o filter do reducer dominar
    }

    prevRef.current = posicionadas
  }, [posicionadas, reduce])

  const remover = (pecaId: string) => {
    setSaindo((atuais) => atuais.filter((p) => p.pecaId !== pecaId))
  }

  if (saindo.length === 0) return null

  return (
    <>
      {saindo.map((peca) => (
        <PecaSaindo key={peca.pecaId} peca={peca} inicioMs={peca.inicioMs} onFim={remover} />
      ))}
    </>
  )
}
