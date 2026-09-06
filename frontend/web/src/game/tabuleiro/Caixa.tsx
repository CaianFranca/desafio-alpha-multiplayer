import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  BANDEJA_LARGURA,
  BANDEJA_PROFUNDIDADE,
  CAIXA_ALTURA,
  CAIXA_LARGURA,
  CAIXA_PROFUNDIDADE,
  POSICAO_BANDEJA,
  POSICAO_CAIXA,
  POSICAO_INICIAIS,
  inicialIndiceParaLocal,
} from './contrato'
import type { PecaCorrente, PecaDaMesa } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'
import type { EstadoInteracaoTabuleiro } from './interacao'
import type { EstadoInteracaoPeoes } from './interacaoPeoes'
import {
  despacharCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaMesa,
  puxadaVigenteNaBandeja,
} from './interacaoPeoes'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'
import {
  AJUSTES_DOS_MODELOS_DA_CAIXA,
  modeloDaCaixa,
  type AjusteDoModeloDaCaixa,
} from './modelosDaCaixa'

interface CaixaProps {
  iniciais: readonly PecaDaMesa[]
  /** Peça sorteada corrente para exibição na bandeja (null = sem corrente). */
  pecaCorrente: PecaCorrente | null
  /** Estado de interação para destaque da Inicial selecionada. */
  estadoInteracao: EstadoInteracaoTabuleiro
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
  /** Estado do ciclo: com pendências, o clique em Inicial fica silencioso (#143). */
  estadoPeoes?: EstadoInteracaoPeoes | null
  /**
   * Pull aceito na bandeja (fluxo #143/revisão #199): o pai persiste o id como
   * estado local; sem callback a bandeja fica inerte. O pull é silencioso
   * (issue #228): nenhum feedback visual nem sonoro.
   */
  onPuxar?: (recebidaId: string) => void
}

/**
 * Primitivas atuais da Caixa (issue #143): face do `Suspense` enquanto o GLB
 * carrega e do limite de erro se o GLB falhar — a cena nunca quebra.
 */
function BlocoDaCaixaFallback() {
  return (
    <>
      <mesh position={[0, CAIXA_ALTURA / 2, 0]}>
        <boxGeometry args={[CAIXA_LARGURA, CAIXA_ALTURA, CAIXA_PROFUNDIDADE]} />
        <meshStandardMaterial color="#241a12" />
      </mesh>
      <mesh position={[0, CAIXA_ALTURA + 0.02, 0]}>
        <boxGeometry args={[CAIXA_LARGURA * 0.92, 0.04, CAIXA_PROFUNDIDADE * 0.92]} />
        <meshStandardMaterial color="#3b2c1c" />
      </mesh>
    </>
  )
}

/**
 * Primitiva atual da bandeja: face do `Suspense`/erro do GLB da cesta.
 * A Peça Corrente vive FORA do `Suspense` (irmã, não filha): continua
 * visível e clicável enquanto a cesta carrega.
 */
function PlanoDaBandejaFallback() {
  return (
    <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[BANDEJA_LARGURA, BANDEJA_PROFUNDIDADE]} />
      <meshStandardMaterial color="#1f1a18" transparent opacity={0.9} />
    </mesh>
  )
}

/**
 * Limite de erro local dos modelos (issue #274): se o GLB falhar
 * (rede/parse), renderiza as primitivas atuais em vez de quebrar a cena.
 * O `Suspense` acima cobre o carregamento; este cobre a falha.
 */
class LimiteDeErroDoModelo extends Component<{
  fallback: ReactNode
  children: ReactNode
}> {
  state = { falhou: false }

  static getDerivedStateFromError(): { falhou: boolean } {
    return { falhou: true }
  }

  render() {
    if (this.state.falhou) return this.props.fallback
    return this.props.children
  }
}

interface ModeloNormalizadoProps {
  /** Pegada do contrato que o modelo deve caber (escala uniforme). */
  largura: number
  profundidade: number
  /** Teto de altura (só a Caixa tem altura no contrato; sem teto = só XZ). */
  alturaMaxima?: number
  ajuste: AjusteDoModeloDaCaixa
  url: string
}

/**
 * GLB normalizado na pegada do contrato (issue #274): bounding box →
 * escala uniforme para caber em `largura × profundidade` (× `alturaMaxima`
 * quando houver), centralizado em XZ e com a base em y = 0 do grupo.
 * Tamanho e proporção inalterados: sem tocar no contrato, sem overlay.
 *
 * O `ajuste` (ponto único em `AJUSTES_DOS_MODELOS_DA_CAIXA`) aplica o
 * refinamento humano pós-screenshot: multiplicador de escala + rotação Y
 * pós-normalização (só apresentação, não a pegada calculada).
 */
function ModeloNormalizado({
  largura,
  profundidade,
  alturaMaxima,
  ajuste,
  url,
}: ModeloNormalizadoProps) {
  const gltf = useLoader(GLTFLoader, url)
  const { objeto, escala, deslocamento } = useMemo(() => {
    // Clona para não mutar a cena cacheada pelo useLoader.
    const objeto = gltf.scene.clone(true)
    const caixa = new THREE.Box3().setFromObject(objeto)
    const tamanho = caixa.getSize(new THREE.Vector3())
    const centro = caixa.getCenter(new THREE.Vector3())
    const escalaX = largura / (tamanho.x || 1)
    const escalaZ = profundidade / (tamanho.z || 1)
    const escalaY =
      alturaMaxima === undefined
        ? Number.POSITIVE_INFINITY
        : alturaMaxima / (tamanho.y || 1)
    const escala = Math.min(escalaX, escalaZ, escalaY) * ajuste.escala
    const deslocamento: [number, number, number] = [
      -centro.x,
      -caixa.min.y,
      -centro.z,
    ]
    return { objeto, escala, deslocamento }
  }, [gltf, largura, profundidade, alturaMaxima, ajuste])

  return (
    <group scale={[escala, escala, escala]} rotation={[0, ajuste.rotacaoY, 0]}>
      <primitive object={objeto} position={deslocamento} />
    </group>
  )
}

/** Corpo da Caixa: GLB `wooden_box` normalizado na pegada `CAIXA_*`. */
function ModeloDaCaixa() {
  return (
    <ModeloNormalizado
      largura={CAIXA_LARGURA}
      profundidade={CAIXA_PROFUNDIDADE}
      alturaMaxima={CAIXA_ALTURA}
      ajuste={AJUSTES_DOS_MODELOS_DA_CAIXA.caixa}
      url={modeloDaCaixa('caixa')}
    />
  )
}

/** Visual da bandeja: GLB `serving_tray` normalizado na pegada `BANDEJA_*`. */
function ModeloDaCesta() {
  return (
    <ModeloNormalizado
      largura={BANDEJA_LARGURA}
      profundidade={BANDEJA_PROFUNDIDADE}
      ajuste={AJUSTES_DOS_MODELOS_DA_CAIXA.cesta}
      url={modeloDaCaixa('cesta')}
    />
  )
}

/**
 * Caixa sobre a mesa (issue #143): substitui a ficção antiga das 22 peças
 * expostas pela da Caixa — bloco fechado e opaco (o wire não expõe o
 * conteúdo da Caixa), bandeja de SLOT ÚNICO com a peça sorteada CORRENTE
 * (fluxo sequencial: uma peça por vez, do sorteio ao encaixe) e as 4 Peças
 * Iniciais em grade 2×2, clicáveis (fallback ST-09 → SELECIONAR_PECA).
 *
 * Corpo e cesta são os GLBs da issue #274 (`modelosDaCaixa.ts`),
 * normalizados nas pegadas do contrato; o tampo rotulado é o que o próprio
 * GLB `wooden_box` já traz (sem overlay).
 *
 * A corrente da bandeja é CLICÁVEL para puxar (revisão #199): só o dono do
 * ciclo puxa (espectador: clique silencioso, mas a corrente continua
 * visível) e o destaque emissivo reflete o pull vigente. O roteamento passa
 * pelo MESMO despachador do espelho DOM (`despacharCliqueNaPecaDaBandeja`).
 *
 * A cena é projeção idempotente do estado: as Iniciais vêm de `iniciais`, a
 * corrente de `pecaCorrente` (derivada no pai). Nenhuma regra vive aqui.
 */
export function Caixa({
  iniciais,
  pecaCorrente,
  estadoInteracao,
  onComando,
  estadoPeoes = null,
  onPuxar,
}: CaixaProps) {
  // A corrente exibida é puxável? O MESMO mapeador puro do clique decide
  // (inclui gate de espectador); o cursor espelha a clicabilidade na cena.
  const correntePuxavel =
    estadoPeoes !== null && mapearCliqueNaPecaDaBandeja(estadoPeoes) !== null
  // Destaque emissivo: pull vigente na bandeja (mesmo predicado do espelho).
  const puxada =
    pecaCorrente !== null &&
    estadoPeoes !== null &&
    puxadaVigenteNaBandeja(estadoPeoes)

  return (
    <group>
      {/* Caixa fechada e opaca: corpo do GLB normalizado na pegada (tampo do
          próprio modelo, sem overlay); primitivas como fallback/erro. */}
      <group position={[POSICAO_CAIXA[0], POSICAO_CAIXA[1], POSICAO_CAIXA[2]]}>
        <LimiteDeErroDoModelo fallback={<BlocoDaCaixaFallback />}>
          <Suspense fallback={<BlocoDaCaixaFallback />}>
            <ModeloDaCaixa />
          </Suspense>
        </LimiteDeErroDoModelo>
      </group>

      {/* Bandeja de slot único: SÓ o visual vira o GLB da cesta (posição,
          pegada, clique, pull vigente e origem `bandeja` do voo inalterados).
          A corrente vive fora do Suspense: sobre a cesta quando há corrente,
          clicável para puxar com o destaque do placeholder. */}
      <group position={[POSICAO_BANDEJA[0], POSICAO_BANDEJA[1], POSICAO_BANDEJA[2]]}>
        <LimiteDeErroDoModelo fallback={<PlanoDaBandejaFallback />}>
          <Suspense fallback={<PlanoDaBandejaFallback />}>
            <ModeloDaCesta />
          </Suspense>
        </LimiteDeErroDoModelo>
        {pecaCorrente ? (
          <PecaPlaceholder
            tipo={pecaCorrente.tipo}
            orientacao={pecaCorrente.orientacao}
            position={[0, 0.02, 0]}
            destacada={puxada}
            cursor={correntePuxavel ? 'pointer' : 'default'}
            onClick={
              onPuxar
                ? () => {
                    // Clique na corrente → puxar (mesmo despachador do espelho
                    // DOM; gate de espectador no roteador, silencioso).
                    despacharCliqueNaPecaDaBandeja(estadoPeoes, {
                      onPuxar,
                    })
                  }
                : undefined
            }
          />
        ) : null}
      </group>

      {/* Peças Iniciais na frente da bandeja, em grade 2×2, clicáveis (ST-09). */}
      <group position={[POSICAO_INICIAIS[0], POSICAO_INICIAIS[1], POSICAO_INICIAIS[2]]}>
        {iniciais.map((peca, indice) => {
          const [lx, , lz] = inicialIndiceParaLocal(indice)
          const destacada = estadoInteracao.pecaSelecionadaId === peca.pecaId
          return (
            <PecaPlaceholder
              key={peca.pecaId}
              tipo={peca.tipo}
              orientacao={peca.orientacao}
              position={[lx, 0.02, lz]}
              destacada={destacada}
              cursor="pointer"
              onClick={() => {
                // Clique em Inicial na mesa → SELECIONAR_PECA (roteador puro,
                // compartilhado com o espelho DOM; silencioso com pendências).
                onComando(
                  mapearCliqueNaPecaDaMesa(estadoPeoes, estadoInteracao, peca.pecaId),
                )
              }}
            />
          )
        })}
      </group>
    </group>
  )
}
