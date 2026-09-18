import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CorDoPeao } from './contrato'
import { slotDoAvatar, temAvatarNoSlot } from './avatares'
import { PeaoAvatar } from './PeaoAvatar'
import { PeaoPlaceholder } from './PeaoPlaceholder'
import { poseDoTremorXZ } from './ataque'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

interface PeaoVisualProps {
  cor: CorDoPeao
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando o slot é menor. */
  escala?: number
  /** Destaque por contorno branco quando este peão é o selecionado. */
  selecionado?: boolean
  /**
   * Guia de turno (issue #441): destaque ciano sobre o peão acionável do
   * passo atual — repassado ao avatar/placeholder; nunca bloqueia cliques.
   */
  emGuia?: boolean
  /** Destaque emissivo suave quando este peão é o do Jogador Ativo (#118). */
  ativo?: boolean
  /**
   * Baixa Iluminação do jogador dono (issue #297): troca o avatar 3D do
   * peão para a variante *apagado*; sem avatar no slot, é ignorado.
   */
  emBaixaIluminacao?: boolean
  /** Clique simples seleciona; sem handler, o peão é inerte ao ponteiro. */
  aoClicar?: () => void
  /**
   * Tremor do ataque (issue #385, follow-up): com a peça sob `tremor`, o peão
   * treme junto no XZ (sem pular). Com movimento reduzido, estático; inativo,
   * sem wrapper animado.
   */
  tremendo?: boolean
  /** Atraso da onda até a peça (`atrasoMs` do coreógrafo; Vulto por camadas). */
  atrasoDoTremorMs?: number
}

/**
 * Tremor do peão junto da peça (issue #385, follow-up): mesma cadência do
 * `tremor` da peça, só no XZ (o peão nunca pula). Respeita o atraso da onda;
 * com movimento reduzido, estático; ao fim, volta a zero sem marcas.
 */
function TremorDoPeao({
  ativo,
  atrasoMs,
  children,
}: {
  ativo: boolean
  atrasoMs: number
  children: ReactNode
}) {
  const grupoRef = useRef<THREE.Group | null>(null)
  const inicioRef = useRef<number>(-1)
  const invalidate = useThree((estado) => estado.invalidate)
  const reduce = usePrefersReducedMotion()
  useEffect(() => {
    inicioRef.current = -1
    if (!ativo) grupoRef.current?.position.set(0, 0, 0)
    else if (!reduce) invalidate()
  }, [ativo, atrasoMs, reduce, invalidate])
  useFrame(({ clock }) => {
    const grupo = grupoRef.current
    if (reduce || !ativo || grupo === null) return
    const agora = clock.getElapsedTime() * 1000
    if (inicioRef.current < 0) inicioRef.current = agora
    const t = agora - inicioRef.current - atrasoMs
    if (t < 0) {
      grupo.position.set(0, 0, 0)
      invalidate()
      return
    }
    const [x, z] = poseDoTremorXZ(t)
    grupo.position.set(x, 0, z)
    invalidate()
  })
  return <group ref={grupoRef}>{children}</group>
}
/**
 * Facade do peão (issue #297): os 4 slots (0 — Diretor, 1 — Enfermeira,
 * 2 — Janitor, 3 — Paciente) têm avatar 3D e renderizam o `PeaoAvatar`
 * (GLBs cacheados). O `PeaoPlaceholder` de primitivas agora é apenas o
 * fallback do `Suspense` durante o carregamento do avatar (progressivo, sem
 * flash de privilégio para quem ainda não tem os assets baixados).
 */
export function PeaoVisual({
  cor,
  position,
  escala = 1,
  selecionado = false,
  emGuia = false,
  ativo = false,
  emBaixaIluminacao = false,
  aoClicar,
  tremendo = false,
  atrasoDoTremorMs = 0,
}: PeaoVisualProps) {
  const placeholder = (
    <PeaoPlaceholder
      cor={cor}
      position={position}
      escala={escala}
      selecionado={selecionado}
      emGuia={emGuia}
      ativo={ativo}
      aoClicar={aoClicar}
    />
  )
  const slot = slotDoAvatar(cor)
  const conteudo = !temAvatarNoSlot(slot) ? (
    placeholder
  ) : (
    <Suspense fallback={placeholder}>
      <PeaoAvatar
        cor={cor}
        position={position}
        escala={escala}
        selecionado={selecionado}
        emGuia={emGuia}
        emBaixaIluminacao={emBaixaIluminacao}
        aoClicar={aoClicar}
      />
    </Suspense>
  )
  return (
    <TremorDoPeao ativo={tremendo} atrasoMs={atrasoDoTremorMs}>
      {conteudo}
    </TremorDoPeao>
  )
}
