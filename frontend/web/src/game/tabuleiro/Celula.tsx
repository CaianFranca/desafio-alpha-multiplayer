import { Suspense, useEffect, useMemo } from 'react'
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
  LADO_DA_GRADE,
  layoutDoPeaoNaCelula,
  PEAO_Y,
  PECA_Y,
  TAMANHO_CELULA,
} from './contrato'
import { TEXTURA_OBSCURO_DA_GRADE } from './texturasDasPecas'
import type {
  Celula as CelulaTipo,
  PeaoDaExibicao,
  PeaoId,
  PecaPosicionada,
} from './contrato'
import type { ReacaoDePecaNoAtaque } from './ataque'
import { PeaoVisual } from './PeaoVisual'
import { COR_DESTAQUE_RESGATE, PecaPlaceholder } from './PecaPlaceholder'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'
import { handlersDeCursor } from './cursor'
import { texturaDoTabuleiro } from './texturasDoTabuleiro'
import { COR_CONTORNO_GUIA, COR_CONTORNO_PEAO_SELECIONADO, propsDoMaterialDeContorno } from './contorno'

interface CelulaProps {
  celula: CelulaTipo
  peca?: PecaPosicionada | null
  /** Cursor da grade para a célula (ocupada/vazia; vazia só reage se há seleção). */
  cursor?: 'default' | 'pointer'
  /** Destaque visual da peça posicionada selecionada/em manipulação. */
  pecaDestacada?: boolean
  onClick?: (event: ThreeEvent<MouseEvent>) => void
  /**
   * Travessia do Escuro (ADR-0017 / issue #377): a célula é uma vaga ESCURA
   * clicável — destaque por anel branco VAZADO no chão (quadrado com furo
   * interno ≈ 82% do lado, borda fina), mesma linguagem do peão selecionado
   * (`PeaoAvatar`), legível sobre o plano escuro onde o tom quente de
   * `alvo/vaga` se perde — sem ocultar a peça que encaixa dentro. Distinto
   * de `vagaDisponivel` (o anel é do movimento/gesto, não da vaga de encaixe).
   */
  anelTravessia?: boolean
  /**
   * Peões posicionados sobre a peça desta célula, já filtrados pelo voo ativo
   * no pai (`Tabuleiro`). A cena renderiza um visual por peão no arranjo de
   * co-ocupação do `layoutDoPeaoNaCelula`; a regra de ocupação (Portão 4,
   * resgate +1) vive no engine e no espelho de destinos
   * (`destinosConectadosDoPeao`). A ordem de chegada vem de `filaDeChegada`
   * (autoritativa): ela espelha o modelo pós-evento
   * (PEAO_POSICIONADO/PEAO_MOVIDO) — sem reserva otimista pré-evento. Durante
   * o voo ativo o modelo já avançou, então o voador segue na fila do destino
   * e os demais não sofrem shift.
   */
  peoes?: PeaoDaExibicao[]
  /**
   * Fila de chegada autoritativa desta célula (issue #298): ordem de pouso
   * vinda de `ordemDeChegadaPorChave` (modelo pós-evento — sem reserva
   * otimista: a fila só muda em PEAO_POSICIONADO/PEAO_MOVIDO/snapshot).
   * Mantém o arranjo estável durante o voo ativo (o modelo já avançou, então
   * o peão voador permanece na fila do destino). Sem a prop, a fila deriva
   * da lista renderizada (`peoes`).
   */
  filaDeChegada?: readonly PeaoId[]
  /**
   * Telegraph do ataque (issue #385): peça do monstro com contorno vermelho
   * pulsante durante o pulso silencioso — apaga ao entrar no disparo.
   */
  emTelegraph?: boolean
  /**
   * Reação da peça no alcance do ataque (issue #385, follow-up): duplo
   * feedback com os chips do overlay — a peça pula/treme/escuda no 3D e o
   * peão sobre ela treme junto (só no `tremor`). Null = sem reação.
   */
  reacaoDoAtaque?: ReacaoDePecaNoAtaque | null
  /** Atraso da onda até esta peça (`atrasoMs` do coreógrafo). */
  atrasoDoAtaqueMs?: number
  /** Peça do atacante no estágio de disparo: gesto de escala + flash. */
  emDisparo?: boolean
  /** Peça é destino válido do peão selecionado: destaque + cursor pointer. */
  destinoValido?: boolean
  /**
   * Peça em preview provisório (issue #357): pendência com vaga escolhida
   * ainda não posicionada, renderizada na célula-alvo antes do OK. Ganha o
   * destaque de manipulação para sinalizar o estado provisório.
   */
  provisoria?: boolean
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
   * Vaga com pontinhos (peça puxada na bandeja): grade 3×3 de pontos brancos
   * semi-transparentes em linhas norte→sul — indicação visual de onde a peça
   * pode ser colocada. Puramente indicativo: sem raycast (o clique passa à
   * célula) e sem cursor próprio.
   */
  vagaPontilhada?: boolean
  /**
   * Célula iluminada no estado compartilhado (issue #151). Tom sutil sobre a
   * base; os destaques de seleção/pendência/ocupação têm prioridade maior.
   */
  iluminada?: boolean
  peaoSelecionadoId?: PeaoId | null
  /** Peão do Jogador Ativo da vez: destaque emissivo suave (#118). */
  peaoAtivoId?: PeaoId | null
  /**
   * Guia de turno (issue #441): peça desta célula é o alvo acionável do
   * passo atual — contorno ciano (sobrepõe seleção/destino no tom, nunca
   * no clique).
   */
  pecaEmGuia?: boolean
  /**
   * Guia de turno (issue #441): peão acionável do passo atual — anel ciano
   * (coexiste com seleção/vez, nunca bloqueia cliques).
   */
  peaoEmGuiaId?: PeaoId | null
  /**
   * Guia de turno (issue #441): passo do tabuleiro — bordas da grade em
   * ciano (só visual, sem raycast, estático).
   */
  tabuleiroEmGuia?: boolean
  /**
   * Guia de turno (issue #441): passo das vagas — anel ciano na célula vaga
   * (só visual, sem raycast, estático).
   */
  vagaEmGuia?: boolean
  /**
   * Peões em Baixa Iluminação do dono (issue #297): o avatar 3D troca para a
   * variante apagado — apenas Baixa Iluminação, não Amedrontado (semântica
   * original #297 preservada na co-ocupação).
   */
  emBaixaIluminacaoPorPeaoId?: ReadonlySet<PeaoId>
  onSelecionarPeao?: (peaoId: PeaoId) => void
}

const BORDAS_CONFIG: readonly { pos: [number, number, number]; args: [number, number, number] }[] = [
  { pos: [0, 0, TAMANHO_CELULA / 2 - BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [0, 0, -TAMANHO_CELULA / 2 + BORDA_OFFSET], args: [CELULA_INSET, BORDA_Y, ESPESSURA_BORDA] },
  { pos: [TAMANHO_CELULA / 2 - BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
  { pos: [-TAMANHO_CELULA / 2 + BORDA_OFFSET, 0, 0], args: [ESPESSURA_BORDA, BORDA_Y, CELULA_INSET] },
]

/** Pontinhos de vaga (peça puxada na bandeja): 3×3, brancos semi-transparentes. */
const PASSO_DOS_PONTOS = CELULA_INSET / 4
const RAIO_DO_PONTO = 0.055
const OPACIDADE_DO_PONTO = 0.55

/**
 * Grade de pontos chapada no plano da célula (linhas norte→sul, espaçados
 * dentro da célula): indica onde a peça puxada pode ser colocada. Sem
 * raycast — o clique atravessa para a célula/peca (sem double-fire) — e sem
 * cursor próprio: puramente indicativo.
 */
function PontosDaVaga() {
  const pontos: Array<[number, number]> = []
  for (let linha = -1; linha <= 1; linha++) {
    for (let coluna = -1; coluna <= 1; coluna++) {
      pontos.push([coluna * PASSO_DOS_PONTOS, linha * PASSO_DOS_PONTOS])
    }
  }
  return (
    <group position={[0, CELULA_Y_BASE + 0.006, 0]}>
      {pontos.map(([x, z], indice) => (
        <mesh
          key={indice}
          position={[x, 0, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <circleGeometry args={[RAIO_DO_PONTO, 20]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={OPACIDADE_DO_PONTO}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

interface PlanoDeFundoProps {
  celula: CelulaTipo
  /** Tom do estado (alvo/vaga/ocupada/iluminada/base): tinge a textura. */
  cor: string
  opacidade: number
  onClick?: (event: ThreeEvent<MouseEvent>) => void
  cursorHandlers: ReturnType<typeof handlersDeCursor>
}

/**
 * Plano texturizado da célula: amostra 1/7 do `obscuro` (posição da célula
 * na grade), então a textura atravessa o tabuleiro contínua — uma escuridão
 * só, não 49 repetições. A cor do estado multiplica o mapa (destaques de
 * interação/ocupação/iluminação intactos).
 */
function PlanoTexturizado({
  celula,
  cor,
  opacidade,
  onClick,
  cursorHandlers,
}: PlanoDeFundoProps) {
  const base = useLoader(THREE.TextureLoader, TEXTURA_OBSCURO_DA_GRADE)
  const mapa = useMemo(() => {
    // Clone sRGB (precedente da Mesa): não muta o cache do useLoader.
    const copia = base.clone()
    copia.colorSpace = THREE.SRGBColorSpace
    copia.repeat.set(1 / LADO_DA_GRADE, 1 / LADO_DA_GRADE)
    copia.offset.set(
      celula.coluna / LADO_DA_GRADE,
      1 - (celula.linha + 1) / LADO_DA_GRADE,
    )
    copia.needsUpdate = true
    return copia
  }, [base, celula])
  // B1: descarta o clone no unmount/troca (49 células por mount) — o cache
  // do `useLoader` segue intacto.
  useEffect(() => () => mapa.dispose(), [mapa])
  return (
    <mesh
      position={[0, CELULA_Y_BASE, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={onClick}
      {...cursorHandlers}
    >
      <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
      <meshStandardMaterial
        map={mapa}
        color={cor}
        transparent
        opacity={opacidade}
      />
    </mesh>
  )
}

/**
 * Fundo da célula com `Suspense` interno (padrão do `PecaPlaceholder`):
 * enquanto o `obscuro` carrega, o plano chapado atual — a grade nunca some.
 * O limite de erro cobre a falha (404 derrubaria o Canvas inteiro — B4):
 * o mesmo plano chapado vira a face do erro.
 */
function PlanoDeFundoDaCelula(props: PlanoDeFundoProps) {
  const { cor, opacidade, onClick, cursorHandlers } = props
  const planoChapado = (
    <mesh
      position={[0, CELULA_Y_BASE, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={onClick}
      {...cursorHandlers}
    >
      <planeGeometry args={[CELULA_INSET, CELULA_INSET]} />
      <meshStandardMaterial
        color={cor}
        transparent
        opacity={opacidade}
      />
    </mesh>
  )
  return (
    <LimiteDeErroDoModelo
      key={TEXTURA_OBSCURO_DA_GRADE}
      resetKey={TEXTURA_OBSCURO_DA_GRADE}
      fallback={planoChapado}
    >
      <Suspense fallback={planoChapado}>
        <PlanoTexturizado {...props} />
      </Suspense>
    </LimiteDeErroDoModelo>
  )
}

/**
 * Relevo das paredes do grid (issue #278): mesmo ponto de partida das peças
 * (`RELEVO_TOPO_NORMAL_SCALE` em `PecaPlaceholder`) — realça o normalMap sob
 * a luz rasante da cena sem amplificar ruído além do motivo. O motivo gira
 * 90° para leitura horizontal de pedra/concreto nas bordas verticais.
 */
const RELEVO_PAREDE_NORMAL_SCALE: readonly [number, number] = [1.1, 1.1]
const TINT_PAREDE = '#b5b5b5'

// Marcador da travessia do escuro (ADR-0017): quadrado chapado no chão,
// um pouco menor que a célula (CELULA_INSET = 1.568) — sinaliza a vaga escura
// clicável sem confundir com a peça vazia/peão.
const LADO_MARCADOR_TRAVESSIA = CELULA_INSET * 0.85

/** Texturas das paredes do grid: cor no map (sRGB), dado linear no normal. */
function useTexturasDaParede(): { mapa: THREE.Texture; normal: THREE.Texture } {
  const { map, normalMap } = texturaDoTabuleiro()
  const [mapCarregado, normalCarregado] = useLoader(THREE.TextureLoader, [
    map,
    normalMap,
  ])
  // Clona para não mutar o cache do useLoader (precedente das peças/Mesa).
  const par = useMemo(() => {
    const mapa = mapCarregado.clone()
    mapa.colorSpace = THREE.SRGBColorSpace
    mapa.wrapS = THREE.RepeatWrapping
    mapa.wrapT = THREE.RepeatWrapping
    mapa.anisotropy = 4
    mapa.center.set(0.5, 0.5)
    mapa.rotation = Math.PI / 2
    mapa.needsUpdate = true
    const normal = normalCarregado.clone()
    normal.colorSpace = THREE.NoColorSpace
    normal.wrapS = THREE.RepeatWrapping
    normal.wrapT = THREE.RepeatWrapping
    normal.anisotropy = 4
    normal.center.set(0.5, 0.5)
    normal.rotation = Math.PI / 2
    normal.needsUpdate = true
    return { mapa, normal }
  }, [mapCarregado, normalCarregado])
  // Descarta os clones no unmount/troca (49 células por mount) — o cache do
  // `useLoader` segue intacto (mesmo padrão B1 do plano de fundo).
  useEffect(
    () => () => {
      par.mapa.dispose()
      par.normal.dispose()
    },
    [par],
  )
  return par
}

/**
 * Paredes do grid texturizadas (issue #278): o `color` multiplica o map, com
 * o piso em `obscuro` contínuo e as bordas em abismo — mesma affordância, só
 * com relevo.
 */
function ParedesTexturizadas() {
  const { mapa, normal } = useTexturasDaParede()
  return (
    <group position={[0, CELULA_Y_BORDA, 0]}>
      {BORDAS_CONFIG.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.args} />
          <meshStandardMaterial
            color={TINT_PAREDE}
            map={mapa}
            normalMap={normal}
            normal-scale={RELEVO_PAREDE_NORMAL_SCALE}
            roughness={0.95}
            metalness={0}
            transparent
            opacity={0.95}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Fallback de suspensão/erro: bordas chapadas atuais (sem textura). */
function ParedesChapadas() {
  return (
    <group position={[0, CELULA_Y_BORDA, 0]}>
      {BORDAS_CONFIG.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.args} />
          <meshStandardMaterial color={COR_BORDA_CELULA} transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Paredes da célula com `Suspense` interno + limite de erro (mesmo padrão do
 * `PlanoDeFundoDaCelula`): enquanto o par abismo carrega, as bordas chapadas
 * — a grade nunca some, e uma falha (404) não derruba o Canvas (B4).
 */
function ParedesDaCelula() {
  const chapeu = <ParedesChapadas />
  const chave = texturaDoTabuleiro().map
  return (
    <LimiteDeErroDoModelo key={chave} resetKey={chave} fallback={chapeu}>
      <Suspense fallback={chapeu}>
        <ParedesTexturizadas />
      </Suspense>
    </LimiteDeErroDoModelo>
  )
}

/**
 * Moldura do guia no passo do tabuleiro (issue #441): as 4 bordas da grade
 * em ciano chapado, reaproveitando `COR_CONTORNO_GUIA` (sem cor nova). Irmã
 * das paredes, um fio acima para não z-fightar; sem raycast (nunca rouba o
 * clique da célula/peça) e estática (vale com `prefers-reduced-motion`).
 */
function MolduraDoGuiaDoTabuleiro() {
  return (
    <group position={[0, CELULA_Y_BORDA + 0.006, 0]}>
      {BORDAS_CONFIG.map((b, i) => (
        <mesh key={i} position={b.pos} raycast={() => null}>
          <boxGeometry args={b.args} />
          <meshBasicMaterial {...propsDoMaterialDeContorno(COR_CONTORNO_GUIA)} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Anel quadrado vazado chapado no chão (travessia branca, guia ciano). */
function criarAnelQuadradoVazado(cor: string, y: number, opacidade: number): THREE.Mesh {
  const lado = LADO_MARCADOR_TRAVESSIA
  const furo = lado * 0.82
  const forma = new THREE.Shape()
  forma.moveTo(-lado / 2, -lado / 2)
  forma.lineTo(lado / 2, -lado / 2)
  forma.lineTo(lado / 2, lado / 2)
  forma.lineTo(-lado / 2, lado / 2)
  forma.closePath()
  const luz = new THREE.Path()
  luz.moveTo(-furo / 2, -furo / 2)
  luz.lineTo(-furo / 2, furo / 2)
  luz.lineTo(furo / 2, furo / 2)
  luz.lineTo(furo / 2, -furo / 2)
  luz.closePath()
  forma.holes.push(luz)
  const anel = new THREE.Mesh(
    new THREE.ShapeGeometry(forma),
    new THREE.MeshBasicMaterial(propsDoMaterialDeContorno(cor)),
  )
  anel.rotation.x = -Math.PI / 2
  anel.position.y = y
  anel.material.side = THREE.FrontSide
  anel.material.transparent = true
  anel.material.opacity = opacidade
  anel.material.depthWrite = false
  anel.raycast = () => { }
  return anel
}

export function Celula({
  celula,
  peca,
  cursor = 'default',
  pecaDestacada = false,
  emTelegraph = false,
  reacaoDoAtaque = null,
  atrasoDoAtaqueMs = 0,
  emDisparo = false,
  onClick,
  peoes = [],
  filaDeChegada,
  destinoValido = false,
  destinoResgate = false,
  alvoPendente = false,
  vagaDisponivel = false,
  vagaPontilhada = false,
  anelTravessia = false,
  provisoria = false,
  iluminada = false,
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  pecaEmGuia = false,
  peaoEmGuiaId = null,
  tabuleiroEmGuia = false,
  vagaEmGuia = false,
  emBaixaIluminacaoPorPeaoId = new Set<PeaoId>(),
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

  // Fila de ocupantes na ordem de chegada (issue #298): o índice decide o
  // arranjo de co-ocupação (Portão: cantos por ordem; peça comum: centro+SE).
  // A fila autoritativa (`filaDeChegada`) espelha o modelo pós-evento — sem
  // reserva otimista, ela só muda em PEAO_POSICIONADO/PEAO_MOVIDO/snapshot;
  // durante o voo ativo o modelo já avançou, então o voador segue na fila do
  // destino sem shift dos demais. Sem ela, deriva da lista renderizada (após
  // a filtragem do voo).
  const filaDeOcupantes = filaDeChegada ?? peoes.map((p) => p.peaoId)

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

  // Anel quadrado vazado no chão (furo interno ≈ 82% do lado): mesma
  // linguagem do peão selecionado (`PeaoAvatar`) — a travessia usa o branco,
  // o guia usa o ciano inédito. Estático (vale com
  // `prefers-reduced-motion`), sem raycast (nunca rouba clique).
  const anelDaTravessia = useMemo(
    () =>
      anelTravessia
        ? criarAnelQuadradoVazado(COR_CONTORNO_PEAO_SELECIONADO, CELULA_Y_BASE + 0.004, 0.9)
        : null,
    [anelTravessia],
  )

  // Guia de turno (issue #441): anel ciano nas vagas do passo das vagas.
  const anelDoGuiaDaVaga = useMemo(
    () => (vagaEmGuia ? criarAnelQuadradoVazado(COR_CONTORNO_GUIA, CELULA_Y_BASE + 0.005, 0.95) : null),
    [vagaEmGuia],
  )

  return (
    <group position={pos}>
      <PlanoDeFundoDaCelula
        celula={celula}
        cor={corPlano}
        opacidade={opacidadePlano}
        onClick={planeOnClick}
        cursorHandlers={cursorHandlers}
      />
      <ParedesDaCelula />
      {tabuleiroEmGuia ? <MolduraDoGuiaDoTabuleiro /> : null}
      {anelDaTravessia !== null ? <primitive object={anelDaTravessia} /> : null}
      {anelDoGuiaDaVaga !== null ? <primitive object={anelDoGuiaDaVaga} /> : null}
      {vagaPontilhada ? <PontosDaVaga /> : null}
      {peca ? (
        <PecaPlaceholder
          tipo={peca.tipo}
          orientacao={peca.orientacao}
          position={[0, PECA_Y, 0]}
          destacada={pecaDestacada || destinoValido || provisoria}
          emGuia={pecaEmGuia}
          corDestaque={destinoResgate ? COR_DESTAQUE_RESGATE : undefined}
          emTelegraph={emTelegraph}
          reacaoDoAtaque={reacaoDoAtaque}
          atrasoDoAtaqueMs={atrasoDoAtaqueMs}
          emDisparo={emDisparo}
          cursor={cursorEfetivo}
          onClick={onClick}
        />
      ) : null}
      {peoes.map((peao) => {
        const { dx, dz } = layoutDoPeaoNaCelula(
          peca?.tipo ?? 'inicial',
          filaDeOcupantes,
          peao.peaoId,
        )
        return (
          <PeaoVisual
            key={peao.peaoId}
            cor={peao.cor}
            position={[dx, PEAO_Y, dz]}
            selecionado={peao.peaoId === peaoSelecionadoId}
            emGuia={peao.peaoId === peaoEmGuiaId}
            ativo={peao.peaoId === peaoAtivoId}
            emBaixaIluminacao={emBaixaIluminacaoPorPeaoId.has(peao.peaoId)}
            tremendo={reacaoDoAtaque === 'tremor'}
            atrasoDoTremorMs={atrasoDoAtaqueMs}
            aoClicar={
              onSelecionarPeao
                ? () => onSelecionarPeao(peao.peaoId)
                : undefined
            }
          />
        )
      })}
    </group>
  )
}
