import { Suspense, useMemo } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import mesaTopoUrl from '../assets/mesa_topo.jpg'
import mesaTopoNormalUrl from '../assets/mesa_topo-normal-map.jpg'
import mesaTopoRoughnessUrl from '../assets/mesa_topo-roughness-map.jpg'
import {
  ABERTURA_DO_FUNDO,
  ALTURA_DO_FUNDO,
  ESCALA_DO_FUNDO,
  INCLINACAO_DO_FUNDO,
  INICIO_THETA_DO_FUNDO,
  POSICAO_DO_FUNDO,
  RAIO_DO_FUNDO,
  TEXTURA_DO_FUNDO,
} from '../ambiente/ceu'
import {
  COR_FUNDO,
  COR_LATERAIS_MESA,
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
} from '../ambiente/contrato'
import { aspectoVisivel, nevoaParaAspecto } from '../ambiente/cameraLimites'
import { Tabuleiro } from '../tabuleiro/Tabuleiro'
import { Caixa } from '../tabuleiro/Caixa'
import { BandejaDosPeoes } from '../tabuleiro/BandejaDosPeoes'
import { DecoracoesDaMesa } from '../tabuleiro/Decoracoes'
import { NevoaDaMesa } from '../tabuleiro/Nevoa'
import { LimiteDeErroDoModelo } from '../tabuleiro/LimiteDeErroDoModelo'
import { ManipulacaoOverlay } from './ManipulacaoOverlay'
import type { EstadoInteracaoTabuleiro } from '../tabuleiro/interacao'
import type { EstadoInteracaoPeoes, ComandoDePeaoDoDespacho, MotivoDeRejeicaoLocal } from '../tabuleiro/interacaoPeoes'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'
import { PeaoVisual } from '../tabuleiro/PeaoVisual'
import { peaoMesaParaMundo } from '../tabuleiro/contrato'
import { TransicaoLimpeza, type LimpezaTrigger } from './TransicaoLimpeza'
import { TransicaoEncaixe } from './TransicaoEncaixe'
import type { EncaixeTrigger } from '../tabuleiro/encaixe'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type {
  PeaoId,
  PecaId,
  PecaCorrente,
  EstadoExibicaoTabuleiro,
} from '../tabuleiro/contrato'
import type { EstadoVisualDoAtaque } from '../tabuleiro/ataque'
import type { VooDoPeaoPendente } from '../tabuleiro/vooDoPeao'
import { deveSuprimirPeaoNaMesa } from '../tabuleiro/vooDoPeao'

/**
 * Luzes sutis: o volume claro/escuro já vem "assado" na textura da Mesa
 * (centro claro, bordas escuras). As luzes existem só para leve modelagem
 * e profundidade — não devem lavar a textura. A segunda direcional é rasante
 * (~25° de elevação, azimute girado ~45° em torno de Y em relação à existente)
 * para realçar o relevo do normalMap das peças; intensidade conservadora para
 * manter a Mesa como referência visual.
 */
function Iluminacao() {
  return (
    <>
      <ambientLight intensity={0.22} />
      {/*
        Luz principal projeta sombra (auto-sombra da caixa/cesta): cobre a
        Mesa 20×20 com folga; `bias`/`normalBias` conservadores contra acne.
      */}
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[1.4, 4.7, 9.9]} intensity={0.35} />
    </>
  )
}

/**
 * Mesa: box com o plano superior em y = 0 (origem do ambiente; ver
 * ambiente/contrato.ts). Face +y (índice de material 2) recebe o trio PBR
 * aprovado — `map` (cor) + `normalMap` (relevo sob a luz rasante) +
 * `roughnessMap` (verniz × fosco). O `roughnessMap` assume o trabalho de
 * variação de brilho do `specular-map` anterior (no modelo PBR não há slot
 * de `specularMap`: brilho = 1 − roughness — o arquivo segue no disco, fora
 * de uso). As demais faces são sólidas escuras, fundindo com o vazio.
 */
function Mesa() {
  const texturaCarregada = useLoader(THREE.TextureLoader, mesaTopoUrl)
  const normalCarregado = useLoader(THREE.TextureLoader, mesaTopoNormalUrl)
  const roughnessCarregado = useLoader(THREE.TextureLoader, mesaTopoRoughnessUrl)
  // Cópias sem mutar o cache do useLoader: o topo da Mesa é cor (sRGB);
  // normal e roughness são dados lineares (sem espaço de cor).
  const { textura, normal, roughness } = useMemo(() => {
    const textura = texturaCarregada.clone()
    textura.colorSpace = THREE.SRGBColorSpace
    textura.needsUpdate = true
    const normal = normalCarregado.clone()
    normal.needsUpdate = true
    const roughness = roughnessCarregado.clone()
    roughness.needsUpdate = true
    return { textura, normal, roughness }
  }, [texturaCarregada, normalCarregado, roughnessCarregado])

  return (
    <mesh position={[0, -ESPESSURA_MESA / 2, 0]} receiveShadow>
      <boxGeometry args={[LARGURA_MESA, ESPESSURA_MESA, PROFUNDIDADE_MESA]} />
      <meshStandardMaterial attach="material-0" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-1" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial
        attach="material-2"
        map={textura}
        normalMap={normal}
        normalScale={[0.5, 0.5]}
        roughnessMap={roughness}
        roughness={1}
        metalness={0}
      />
      <meshStandardMaterial attach="material-3" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-4" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-5" color={COR_LATERAIS_MESA} />
    </mesh>
  )
}

/**
 * Fundo da partida (trecho de cilindro côncavo ao fundo do tabuleiro): o
 * panorama INTEIRO distribuído pelo arco, na proporção exata do arquivo —
 * sem o estiramento de polo da esfera e sem deformação de perspectiva do
 * plano. Visto por dentro (`BackSide`), espelhado no eixo X (`scale` com X
 * negativo, receita oficial de panorama — sem isso a imagem sai invertida),
 * com inclinação e escala do seam (`INCLINACAO_DO_FUNDO`, `ESCALA_DO_FUNDO`). Sem
 * responder à névoa (`fog={false}`: a distância apagaria a imagem).
 * Estático e compatível com `frameloop="demand"`; o clique borbulha ao grupo
 * da cena e desseleciona, como o clique direto na Mesa. Enquanto carrega ou
 * se falhar, o fundo segue a cor sólida (`<color attach="background">`) —
 * a cena nunca quebra.
 */
function Fundo() {
  const texturaCarregada = useLoader(THREE.TextureLoader, TEXTURA_DO_FUNDO)
  // Cópia com espaço de cor sRGB: o fundo é cor, não dado linear. Clonar
  // evita mutar a textura cacheada pelo useLoader.
  const textura = useMemo(() => {
    const copia = texturaCarregada.clone()
    copia.colorSpace = THREE.SRGBColorSpace
    copia.needsUpdate = true
    return copia
  }, [texturaCarregada])

  const [x, y, z] = POSICAO_DO_FUNDO
  const s = ESCALA_DO_FUNDO
  return (
    <mesh
      position={[x, y, z]}
      rotation={[INCLINACAO_DO_FUNDO, 0, 0]}
      scale={[-s, s, s]}
    >      <cylinderGeometry
        args={[
          RAIO_DO_FUNDO,
          RAIO_DO_FUNDO,
          ALTURA_DO_FUNDO,
          64,
          1,
          true,
          INICIO_THETA_DO_FUNDO,
          ABERTURA_DO_FUNDO,
        ]}
      />
      <meshBasicMaterial
        map={textura}
        side={THREE.BackSide}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}

interface AmbienteCenaProps {
  /** Borda da moldura em px (PartidaMoldura): descontada do aspecto visível da névoa. */
  bordaPx?: number
  estadoExibicao?: EstadoExibicaoTabuleiro | null
  /** Estado de interação (seleção/manipulação) para cursor e destaques. */
  estadoInteracao?: EstadoInteracaoTabuleiro | null
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
  peaoSelecionadoId?: PeaoId | null
  /** Peão do Jogador Ativo da vez (destaque emissivo suave, #118). */
  peaoAtivoId?: PeaoId | null
  /** PecaIds destinos válidos do peão selecionado (derivado uma vez no pai). */
  destinosSet?: ReadonlySet<PecaId>
  /** Subconjunto de destinos de RESGATE (tom distinto; mesma fonte do pai). */
  resgateSet?: ReadonlySet<PecaId>
  /** Chaves das células iluminadas (issue #151; derivado uma vez no pai). */
  iluminadasSet?: ReadonlySet<string>
  onSelecionarPeao?: (peaoId: PeaoId) => void
  /** Clique em área vazia (Mesa/chão) desseleciona o peão. */
  onDesselecionar?: () => void
  /** Estado do ciclo do peão: roteia cliques em células/peças da mesa (#91). */
  estadoPeoes?: EstadoInteracaoPeoes | null
  /** Comando do ciclo do peão emitido pelo roteador (jogadorId injetado no pai). */
  onComandoPeao?: (comando: ComandoDePeaoDoDespacho) => void
  /** Rejeição local do roteador (guard pós-confirmação, AC3) → som de recusa no pai. */
  onRejeicaoPeao?: (motivo: MotivoDeRejeicaoLocal) => void
  /**
   * Pull aceito na bandeja da Caixa (fluxo #143/revisão #199): estado local
   * persistido no pai (AmbienteDeJogo), nunca viaja ao wire.
   */
  onPuxarPecaDaBandeja?: (recebidaId: string) => void
  /** Chaves das células-alvo de pendências ativas (destaque, #91). */
  alvosPendentesSet?: ReadonlySet<string>
  /** Chaves das vagas disponíveis para a pendência corrente (destaque, #143). */
  vagasSet?: ReadonlySet<string>
  /**
   * Subconjunto de vagas com pontinhos (peça puxada na bandeja): indica
   * visualmente onde a peça pode ser colocada; some ao posicionar. O gesto
   * da travessia (sem pull) não pontilha — mantém só o anel branco.
   */
  vagasPontilhadasSet?: ReadonlySet<string>
  /** Chaves das células do gesto da travessia (ADR-0017): anel branco — vagas
   * escuras clicáveis + célula travada da pendência em curso. */
  travessiaSet?: ReadonlySet<string>
  /** Peça sorteada corrente exibida na bandeja da Caixa (null = sem corrente, #143). */
  pecaCorrente?: PecaCorrente | null
  /**
   * Voo pendente do peão (issue #242): overlay até o pouso; null = sem voo.
   * Desce até o `Tabuleiro`, que avisa o pouso via `onVooAterrissou(nonce)`.
   */
  vooPendente?: VooDoPeaoPendente | null
  /** Pouso do voo concluído (nonce): a página limpa o pendente. */
  onVooAterrissou?: (nonce: number) => void
  /** Trigger de limpeza evento-driven (issue #239, B1). */
  limpezaTrigger?: LimpezaTrigger | null
  /** Trigger de encaixe evento-driven (issue #241): voo mesa→célula. */
  encaixeTrigger?: EncaixeTrigger | null
  /** Fim do voo do Encaixe (key) → o pai limpa o trigger. */
  onFimEncaixe?: (key: number) => void
  /**
   * Peões em Baixa Iluminação do dono (issue #297): peaoIds derivados uma vez
   * no pai — avatar do Diretor troca para a variante apagado só no peão
   * afetado, em todas as posições (célula/fileira/voo).
   */
  emBaixaIluminacaoPorPeaoId?: ReadonlySet<PeaoId>
  /**
   * Estado visual do ataque (issue #385, follow-up): prop única (peça em
   * telegraph + reações do alcance + peça em disparo) — tudo null fora do
   * slot ativo (apaga sem marcas).
   */
  estadoVisualDoAtaque?: EstadoVisualDoAtaque | null
}

// Estado/flag nulos: quando a cena é montada sem canal de interação (não-DEV
// sem alvo não monta a cena; DEV sem alvo pode), componentes ficam inertes.
const estadoInteracaoVazio: EstadoInteracaoTabuleiro = {
  iniciais: [],
  posicionadas: [],
  pecaSelecionadaId: null,
  pecaEmManipulacaoId: null,
}
function noop(): void {}

export function AmbienteCena({
  bordaPx = 0,
  estadoExibicao,
  estadoInteracao = null,
  onComando,
  peaoSelecionadoId = null,
  peaoAtivoId = null,
  destinosSet,
  resgateSet,
  iluminadasSet,
  onSelecionarPeao,

  onDesselecionar,
  estadoPeoes = null,
  onComandoPeao,
  onRejeicaoPeao,
  onPuxarPecaDaBandeja,
  alvosPendentesSet,
  vagasSet,
  vagasPontilhadasSet = new Set<string>(),
  travessiaSet = new Set<string>(),
  pecaCorrente = null,
  vooPendente = null,
  onVooAterrissou,
  limpezaTrigger = null,
  encaixeTrigger = null,
  onFimEncaixe,
  emBaixaIluminacaoPorPeaoId = new Set<PeaoId>(),
  estadoVisualDoAtaque = null,
}: AmbienteCenaProps) {
  // Peões não posicionados (celula === null) ficam em fileira sobre a Mesa,
  // lado oposto à zona da Caixa (-X). Índices preservam a ordem do estado.
  const peoesNaMesa = (estadoExibicao?.peoes ?? []).filter(
    (peao) => peao.celula === null,
  )
  // Snap com movimento reduzido: sem peça oculta — o estado final já está
  // renderizado e a TransicaoEncaixe também não anima (mesma leitura do hook).
  const reduce = usePrefersReducedMotion()
  const pecaEmVooId = reduce ? null : (encaixeTrigger?.pecaId ?? null)
  // #230: névoa gateada por aspecto — afastada só no largo-baixo (800x360),
  // padrão no desktop/tablet sem regressão de atmosfera.
  const tamanho = useThree((s) => s.size)
  const nevoa = useMemo(() => nevoaParaAspecto(aspectoVisivel(tamanho, bordaPx)), [tamanho, bordaPx])

  return (
    <>
      {/* Vazio quase-preto delimitando a cena, com fog no mesmo tom para profundidade. */}
      <color attach="background" args={[COR_FUNDO]} />
      <fog attach="fog" args={[COR_FUNDO, nevoa.perto, nevoa.longe]} />
      <Iluminacao />
      {/*
        Wrapper de desseleção (issue #90): clique em qualquer alvo inerte da
        cena (Mesa, célula vazia, peça não destino) borbulha até aqui e
        desseleciona. Peões e destinos válidos chamam stopPropagation e nunca
        chegam a este handler. Clique fora de qualquer mesh é tratado pelo
        onPointerMissed no Canvas (AmbienteDeJogo).
      */}
      <group onClick={onDesselecionar}>
        <Mesa />
        <NevoaDaMesa />
        <LimiteDeErroDoModelo resetKey={TEXTURA_DO_FUNDO} fallback={null}>
          <Suspense fallback={null}>
            <Fundo />
          </Suspense>
        </LimiteDeErroDoModelo>
        <DecoracoesDaMesa />
        {estadoExibicao ? (
          <>
            <Tabuleiro
              posicionadas={estadoExibicao.posicionadas}
              estadoInteracao={estadoInteracao ?? estadoInteracaoVazio}
              onComando={onComando ?? noop}
              peoes={estadoExibicao.peoes}
              peaoSelecionadoId={peaoSelecionadoId}
              peaoAtivoId={peaoAtivoId}
              destinosSet={destinosSet}
              resgateSet={resgateSet}
              iluminadasSet={iluminadasSet}
              onSelecionarPeao={onSelecionarPeao}
              estadoPeoes={estadoPeoes}
              onComandoPeao={onComandoPeao}
              onRejeicaoPeao={onRejeicaoPeao}
              alvosPendentesSet={alvosPendentesSet}
              vagasSet={vagasSet}
              vagasPontilhadasSet={vagasPontilhadasSet}
              travessiaSet={travessiaSet}
              vooPendente={vooPendente}
              onVooAterrissou={onVooAterrissou}
              ocultarPecaId={pecaEmVooId}
              estadoVisualDoAtaque={estadoVisualDoAtaque}
              emBaixaIluminacaoPorPeaoId={emBaixaIluminacaoPorPeaoId}
              ordemDeChegadaPorChave={estadoExibicao.ordemDeChegadaPorChave}
              quantidadeDePeoes={estadoExibicao.peoes.length}
            />
            <TransicaoEncaixe
              posicionadas={estadoExibicao.posicionadas}
              trigger={encaixeTrigger}
              onFim={onFimEncaixe}
            />
            <Caixa
              iniciais={estadoExibicao.iniciais}
              pecaCorrente={pecaCorrente}
              estadoInteracao={estadoInteracao ?? estadoInteracaoVazio}
              onComando={onComando ?? noop}
              estadoPeoes={estadoPeoes}
              onPuxar={onPuxarPecaDaBandeja}
            />
            <TransicaoLimpeza posicionadas={estadoExibicao.posicionadas} trigger={limpezaTrigger} />
            <BandejaDosPeoes />
            {peoesNaMesa.map((peao) => {
              // Voo ativo (#242): o peão voador não renderiza estático na Mesa
              // (Primeiro Turno: origem mesa→Peça Inicial) — só o overlay voa.
              if (deveSuprimirPeaoNaMesa(vooPendente ?? null, peao.peaoId)) {
                return null
              }
              const indiceGlobal = estadoExibicao.peoes.indexOf(peao)
              return (
                <PeaoVisual
                  key={peao.peaoId}
                  cor={peao.cor}
                  position={peaoMesaParaMundo(indiceGlobal, estadoExibicao.peoes.length)}
                  selecionado={peao.peaoId === peaoSelecionadoId}
                  ativo={peao.peaoId === peaoAtivoId}
                  emBaixaIluminacao={emBaixaIluminacaoPorPeaoId.has(peao.peaoId)}
                  aoClicar={
                    onSelecionarPeao
                      ? () => onSelecionarPeao(peao.peaoId)
                      : undefined
                  }
                />
              )
            })}
          </>
        ) : null}
      </group>
      {/* Janela de Manipulação 3D (experimental): irmão do grupo de
          desseleção — os cliques nos controles não desselecionam e o pan da
          câmera fica travado por conta dos controles (stopPropagation). */}
      <ManipulacaoOverlay
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao ?? null}
        estadoPeoes={estadoPeoes}
        onComando={onComando ?? noop}
      />
    </>
  )
}
