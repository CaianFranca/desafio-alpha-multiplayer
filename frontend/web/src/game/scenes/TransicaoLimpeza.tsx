import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { celulaParaMundo } from '../tabuleiro/contrato'
import type { PecaPosicionada } from '../tabuleiro/contrato'
import { PecaPlaceholder } from '../tabuleiro/PecaPlaceholder'
import { DURACAO_FADE_LIMPEZA_MS, easeOutCubic } from '../tabuleiro/animacao'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

interface SaindoProps {
  peca: PecaPosicionada
  inicioMs: number
  onFim: (pecaId: string) => void
}

function PecaSaindo({ peca, inicioMs, onFim }: SaindoProps) {
  const groupRef = useRef<THREE.Group>(null)
  const materiaisRef = useRef<THREE.MeshStandardMaterial[]>([])
  const invalidate = useThree((s) => s.invalidate)
  const jaFinalizou = useRef(false)

  const pos = celulaParaMundo(peca.celula)

  // Coleta materiais uma vez no mount para evitar traverse a cada quadro (B3)
  useEffect(() => {
    if (!groupRef.current) return
    const mats: THREE.MeshStandardMaterial[] = []
    groupRef.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.transparent) mats.push(mat)
      }
    })
    materiaisRef.current = mats
  }, [])

  useFrame(() => {
    if (!groupRef.current) return
    const agora = performance.now()
    const t = Math.min(1, (agora - inicioMs) / DURACAO_FADE_LIMPEZA_MS)
    const eased = easeOutCubic(t)
    const escala = 1 - 0.3 * eased
    groupRef.current.scale.set(escala, escala, escala)
    for (const mat of materiaisRef.current) {
      mat.opacity = 0.88 * (1 - eased)
    }
    invalidate()
    if (t >= 1 && !jaFinalizou.current) {
      jaFinalizou.current = true
      onFim(peca.pecaId)
    }
  })

  return (
    <group ref={groupRef} position={pos as [number, number, number]}>
      <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} />
    </group>
  )
}

export interface LimpezaTrigger {
  readonly pecasRemovidas: readonly string[]
  readonly key: number
}

interface TransicaoLimpezaProps {
  posicionadas: readonly PecaPosicionada[]
  trigger?: LimpezaTrigger | null
}

/**
 * Transição de limpeza — fade out + encolher na névoa (issue #239).
 * Vive no ponto mais alto (cena do ambiente), disparada pelo **evento**
 * `LIMPEZA_APLICADA` (trigger com pecasRemovidas + key) — nunca por diff
 * de `posicionadas` (evita som fantasma em snapshot/reconexão, B1).
 * Estado final pixel-igual ao reducer; som único por comando; reduce = snap.
 */
export function TransicaoLimpeza({ posicionadas, trigger = null }: TransicaoLimpezaProps) {
  const reduce = usePrefersReducedMotion()
  const posicionadasPorIdRef = useRef<Map<string, PecaPosicionada>>(new Map())
  const [saindo, setSaindo] = useState<readonly (PecaPosicionada & { inicioMs: number })[]>([])

  // Mantém mapa atualizado APÓS o trigger (ordem de efeitos garante que o
  // trigger veja o mapa antigo com as peças removidas)
  useEffect(() => {
    const map = new Map<string, PecaPosicionada>()
    for (const p of posicionadas) map.set(p.pecaId, p)
    posicionadasPorIdRef.current = map
  }, [posicionadas])

  useEffect(() => {
    if (!trigger || trigger.pecasRemovidas.length === 0) return

    // Lookup das peças removidas no mapa ANTERIOR (ainda não atualizado pelo segundo effect)
    const removidas: PecaPosicionada[] = []
    for (const id of trigger.pecasRemovidas) {
      const p = posicionadasPorIdRef.current.get(id)
      if (p) removidas.push(p)
    }
    if (removidas.length === 0) return

    if (!reduce) {
      const agora = performance.now()
      setSaindo((atuais) => [
        ...atuais,
        ...removidas.map((p) => ({ ...p, inicioMs: agora })),
      ])
    }
  }, [trigger, reduce])

  const remover = (pecaId: string) => {
    setSaindo((atuais) => atuais.filter((p) => p.pecaId !== pecaId))
  }

  if (saindo.length === 0) return null

  return (
    <>
      {saindo.map((peca) => (
        <PecaSaindo key={`${peca.pecaId}-${peca.inicioMs}`} peca={peca} inicioMs={peca.inicioMs} onFim={remover} />
      ))}
    </>
  )
}
