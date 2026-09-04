import {
  BORDA_OFFSET,
  BORDA_Y,
  CELULA_INSET,
  CELULA_Y_BASE,
  CELULA_Y_BORDA,
  celulaParaMundo,
  COR_BORDA_CELULA,
  ESPESSURA_BORDA,
  PEAO_Y,
  PECA_Y,
  TAMANHO_CELULA,
} from './contrato'
import type { ThreeEvent } from '@react-three/fiber'
import type {
  Celula as CelulaTipo,
  PeaoDaExibicao,
  PeaoId,
  PecaPosicionada,
} from './contrato'
import { PeaoPlaceholder } from './PeaoPlaceholder'
import { PecaPlaceholder } from './PecaPlaceholder'
import { handlersDeCursor } from './cursor'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
  /** Cursor da grade para a célula (ocupada/vazia; vazia só reage se há seleção). */
  cursor?: 'default' | 'pointer'
  /** Destaque visual da peça posicionada selecionada/em manipulação. */
  pecaDestacada?: boolean
  onClick?: (event: ThreeEvent<MouseEvent>) => void
  /** Peão posicionado sobre a peça desta célula (máx. 1 por peça). */
  peao?: PeaoDaExibicao | null
  /** Peça é destino válido do peão selecionado: destaque + cursor pointer. */
  destinoValido?: boolean
  /** Célula é alvo de pendência de Recebimento ativa (destaque sutil, #91). */
  alvoPendente?: boolean
  /**
   * Célula é vaga disponível para a pendência corrente (destaque de escolha,
   * issue #143): mesmo tom quente do alvo pendente — ambas convidam o clique
   * do ciclo — mas distinta da iluminação e da ocupação.
   */
  vagaDisponivel?: boolean
  /**
   * Célula iluminada no estado compartilhado (issue #151). Tom sutil sobre a
   * base; os destaques de seleção/pendência/ocupação têm prioridade maior.
   */
  iluminada?: boolean
  peaoSelecionadoId?: PeaoId | null
  /** Peão do Jogador Ativo da vez: destaque emissivo suave (#118). */
  peaoAtivoId?: PeaoId | null
  onSelecionarPeao?: (peaoId: PeaoId) => void
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [TAMANHO_CELULA / 2 - BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
  { pos: [-TAMANHO_CELULA / 2 + BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
]

export function Celula({
  celula,
  peca,
  cursor = 'default',
  pecaDestacada = false,
  onClick,
  peao,
  destinoValido = false,
  alvoPendente = false,
  vagaDisponivel = false,
  iluminada = false,
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  onSelecionarPeao,
}: CelulaProps) {
  const pos = celulaParaMundo(celula)
  const ocupada = Boolean(peca)
  // Destino válido (vizinho conectado ao peão selecionado, #90), alvo de
  // pendência (#91) e vaga disponível (#143) também oferecem cursor pointer;
  // compõe com o cursor da interação (#85).
  const cursorEfetivo = destinoValido || alvoPendente || vagaDisponivel ? 'pointer' : cursor
  const cursorHandlers = handlersDeCursor(cursorEfetivo)
  // Célula ocupada: clique só pela peça (evita disparo duplo plano+peca e
  // mapeamento indevido de POSICIONAR_PECA em célula ocupada). Plano fica inerte.
  const planeOnClick = ocupada ? undefined : onClick

  // Destaques do ciclo: alvo de pendência (#91) e vaga disponível para a
  // pendência corrente (#143) ganham o mesmo tom quente (ambas convidam o
  // clique do ciclo). Iluminação (#151): tom levemente mais claro que a base,
  // aplicado só quando nenhum destaque de interação/ocupação vence
  // (alvo/vaga > ocupada > iluminada).
  const corPlano = alvoPendente || vagaDisponivel
    ? '#6b5a33'
    : ocupada
      ? '#5e4e36'
      : iluminada
        ? '#3d3a30'
        : '#1b1915'
  const opacidadePlano = ocupada ? 0.82 : 0.7

  return (
    <group position={pos}>
      <mesh
        position={[0, CELULA_Y_BASE, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={planeOnClick}
        {...cursorHandlers}
      >
        <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
        <meshStandardMaterial
          color={corPlano}
          transparent
          opacity={opacidadePlano}
        />
      </mesh>
      <group position={[0, CELULA_Y_BORDA, 0]}>
        {BORDAS_CONFIG.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <boxGeometry args={b.args} />
            <meshStandardMaterial color={COR_BORDA_CELULA} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>
      {peca ? (
        <PecaPlaceholder
          tipo={peca.tipo}
          orientacao={peca.orientacao}
          position={[0, PECA_Y, 0]}
          destacada={pecaDestacada || destinoValido}
          cursor={cursorEfetivo}
          onClick={onClick}
        />
      ) : null}
      {peao ? (
        <PeaoPlaceholder
          cor={peao.cor}
          position={[0, PEAO_Y, 0]}
          selecionado={peao.peaoId === peaoSelecionadoId}
          ativo={peao.peaoId === peaoAtivoId}
          aoClicar={
            onSelecionarPeao
              ? () => onSelecionarPeao(peao.peaoId)
              : undefined
          }
        />
      ) : null}
    </group>
  )
}
