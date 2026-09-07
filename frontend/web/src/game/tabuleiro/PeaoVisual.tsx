import { Suspense } from 'react'
import type { CorDoPeao } from './contrato'
import { slotDoAvatar, temAvatarNoSlot } from './avatares'
import { PeaoAvatar } from './PeaoAvatar'
import { PeaoPlaceholder } from './PeaoPlaceholder'

interface PeaoVisualProps {
  cor: CorDoPeao
  position?: [number, number, number]
  /** Escala uniforme; mantém a silhueta em proporção quando o slot é menor. */
  escala?: number
  /** Destaque por contorno branco quando este peão é o selecionado. */
  selecionado?: boolean
  /** Destaque emissivo suave quando este peão é o do Jogador Ativo (#118). */
  ativo?: boolean
  /**
   * Baixa Iluminação do jogador dono (issue #297): troca o avatar 3D do
   * Diretor para a variante *apagado*; sem avatar no slot, é ignorado.
   */
  emBaixaIluminacao?: boolean
  /** Clique simples seleciona; sem handler, o peão é inerte ao ponteiro. */
  aoClicar?: () => void
}

/**
 * Facade do peão (issue #297): slot com avatar 3D (Diretor, slot 0 —
 * Enfermeira, slot 1 — Janitor, slot 2) renderiza o `PeaoAvatar` (GLBs
 * cacheados); apenas o slot 3 (Paciente, issue #299) segue no
 * `PeaoPlaceholder` de primitivas — sem baixar os GLBs. O placeholder também
 * cobre a suspensão do carregamento do avatar (progressivo, sem flash de
 * privilégio para quem não tem os assets ainda).
 */
export function PeaoVisual({
  cor,
  position,
  escala = 1,
  selecionado = false,
  ativo = false,
  emBaixaIluminacao = false,
  aoClicar,
}: PeaoVisualProps) {
  const placeholder = (
    <PeaoPlaceholder
      cor={cor}
      position={position}
      escala={escala}
      selecionado={selecionado}
      ativo={ativo}
      aoClicar={aoClicar}
    />
  )
  const slot = slotDoAvatar(cor)
  if (!temAvatarNoSlot(slot)) return placeholder
  return (
    <Suspense fallback={placeholder}>
      <PeaoAvatar
        cor={cor}
        position={position}
        escala={escala}
        selecionado={selecionado}
        emBaixaIluminacao={emBaixaIluminacao}
        aoClicar={aoClicar}
      />
    </Suspense>
  )
}
