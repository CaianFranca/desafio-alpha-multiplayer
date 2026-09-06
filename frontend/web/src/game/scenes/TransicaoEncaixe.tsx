import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PecaPosicionada } from '../tabuleiro/contrato'
import { PecaPlaceholder } from '../tabuleiro/PecaPlaceholder'
import { DURACAO_ENCAIXE_MS, easeOutCubic } from '../tabuleiro/animacao'
import {
  posicaoMundoDaOrigemDoEncaixe,
  posicaoMundoDoDestinoDoEncaixe,
} from '../tabuleiro/encaixe'
import type { EncaixeTrigger } from '../tabuleiro/encaixe'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

interface VooProps {
  peca: PecaPosicionada
  origemPos: [number, number, number]
  destinoPos: [number, number, number]
  onFim: () => void
}

function PecaEmVoo({ peca, origemPos, destinoPos, onFim }: VooProps) {
  const groupRef = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  const jaFinalizou = useRef(false)
  // Início do voo fixado na montagem (remonta a cada trigger por key): um
  // update de `posicionadas` no meio do voo re-renderiza sem reiniciar.
  const [inicioMs] = useState(() => performance.now())

  useFrame(() => {
    if (!groupRef.current) return
    const agora = performance.now()
    const t = Math.min(1, (agora - inicioMs) / DURACAO_ENCAIXE_MS)
    const eased = easeOutCubic(t)
    groupRef.current.position.set(
      origemPos[0] + (destinoPos[0] - origemPos[0]) * eased,
      origemPos[1] + (destinoPos[1] - origemPos[1]) * eased,
      origemPos[2] + (destinoPos[2] - origemPos[2]) * eased,
    )
    invalidate()
    if (t >= 1 && !jaFinalizou.current) {
      jaFinalizou.current = true
      onFim()
    }
  })

  return (
    <group ref={groupRef} position={origemPos}>
      <PecaPlaceholder tipo={peca.tipo} orientacao={peca.orientacao} />
    </group>
  )
}

interface TransicaoEncaixeProps {
  posicionadas: readonly PecaPosicionada[]
  trigger?: EncaixeTrigger | null
  onFim?: (key: number) => void
}

/**
 * Transição de Encaixe — voo mesa→célula (issue #241, spec #238).
 * Vive no ponto mais alto (cena do ambiente), disparada pelo **evento**
 * `PECA_POSICIONADA` (trigger com pecaId + origem + célula + key) — nunca
 * por diff de `posicionadas` (evita voo fantasma em snapshot/reconexão).
 * O tabuleiro esconde a peça em voo (prop `ocultarPecaId`); ao fim, o
 * overlay some e a peça do tabuleiro assume pixel-igual. Reduce = snap
 * (sem overlay, trigger limpo de imediato).
 */
export function TransicaoEncaixe({ posicionadas, trigger = null, onFim }: TransicaoEncaixeProps) {
  const reduce = usePrefersReducedMotion()
  const invalidate = useThree((s) => s.invalidate)

  // Derivação pura do voo (sem estado): o tipo/orientação vêm do modelo
  // pós-despacho (o delta já assentou a peça). Null = sem voo.
  const voo = useMemo(() => {
    if (!trigger || reduce) return null
    const peca = posicionadas.find((p) => p.pecaId === trigger.pecaId)
    if (!peca) return null
    return {
      peca,
      origemPos: posicaoMundoDaOrigemDoEncaixe(trigger.origem, trigger.indiceNaMesa),
      destinoPos: posicaoMundoDoDestinoDoEncaixe(trigger.celula),
    }
  }, [trigger, reduce, posicionadas])

  // Arranque com frameloop="demand": sem invalidate explícito o primeiro
  // tick do useFrame pode nunca acontecer e a animação congela no quadro 1.
  useEffect(() => {
    if (voo) invalidate()
  }, [voo, invalidate])

  // Sem voo com trigger ativo (reduce ou peça sem tipo conhecido): limpa o
  // trigger para não prender a peça oculta — o estado final já renderizou.
  useEffect(() => {
    if (trigger && !voo) onFim?.(trigger.key)
  }, [trigger, voo, onFim])

  if (!voo || !trigger) return null

  return (
    <PecaEmVoo
      key={trigger.key}
      peca={voo.peca}
      origemPos={voo.origemPos}
      destinoPos={voo.destinoPos}
      onFim={() => onFim?.(trigger.key)}
    />
  )
}
