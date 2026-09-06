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

type MaterialComOrigem = {
  mat: THREE.MeshStandardMaterial
  opacityOriginal: number
}

function PecaSaindo({ peca, inicioMs, onFim }: SaindoProps) {
  const groupRef = useRef<THREE.Group>(null)
  const materiaisRef = useRef<MaterialComOrigem[]>([])
  const invalidate = useThree((s) => s.invalidate)
  const jaFinalizou = useRef(false)

  const pos = celulaParaMundo(peca.celula)

  // Coleta TODOS os materiais no mount, força transparent e guarda opacity
  // original para que base (0.88) e trilhas opacas (1) desvanecam juntas sem pop.
  // Clona por instância para não vazar mutação para outras peças.
  useEffect(() => {
    if (!groupRef.current) return
    const mats: MaterialComOrigem[] = []
    groupRef.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh
        const matOriginal = mesh.material as THREE.MeshStandardMaterial
        // Clona para isolar esta instância (evita vazar transparent/opacity)
        const mat = matOriginal.clone() as THREE.MeshStandardMaterial
        mesh.material = mat
        const opacityOriginal = mat.opacity
        mat.transparent = true
        // Garante que needsUpdate reflita a mudança de transparent
        mat.needsUpdate = true
        mats.push({ mat, opacityOriginal })
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
    for (const { mat, opacityOriginal } of materiaisRef.current) {
      mat.opacity = opacityOriginal * (1 - eased)
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
  const invalidate = useThree((s) => s.invalidate)

  // Trigger precisa ver o mapa ANTERIOR (antes da remoção). Este effect vem
  // ANTES do que atualiza o mapa a partir de `posicionadas` — quando ambos
  // mudam no mesmo commit, este roda primeiro com o mapa ainda pré-remoção.
  useEffect(() => {
    if (!trigger || trigger.pecasRemovidas.length === 0) return

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
      // Arranque com frameloop="demand": sem invalidate explícito o primeiro
      // tick do useFrame pode nunca acontecer e a animação congela no quadro 1.
      invalidate()
    }
  }, [trigger, reduce, invalidate])

  // Mantém mapa atualizado para o próximo trigger. Vem DEPOIS do trigger
  // para não sobrescrever o snapshot pré-remoção no mesmo commit.
  useEffect(() => {
    const map = new Map<string, PecaPosicionada>()
    for (const p of posicionadas) map.set(p.pecaId, p)
    posicionadasPorIdRef.current = map
  }, [posicionadas])

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
