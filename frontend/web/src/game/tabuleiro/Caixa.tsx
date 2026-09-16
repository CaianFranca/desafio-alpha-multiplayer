import { Suspense, useLayoutEffect, useMemo } from 'react'
import { useLoader, type ThreeEvent } from '@react-three/fiber'
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
  TEXTURA_OBSCURO_DA_CESTA,
  escalaEfetivaDoModelo,
  modeloDaCaixa,
  type AjusteDoModeloDaCaixa,
} from './modelosDaCaixa'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'
import { PilhaDaCaixa } from './PilhaDaCaixa'
import { handlersDeCursor } from './cursor'

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
      <mesh position={[0, CAIXA_ALTURA / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[CAIXA_LARGURA, CAIXA_ALTURA, CAIXA_PROFUNDIDADE]} />
        <meshStandardMaterial color="#241a12" />
      </mesh>
      <mesh position={[0, CAIXA_ALTURA + 0.02, 0]} castShadow receiveShadow>
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
    <mesh
      position={[0, -0.005, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[BANDEJA_LARGURA, BANDEJA_PROFUNDIDADE]} />
      <meshStandardMaterial color="#1f1a18" transparent opacity={0.9} />
    </mesh>
  )
}

interface ModeloNormalizadoProps {
  /** Pegada do contrato que o modelo deve caber (escala uniforme). */
  largura: number
  profundidade: number
  /** Teto de altura (só a Caixa tem altura no contrato; sem teto = só XZ). */
  alturaMaxima?: number
  ajuste: AjusteDoModeloDaCaixa
  url: string
  /**
   * Albedo próprio sobre o GLB (só a cesta): substitui o `map` dos materiais
   * do modelo, preservando normal/roughness dele. `undefined` = cor do GLB.
   */
  mapUrl?: string
  /**
   * Desliga o `normalMap` do GLB (só a bandeja dos peões): o relevo
   * embutido deforma sob o esticamento — sem ele a calha sai lisa.
   * `false` (padrão) preserva o normal do modelo.
   */
  semNormalMap?: boolean
}

/**
 * Prepara os meshes do clone para mutação segura (B2/B3/B6 da revisão da
 * PR #317): clona cada material compartilhado do cache do `useLoader`
 * antes de mutar (sem tocar no singleton), desliga o tone mapping e o
 * raycast decorativo. Idempotente via `userData` — o efeito do pai e o do
 * `AlbedoSobreModelo` podem chamar em qualquer ordem sem clonar duas vezes.
 * Retorna os materiais do clone (para o `dispose` no cleanup do efeito).
 *
 * Auto-sombra: cada mesh do clone projeta e recebe sombra (`castShadow` +
 * `receiveShadow`) — as paredes/tampo da caixa e a borda da cesta sombreiam
 * o próprio interior, escurecendo-o de forma coerente com o sanatório
 * (o interior claro não fazia sentido com a proposta). O mapa de sombras é
 * ligado no `Canvas` (`AmbienteDeJogo`) e a luz principal projeta sombra
 * (`Iluminacao` em `AmbienteCena`).
 */
function prepararMeshesDoClone(objeto: THREE.Object3D): THREE.Material[] {
  const materiaisDoClone: THREE.Material[] = []
  objeto.traverse((filho) => {
    if (filho instanceof THREE.Mesh) {
      const atual = filho.material
      const lista = (Array.isArray(atual) ? atual : [atual]).map((m) => {
        if (m.userData.__cloneDaCaixa === true) return m
        const clonado = m.clone()
        clonado.toneMapped = false
        clonado.userData.__cloneDaCaixa = true
        return clonado
      })
      filho.material = (
        Array.isArray(atual) ? lista : lista[0]
      ) as THREE.Mesh['material']
      // Decorativo nunca intercepta clique (B6): a cesta/caixa não rouba o
      // `onClick` de puxar da Peça Corrente (irmã, fora do `Suspense`).
      filho.raycast = () => null
      // Auto-sombra (caixa e cesta): o mesh projeta e recebe — o interior
      // da caixa/cesta é sombreado pelas próprias paredes/tampo.
      filho.castShadow = true
      filho.receiveShadow = true
      materiaisDoClone.push(...lista)
    }
  })
  return materiaisDoClone
}

/**
 * GLB normalizado na pegada do contrato (issue #274): bounding box →
 * escala uniforme de encaixe em `largura × profundidade` (× `alturaMaxima`
 * quando houver), centralizado em XZ e com a base em y = 0 do grupo.
 * Sem tocar no contrato, sem overlay.
 *
 * O `ajuste` (ponto único em `AJUSTES_DOS_MODELOS_DA_CAIXA`) aplica o
 * TAMANHO OBRIGATÓRIO pós-screenshot (caixa ×4 imponente, cesta ×2 contida):
 * o multiplicador sai exato, sem clamp — o excedente sobre a pegada é
 * intencional para coerência em tela (decisão do PO). Não reduzir.
 */
export function ModeloNormalizado({
  largura,
  profundidade,
  alturaMaxima,
  ajuste,
  url,
  mapUrl,
  semNormalMap = false,
}: ModeloNormalizadoProps) {
  const gltf = useLoader(GLTFLoader, url)
  // Puro no memo: clona a hierarquia, mede o `Box3` e deriva escala
  // (tamanho obrigatório do PO, sem clamp) + deslocamento — nenhuma mutação de
  // material/cena compartilhada na fase de render.
  const { objeto, escala, deslocamento } = useMemo(() => {
    // Clona para não mutar a cena cacheada pelo useLoader.
    const objeto = gltf.scene.clone(true)
    const caixa = new THREE.Box3().setFromObject(objeto)
    const tamanho = caixa.getSize(new THREE.Vector3())
    const centro = caixa.getCenter(new THREE.Vector3())
    const escala = escalaEfetivaDoModelo(
      largura,
      profundidade,
      alturaMaxima,
      tamanho,
      ajuste,
    )
    const deslocamento: [number, number, number] = [
      -centro.x,
      -caixa.min.y,
      -centro.z,
    ]
    return { objeto, escala, deslocamento }
  }, [gltf, largura, profundidade, alturaMaxima, ajuste])

  // Mutação do clone fora da fase de render (B2/B3/B6): clona os materiais
  // compartilhados do cache antes de mutar e desliga o raycast decorativo.
  // `useLayoutEffect` roda antes do paint: o primeiro frame já sai correto.
  useLayoutEffect(() => {
    const materiaisDoClone = prepararMeshesDoClone(objeto)
    if (semNormalMap) {
      // Relevo desligado: os materiais já são clones isolados (sem tocar no
      // cache) — remover o mapa exige recompilar o shader (`needsUpdate`).
      objeto.traverse((filho) => {
        if (!(filho instanceof THREE.Mesh)) return
        const lista = Array.isArray(filho.material)
          ? filho.material
          : [filho.material]
        for (const material of lista) {
          if (
            material instanceof THREE.MeshStandardMaterial &&
            material.normalMap !== null
          ) {
            material.normalMap = null
            material.needsUpdate = true
          }
        }
      })
    }
    return () => {
      // B1: descarta os materiais clonados no unmount/troca. As geometrias
      // seguem compartilhadas com o cache do `useLoader` — sem `dispose`
      // (não tocar no cache).
      for (const material of materiaisDoClone) material.dispose()
    }
  }, [objeto, semNormalMap])

  return (
    <group scale={[escala, escala, escala]} rotation={[0, ajuste.rotacaoY, 0]}>
      <primitive object={objeto} position={deslocamento} />
      {mapUrl ? <AlbedoSobreModelo objeto={objeto} mapUrl={mapUrl} /> : null}
    </group>
  )
}

/**
 * Albedo próprio sobre o clone do modelo (só a cesta): substitui o `map` de
 * todos os materiais, preservando normal/roughness do GLB. Componente
 * separado para o `useLoader` da textura não correr na Caixa (sem `mapUrl`
 * o gancho nem monta — hooks do pai seguem estáveis).
 */
function AlbedoSobreModelo({
  objeto,
  mapUrl,
}: {
  objeto: THREE.Object3D
  mapUrl: string
}) {
  const mapaProprio = useLoader(THREE.TextureLoader, mapUrl)
  // Clone sRGB (precedente da Mesa): não muta o cache do useLoader. Criar e
  // configurar o objeto próprio no memo é puro (sem cena compartilhada).
  const albedo = useMemo((): THREE.Texture => {
    const albedo = mapaProprio.clone()
    albedo.colorSpace = THREE.SRGBColorSpace
    albedo.needsUpdate = true
    return albedo
  }, [mapaProprio])
  // Mutação do clone fora da fase de render (B3): aplica o albedo nos
  // materiais já clonados pelo efeito do pai (preparo idempotente — a ordem
  // entre os dois efeitos não importa). O cleanup descarta o clone (B1).
  useLayoutEffect(() => {
    const materiaisDoClone = prepararMeshesDoClone(objeto)
    for (const material of materiaisDoClone) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.map = albedo
        material.needsUpdate = true
      }
    }
    return () => {
      albedo.dispose()
    }
  }, [objeto, albedo])
  return null
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

/** Visual da bandeja: GLB `serving_tray` com o albedo `obscuro` na pegada `BANDEJA_*`. */
function ModeloDaCesta() {
  return (
    <ModeloNormalizado
      largura={BANDEJA_LARGURA}
      profundidade={BANDEJA_PROFUNDIDADE}
      ajuste={AJUSTES_DOS_MODELOS_DA_CAIXA.cesta}
      url={modeloDaCaixa('cesta')}
      mapUrl={TEXTURA_OBSCURO_DA_CESTA}
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
          próprio modelo, sem overlay); primitivas como fallback/erro. A pilha
          de peças sobre o tampo vende que as peças vêm da Caixa. */}
      <group position={[POSICAO_CAIXA[0], POSICAO_CAIXA[1], POSICAO_CAIXA[2]]}>
        <LimiteDeErroDoModelo
          key={modeloDaCaixa('caixa')}
          resetKey={modeloDaCaixa('caixa')}
          fallback={<BlocoDaCaixaFallback />}
        >
          <Suspense fallback={<BlocoDaCaixaFallback />}>
            <ModeloDaCaixa />
          </Suspense>
        </LimiteDeErroDoModelo>
      </group>
      <PilhaDaCaixa />

      {/* Bandeja de slot único: SÓ o visual vira o GLB da cesta (posição,
          pegada, clique, pull vigente e origem `bandeja` do voo inalterados).
          A corrente vive fora do Suspense: sobre a cesta quando há corrente,
          clicável para puxar com o destaque do placeholder. */}
      <group position={[POSICAO_BANDEJA[0], POSICAO_BANDEJA[1], POSICAO_BANDEJA[2]]}>
        <LimiteDeErroDoModelo
          key={modeloDaCaixa('cesta')}
          resetKey={modeloDaCaixa('cesta')}
          fallback={<PlanoDaBandejaFallback />}
        >
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
        {/* Hitbox invisível ampliada da bandeja (2.8×2.8) para dedo: irmão do PecaPlaceholder, mesmo despachador, depthWrite false */}
        {onPuxar ? (
          <mesh
            position={[0, 0.025, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation()
              despacharCliqueNaPecaDaBandeja(estadoPeoes, { onPuxar })
            }}
            {...handlersDeCursor(correntePuxavel ? 'pointer' : 'default')}
          >
            <planeGeometry args={[2.8, 2.8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
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
