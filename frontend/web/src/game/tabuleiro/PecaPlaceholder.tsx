import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { TAMANHO_CELULA } from './contrato'
import type { TipoDaPeca, Orientacao } from './contrato'
import {
  COR_CONTORNO_ESCUDO_ATAQUE,
  COR_CONTORNO_PULO_ATAQUE,
  COR_CONTORNO_TREMOR_ATAQUE,
  EXPANSAO_CONTORNO_PECA_XZ,
  corDoContornoDaPeca,
  propsDoMaterialDeContorno,
} from './contorno'
import {
  COR_FLASH_DISPARO_ATAQUE,
  COR_TELEGRAPH_ATAQUE,
  DURACAO_DISPARO_ATAQUE_MS,
} from './animacao'
import type { ReacaoDePecaNoAtaque } from './ataque'
import { poseDoTremorXZ } from './ataque'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { handlersDeCursor } from './cursor'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'
import { MonstroAvatar } from './MonstroAvatar'
import { temModeloDeMonstro } from './monstros'
import { rotacaoDoMotivo, texturaDaPeca } from './texturasDasPecas'

interface PecaPlaceholderProps {
  tipo: TipoDaPeca
  orientacao: Orientacao
  position?: [number, number, number]
  /** Destaque visual da peça selecionada/em manipulação. */
  destacada?: boolean
  /**
   * Tom do contorno de destaque (default `COR_DESTAQUE` quente). Destino de
   * resgate passa `COR_DESTAQUE_RESGATE` — sóbria, sem arte nova.
   */
  corDestaque?: string
  /** Cursor do ponteiro ao pairar (peça da mesa selecionável). */
  cursor?: 'default' | 'pointer'
  /**
   * Telegraph do ataque (issue #385): contorno vermelho pulsante na peça do
   * monstro durante o pulso silencioso de 1s — apaga ao entrar no disparo e
   * ao drenar (sem marcas). Sobrepõe o destaque de seleção no tom.
   */
  emTelegraph?: boolean
  /**
   * Reação da peça no alcance do ataque (issue #385, follow-up): duplo
   * feedback com os chips do overlay (mantidos como legenda) — `pulo` (sem
   * peão, sem sair da célula), `tremor` (com peão, o peão treme junto via
   * `PeaoVisual`) e `escudo` (protegido: só a casca azul, sem tremor). Null =
   * sem reação. Com movimento reduzido, sem deslocamento (só o escudo
   * estático); ao drenar, volta a null sem marcas.
   */
  reacaoDoAtaque?: ReacaoDePecaNoAtaque | null
  /** Atraso da onda até esta peça (`atrasoMs` do coreógrafo; Vulto por camadas). */
  atrasoDoAtaqueMs?: number
  /**
   * Gesto de disparo do atacante (issue #385, follow-up): pulso de escala +
   * flash emissivo com o ciclo do token `DURACAO_DISPARO_ATAQUE_MS` (~250ms)
   * enquanto o slot está no estágio de ataque. Com movimento reduzido, sem
   * gesto (peça normal — o pulso é transitório, sem equivalente estático).
   */
  emDisparo?: boolean
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}

/**
 * Cor chapada por tipo — agora só fallback até a textura carregar (face do
 * `Suspense` interno). O corpo final é caixa lisa com topo texturizado.
 */
const COR_POR_TIPO: Record<TipoDaPeca, string> = {
  inicial: '#d9c6a5',
  reta: '#a5c7d9',
  T: '#c9a5d9',
  cruz: '#a5d9b6',
  gerador: '#ff9f1c',
  sala_do_diretor: '#e76f51',
  sala_medica: '#a8ff60',
  portao_de_saida: '#6c757d',
  // Monstros (issue #143): tons escuros distintos; arte final substitui o
  // placeholder, não os ids.
  vulto: '#4a3b6b',
  espectro: '#37474f',
}

/** Laterais em tom neutro escuro (o motivo vive só na face superior). */
const COR_LATERAL = '#2b2521'

// Destaque da peça selecionada/em manipulação: realce quente na borda para
// distinguir visualmente da composição padrão.
/** Cor do destaque de destino válido (vizinha conectada ao peão selecionado). */
const COR_DESTAQUE = '#ffe08a'
/**
 * Cor do destaque de destino de RESGATE (peça que abriga peão AFETADO sob o
 * teto elevado — exceção #171). Tom frio sóbrio que contrasta do âmbar quente
 * do movimento sem exigir arte nova (issue #145-exp F1).
 */
export const COR_DESTAQUE_RESGATE = '#7fd1e0'

export const TAMANHO_PECA = TAMANHO_CELULA * 0.96
export const ESPESSURA_PECA = 0.12
const Y_CORPO = 0.08
/** Topo da base da peça: o modelo do Monstro pousa aqui (base inalterada). */
const TOPO_DA_BASE = Y_CORPO + ESPESSURA_PECA / 2

/**
 * Fator do relevo do topo (normalScale acima do default 1: ponto de partida
 * afinado por screenshot; realça o relevo do normalMap sob a luz rasante da
 * cena sem amplificar ruído além do motivo).
 */
const RELEVO_TOPO_NORMAL_SCALE: readonly [number, number] = [1.6, 1.6]

/**
 * Intensidade da emissão própria do topo (os 10 tipos têm `emissiveMap`):
 * ponto único de ajuste do brilho — 0 apaga, 1 é o neutro, acima disso
 * estoura para o branco. Afinado por screenshot no jogo.
 */
export const INTENSIDADE_EMISSAO_DO_TOPO = 0.4

interface CorpoProps extends PecaPlaceholderProps {
  destacada: boolean
  corDestaque: string
  cursor: 'default' | 'pointer'
}

/**
 * Contorno do telegraph (issue #385): mesma casca invertida do destaque, no
 * vermelho do ataque, com pulso de escala XZ (~0,6s por ciclo) via `useFrame`
 * + `invalidate()` (Canvas em `frameloop="demand"`). Com movimento reduzido,
 * vira contorno estático — sem animação, sem informação nova.
 */
function ContornoTelegraphPulsante({ corDestaque }: { corDestaque: string }) {
  const malhaRef = useRef<THREE.Mesh | null>(null)
  const invalidate = useThree((estado) => estado.invalidate)
  const reduce = usePrefersReducedMotion()
  useEffect(() => {
    if (!reduce) invalidate()
  }, [reduce, invalidate])
  useFrame(({ clock }) => {
    if (reduce) return
    const pulso = 1 + 0.035 * Math.sin((clock.getElapsedTime() * Math.PI * 2) / 0.6)
    malhaRef.current?.scale.set(pulso, 1, pulso)
    invalidate()
  })
  if (reduce) {
    return <ContornoDaPeca visivel corDestaque={corDestaque} />
  }
  const contorno = propsDoMaterialDeContorno(corDoContornoDaPeca(corDestaque))
  return (
    <mesh
      ref={malhaRef}
      position={[0, Y_CORPO, 0]}
      raycast={() => null}
    >
      <boxGeometry
        args={[
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
          ESPESSURA_PECA,
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
        ]}
      />
      <meshBasicMaterial {...contorno} side={THREE.BackSide} />
    </mesh>
  )
}

/**
 * Deslocamento da reação da peça no alcance (issue #385, follow-up): `pulo`
 * quica no Y sem sair da célula; `tremor` balança no XZ junto do peão;
 * `escudo` não desloca (só a casca azul do chamador). O atraso da onda
 * (`atrasoMs` do coreógrafo) segura o início por peça; antes dele, sem
 * deslocamento. Com movimento reduzido, sempre estático; ao drenar (null),
 * a posição volta a zero sem marcas.
 */
function GrupoDaReacao({
  reacao,
  atrasoMs,
  children,
}: {
  reacao: ReacaoDePecaNoAtaque | null
  atrasoMs: number
  children: ReactNode
}) {
  const grupoRef = useRef<THREE.Group | null>(null)
  const inicioRef = useRef<number>(-1)
  const invalidate = useThree((estado) => estado.invalidate)
  const reduce = usePrefersReducedMotion()
  useEffect(() => {
    inicioRef.current = -1
    if (reacao === null) grupoRef.current?.position.set(0, 0, 0)
    else if (!reduce) invalidate()
  }, [reacao, atrasoMs, reduce, invalidate])
  useFrame(({ clock }) => {
    const grupo = grupoRef.current
    if (reduce || reacao === null || reacao === 'escudo' || grupo === null) return
    const agora = clock.getElapsedTime() * 1000
    if (inicioRef.current < 0) inicioRef.current = agora
    const t = agora - inicioRef.current - atrasoMs
    if (t < 0) {
      grupo.position.set(0, 0, 0)
      invalidate()
      return
    }
    if (reacao === 'pulo') {
      const ciclo = (t % 450) / 450
      grupo.position.set(0, 0.14 * Math.abs(Math.sin(ciclo * Math.PI * 2)), 0)
    } else {
      const [x, z] = poseDoTremorXZ(t)
      grupo.position.set(x, 0, z)
    }
    invalidate()
  })
  return <group ref={grupoRef}>{children}</group>
}

/**
 * Gesto de disparo do atacante (issue #385, follow-up): pulso de escala XZ +
 * flash emissivo (casca lilás que desvanece) com o ciclo do token
 * `DURACAO_DISPARO_ATAQUE_MS` (~250ms). Com movimento reduzido, sem gesto
 * (peça normal); inativo, só as crianças sem wrapper animado.
 */
function GestoDoDisparo({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  const grupoRef = useRef<THREE.Group | null>(null)
  const flashRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const invalidate = useThree((estado) => estado.invalidate)
  const reduce = usePrefersReducedMotion()
  useEffect(() => {
    if (ativo && !reduce) invalidate()
  }, [ativo, reduce, invalidate])
  useFrame(({ clock }) => {
    const grupo = grupoRef.current
    if (reduce || !ativo || grupo === null) return
    const fase = ((clock.getElapsedTime() * 1000) % DURACAO_DISPARO_ATAQUE_MS) / DURACAO_DISPARO_ATAQUE_MS
    const pulso = 1 + 0.05 * Math.sin(fase * Math.PI * 2)
    grupo.scale.set(pulso, 1, pulso)
    if (flashRef.current) flashRef.current.opacity = 0.35 * (1 - fase)
    invalidate()
  })
  if (!ativo || reduce) return <group>{children}</group>
  return (
    <group ref={grupoRef}>
      {children}
      <mesh position={[0, Y_CORPO, 0]} raycast={() => null}>
        <boxGeometry
          args={[
            TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
            ESPESSURA_PECA,
            TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
          ]}
        />
        <meshBasicMaterial
          ref={flashRef}
          color={COR_FLASH_DISPARO_ATAQUE}
          transparent
          opacity={0.35}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function ContornoDaPeca({
  visivel,
  corDestaque,
}: {
  visivel: boolean
  corDestaque: string
}) {
  const contorno = propsDoMaterialDeContorno(corDoContornoDaPeca(corDestaque))
  return (
    <mesh
      position={[0, Y_CORPO, 0]}
      visible={visivel}
      raycast={() => null}
    >
      <boxGeometry
        args={[
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
          ESPESSURA_PECA,
          TAMANHO_PECA + EXPANSAO_CONTORNO_PECA_XZ,
        ]}
      />
      <meshBasicMaterial {...contorno} side={THREE.BackSide} />
    </mesh>
  )
}

/**
 * Contorno de estado da peça (issue #385, follow-up): ponto único do
 * telegraph vs. destaque nos dois corpos (texturizado e fallback do
 * `Suspense`) — casca invertida, sem handlers e com `raycast` nulo para
 * nunca roubar clique. O telegraph sobrepõe o destaque no tom vermelho
 * (`COR_TELEGRAPH_ATAQUE`, token único do ataque).
 */
function ContornoDeEstado({
  emTelegraph,
  destacada,
  corDestaque,
}: {
  emTelegraph: boolean
  destacada: boolean
  corDestaque: string
}) {
  if (emTelegraph) {
    return <ContornoTelegraphPulsante corDestaque={COR_TELEGRAPH_ATAQUE} />
  }
  return <ContornoDaPeca visivel={destacada} corDestaque={corDestaque} />
}

function usarClique(
  onClick: PecaPlaceholderProps['onClick'],
): ((e: ThreeEvent<MouseEvent>) => void) | undefined {
  if (!onClick) return undefined
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onClick(e)
  }
}

/**
 * Corpo final: caixa lisa nas mesmas dimensões, face superior (`material-2`,
 * +y — mesmo precedente da Mesa em `AmbienteCena`) com map (sRGB) +
 * normalMap (linear) + emissiveMap (sRGB) do tipo, motivo girando com a
 * `orientacao`; laterais neutras.
 * O topo ignora o tone mapping da cena (fiel à textura); o destaque de
 * seleção segue por contorno em casca invertida, sem interferir na emissão.
 */
function CorpoTexturizado({
  tipo,
  orientacao,
  destacada,
  corDestaque,
  emTelegraph = false,
  cursor,
  onClick,
}: CorpoProps) {
  const { map, normalMap, emissiveMap } = texturaDaPeca(tipo)
  const [mapCarregado, normalCarregado, emissaoCarregada] = useLoader(
    THREE.TextureLoader,
    [map, normalMap, emissiveMap],
  )
  // Clona para não mutar o cache do useLoader (precedente da Mesa): cor no
  // map, dado linear no normal; centro no meio para girar o motivo.
  const { mapaTopo, normalTopo, emissaoTopo } = useMemo(() => {
    const rotacao = rotacaoDoMotivo(orientacao)
    const mapa = mapCarregado.clone()
    mapa.colorSpace = THREE.SRGBColorSpace
    mapa.center.set(0.5, 0.5)
    mapa.rotation = rotacao
    mapa.needsUpdate = true
    const normal = normalCarregado.clone()
    normal.center.set(0.5, 0.5)
    normal.rotation = rotacao
    normal.needsUpdate = true
    // Emissão própria do tipo: mesmo giro do motivo; `emissive` branco na
    // intensidade de `INTENSIDADE_EMISSAO_DO_TOPO` — o mapa dita o brilho.
    const emissao = emissaoCarregada.clone()
    emissao.colorSpace = THREE.SRGBColorSpace
    emissao.center.set(0.5, 0.5)
    emissao.rotation = rotacao
    emissao.needsUpdate = true
    return { mapaTopo: mapa, normalTopo: normal, emissaoTopo: emissao }
  }, [mapCarregado, normalCarregado, emissaoCarregada, orientacao])
  // B1: descarta os 3 clones no unmount/troca (~90 peças por mount) — o
  // cache do `useLoader` segue intacto.
  useEffect(
    () => () => {
      mapaTopo.dispose()
      normalTopo.dispose()
      emissaoTopo.dispose()
    },
    [mapaTopo, normalTopo, emissaoTopo],
  )

  const cursorHandlers = handlersDeCursor(cursor)
  const handleClick = usarClique(onClick)

  return (
    <>
      <mesh position={[0, Y_CORPO, 0]} raycast={() => null}>
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial attach="material-0" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-1" color={COR_LATERAL} />
        <meshStandardMaterial
          attach="material-2"
          map={mapaTopo}
          normalMap={normalTopo}
          normal-scale={RELEVO_TOPO_NORMAL_SCALE}
          emissiveMap={emissaoTopo}
          emissive="#ffffff"
          emissiveIntensity={INTENSIDADE_EMISSAO_DO_TOPO}
          toneMapped={false}
        />
        <meshStandardMaterial attach="material-3" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-4" color={COR_LATERAL} />
        <meshStandardMaterial attach="material-5" color={COR_LATERAL} />
      </mesh>
      <mesh
        position={[0, Y_CORPO, 0]}
        onClick={handleClick}
        {...cursorHandlers}
      >
        <boxGeometry args={[TAMANHO_CELULA, ESPESSURA_PECA, TAMANHO_CELULA]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ContornoDeEstado emTelegraph={emTelegraph} destacada={destacada} corDestaque={corDestaque} />
    </>
  )
}

/** Fallback de suspensão: caixa lisa na cor chapada do tipo (sem braços). */
function CorpoFallback({
  tipo,
  destacada,
  corDestaque,
  emTelegraph = false,
  cursor,
  onClick,
}: CorpoProps) {
  const cursorHandlers = handlersDeCursor(cursor)
  const handleClick = usarClique(onClick)

  return (
    <>
      <mesh position={[0, Y_CORPO, 0]} raycast={() => null}>
        <boxGeometry args={[TAMANHO_PECA, ESPESSURA_PECA, TAMANHO_PECA]} />
        <meshStandardMaterial
          color={COR_POR_TIPO[tipo]}
          transparent
          opacity={0.88}
        />
      </mesh>
      <mesh
        position={[0, Y_CORPO, 0]}
        onClick={handleClick}
        {...cursorHandlers}
      >
        <boxGeometry args={[TAMANHO_CELULA, ESPESSURA_PECA, TAMANHO_CELULA]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ContornoDeEstado emTelegraph={emTelegraph} destacada={destacada} corDestaque={corDestaque} />
    </>
  )
}

export function PecaPlaceholder({
  tipo,
  orientacao,
  position,
  destacada = false,
  corDestaque = COR_DESTAQUE,
  emTelegraph = false,
  reacaoDoAtaque = null,
  atrasoDoAtaqueMs = 0,
  emDisparo = false,
  cursor = 'default',
  onClick,
}: PecaPlaceholderProps) {
  const corpo: CorpoProps = {
    tipo,
    orientacao,
    destacada,
    corDestaque,
    emTelegraph,
    cursor,
    onClick,
  }
  const fallback = <CorpoFallback {...corpo} />
  // Movimento reduzido: pulo/tremor não deslocam (`GrupoDaReacao` estático) —
  // a peça ganha a casca fixa na cor da reação em vez de nada (o escudo já é
  // estático nos dois modos; o telegraph já é estático, sem mudança).
  const reduce = usePrefersReducedMotion()

  return (
    <group position={position}>
      <GestoDoDisparo ativo={emDisparo}>
        <GrupoDaReacao reacao={reacaoDoAtaque} atrasoMs={atrasoDoAtaqueMs}>
          {/* B4: falha da textura (404) cai no fallback chapado em vez de
              derrubar o Canvas inteiro; o reset segue a troca de tipo (as URLs
              derivam do tipo). */}
          <LimiteDeErroDoModelo
            key={tipo}
            resetKey={tipo}
            fallback={fallback}
          >
            <Suspense fallback={fallback}>
              <CorpoTexturizado {...corpo} />
            </Suspense>
          </LimiteDeErroDoModelo>
        </GrupoDaReacao>
      </GestoDoDisparo>
      {reacaoDoAtaque === 'escudo' ? (
        <ContornoDaPeca visivel corDestaque={COR_CONTORNO_ESCUDO_ATAQUE} />
      ) : null}
      {reduce && reacaoDoAtaque === 'pulo' ? (
        <ContornoDaPeca visivel corDestaque={COR_CONTORNO_PULO_ATAQUE} />
      ) : null}
      {reduce && reacaoDoAtaque === 'tremor' ? (
        <ContornoDaPeca visivel corDestaque={COR_CONTORNO_TREMOR_ATAQUE} />
      {/* B4: falha da textura (404) cai no fallback chapado em vez de
          derrubar o Canvas inteiro; o reset segue a troca de tipo (as URLs
          derivam do tipo). */}
      <LimiteDeErroDoModelo
        key={tipo}
        resetKey={tipo}
        fallback={fallback}
      >
        <Suspense fallback={fallback}>
          <CorpoTexturizado {...corpo} />
        </Suspense>
      </LimiteDeErroDoModelo>
      {/* Monstros com modelo 3D (vulto/espectro): a base acima segue
          inalterada e o modelo aparece sobre ela — o clique no modelo é o
          mesmo `onClick` da peça (uma coisa só). Falha some só o modelo. */}
      {temModeloDeMonstro(tipo) ? (
        <LimiteDeErroDoModelo
          key={`modelo-${tipo}`}
          resetKey={`modelo-${tipo}`}
          fallback={null}
        >
          <Suspense fallback={null}>
            <MonstroAvatar
              tipo={tipo}
              position={[0, TOPO_DA_BASE, 0]}
              aoClicar={onClick}
            />
          </Suspense>
        </LimiteDeErroDoModelo>
      ) : null}
    </group>
  )
}
