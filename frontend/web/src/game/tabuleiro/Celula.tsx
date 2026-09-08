import { Suspense, useMemo } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
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
import type {
  Celula as CelulaTipo,
  PeaoDaExibicao,
  PeaoId,
  PecaPosicionada,
} from './contrato'
import { PeaoVisual } from './PeaoVisual'
import { COR_DESTAQUE_RESGATE, PecaPlaceholder } from './PecaPlaceholder'
import { handlersDeCursor } from './cursor'
import { texturaDoTabuleiro } from './texturasDoTabuleiro'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
  /** Cursor da grade para a célula (ocupada/vazia; vazia só reage se há seleção). */
  cursor?: 'default' | 'pointer'
  /** Destaque visual da peça posicionada selecionada/em manipulação. */
  pecaDestacada?: boolean
  onClick?: (event: ThreeEvent<MouseEvent>) => void
  /**
   * Peão posicionado sobre a peça desta célula. A cena exibe um visual por
   * célula (avatar 3D no slot do Diretor, placeholder nos demais); a regra de
   * ocupação (Portão 4, resgate +1) vive no engine e no espelho de destinos
   * (`destinosConectadosDoPeao`).
   */
  peao?: PeaoDaExibicao | null
  /** Peça é destino válido do peão selecionado: destaque + cursor pointer. */
  destinoValido?: boolean
  /**
   * Destino válido que é especificamente de RESGATE (peça com peão AFETADO
   * sob teto elevado, exceção #171). Só muda o tom do destaque emissivo —
   * mesma affordância de clique (problema do `destinoValido`).
   */
  destinoResgate?: boolean
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
  /** Peão em Baixa Iluminação do dono: avatar 3D na variante apagado (#297). */
  emBaixaIluminacao?: boolean
  onSelecionarPeao?: (peaoId: PeaoId) => void
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [TAMANHO_CELULA / 2 - BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
  { pos: [-TAMANHO_CELULA / 2 + BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
]

/**
 * Relevo das paredes do grid (issue #278): mesmo ponto de partida das peças
 * (`RELEVO_TOPO_NORMAL_SCALE` em `PecaPlaceholder`) — realça o normalMap sob
 * a luz rasante da cena sem amplificar ruído além do motivo. Piso afundado
 * usa relevo menor para leitura de vazio; borda usa o ponto cheio.
 */
const RELEVO_PISO_NORMAL_SCALE: readonly [number, number] = [1.0, 1.0]
const RELEVO_BORDA_NORMAL_SCALE: readonly [number, number] = [1.1, 1.1]
const TINT_PAREDE = '#b5b5b5'

/** Texturas do grid com cor no map (sRGB) e dado linear no normal. */
function useTexturasDoTabuleiro(): {
  mapa: THREE.Texture
  normal: THREE.Texture
  mapaParede: THREE.Texture
  normalParede: THREE.Texture
} {
  const { map, normalMap } = texturaDoTabuleiro()
  const [mapCarregado, normalCarregado] = useLoader(THREE.TextureLoader, [
    map,
    normalMap,
  ])
  // Clona para não mutar o cache do useLoader (precedente das peças/Mesa).
  return useMemo(() => {
    const mapa = mapCarregado.clone()
    mapa.colorSpace = THREE.SRGBColorSpace
    mapa.wrapS = THREE.RepeatWrapping
    mapa.wrapT = THREE.RepeatWrapping
    mapa.anisotropy = 4
    mapa.needsUpdate = true
    const normal = normalCarregado.clone()
    normal.colorSpace = THREE.NoColorSpace
    normal.wrapS = THREE.RepeatWrapping
    normal.wrapT = THREE.RepeatWrapping
    normal.anisotropy = 4
    normal.needsUpdate = true
    const mapaParede = mapa.clone()
    mapaParede.center.set(0.5, 0.5)
    mapaParede.rotation = Math.PI / 2
    mapaParede.needsUpdate = true
    const normalParede = normal.clone()
    normalParede.center.set(0.5, 0.5)
    normalParede.rotation = Math.PI / 2
    normalParede.needsUpdate = true
    return { mapa, normal, mapaParede, normalParede }
  }, [mapCarregado, normalCarregado])
}

interface SuperficiesProps {
  corPlano: string
  opacidadePlano: number
  planeOnClick?: (event: ThreeEvent<MouseEvent>) => void
  cursorHandlers: ReturnType<typeof handlersDeCursor>
}

/**
 * Paredes do grid texturizadas (plano + 4 bordas, issue #278): o `color`
 * multiplica o map, então os tons do ciclo (base/iluminada/ocupada/alvo-vaga)
 * seguem vivos sobre a escuridão — mesma affordância, só com relevo.
 */
function SuperficiesTexturizadas({
  corPlano,
  opacidadePlano,
  planeOnClick,
  cursorHandlers,
}: SuperficiesProps) {
  const { mapa, normal, mapaParede, normalParede } = useTexturasDoTabuleiro()
  return (
    <>
      <mesh
        position={[0, CELULA_Y_BASE, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={planeOnClick}
        {...cursorHandlers}
      >
        <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
        <meshStandardMaterial
          color={corPlano}
          map={mapa}
          normalMap={normal}
          normal-scale={RELEVO_PISO_NORMAL_SCALE}
          roughness={0.95}
          metalness={0}
          transparent
          opacity={opacidadePlano}
          toneMapped={false}
        />
      </mesh>
      <group position={[0, CELULA_Y_BORDA, 0]}>
        {BORDAS_CONFIG.map((b, i) => (
          <mesh key={i} position={b.pos}>
            <boxGeometry args={b.args} />
            <meshStandardMaterial
              color={TINT_PAREDE}
              map={mapaParede}
              normalMap={normalParede}
              normal-scale={RELEVO_BORDA_NORMAL_SCALE}
              roughness={0.95}
              metalness={0}
              transparent
              opacity={0.95}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </>
  )
}

/** Fallback de suspensão: cores chapadas atuais (sem textura). */
function SuperficiesFallback({
  corPlano,
  opacidadePlano,
  planeOnClick,
  cursorHandlers,
}: SuperficiesProps) {
  return (
    <>
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
    </>
  )
}

export function Celula({
  celula,
  peca,
  cursor = 'default',
  pecaDestacada = false,
  onClick,
  peao,
  destinoValido = false,
  destinoResgate = false,
  alvoPendente = false,
  vagaDisponivel = false,
  iluminada = false,
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  emBaixaIluminacao = false,
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
  const superficies: SuperficiesProps = {
    corPlano,
    opacidadePlano,
    planeOnClick,
    cursorHandlers,
  }

  return (
    <group position={pos}>
      <Suspense fallback={<SuperficiesFallback {...superficies} />}>
        <SuperficiesTexturizadas {...superficies} />
      </Suspense>
      {peca ? (
        <PecaPlaceholder
          tipo={peca.tipo}
          orientacao={peca.orientacao}
          position={[0, PECA_Y, 0]}
          destacada={pecaDestacada || destinoValido}
          corDestaque={destinoResgate ? COR_DESTAQUE_RESGATE : undefined}
          cursor={cursorEfetivo}
          onClick={onClick}
        />
      ) : null}
      {peao ? (
        <PeaoVisual
          cor={peao.cor}
          position={[0, PEAO_Y, 0]}
          selecionado={peao.peaoId === peaoSelecionadoId}
          ativo={peao.peaoId === peaoAtivoId}
          emBaixaIluminacao={emBaixaIluminacao}
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
