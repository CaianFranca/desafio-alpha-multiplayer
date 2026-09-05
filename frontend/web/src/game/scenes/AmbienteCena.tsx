import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import mesaTopoUrl from '../assets/mesa_topo.png'
import {
  COR_FUNDO,
  COR_LATERAIS_MESA,
  ESPESSURA_MESA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
} from '../ambiente/contrato'
import { Tabuleiro } from '../tabuleiro/Tabuleiro'
import { Caixa } from '../tabuleiro/Caixa'
import type { EstadoInteracaoTabuleiro } from '../tabuleiro/interacao'
import type { EstadoInteracaoPeoes, MotivoDeRejeicaoLocal } from '../tabuleiro/interacaoPeoes'
import type { PeaoComandoDoCliente, TabuleiroComandoDoCliente } from '@flicker/shared'
import { PeaoPlaceholder } from '../tabuleiro/PeaoPlaceholder'
import { peaoMesaParaMundo } from '../tabuleiro/contrato'
import { TransicaoLimpeza } from './TransicaoLimpeza'
import type {
  PeaoId,
  PecaId,
  PecaCorrente,
  EstadoExibicaoTabuleiro,
} from '../tabuleiro/contrato'

/**
 * Luzes sutis: o volume claro/escuro já vem "assado" na textura da Mesa
 * (centro claro, bordas escuras). As luzes existem só para leve modelagem
 * e profundidade — não devem lavar a textura.
 */
function Iluminacao() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 14, 6]} intensity={0.85} />
    </>
  )
}

/**
 * Mesa: box com o plano superior em y = 0 (origem do ambiente; ver
 * ambiente/contrato.ts). Face +y (índice de material 2) recebe a textura
 * aprovada; as demais faces são sólidas escuras, fundindo com o vazio.
 */
function Mesa() {
  const texturaCarregada = useLoader(THREE.TextureLoader, mesaTopoUrl)
  // Cópia com espaço de cor sRGB: o topo da Mesa é cor, não dado linear.
  // Clonar evita mutar a textura cacheada pelo useLoader.
  const textura = useMemo(() => {
    const copia = texturaCarregada.clone()
    copia.colorSpace = THREE.SRGBColorSpace
    copia.needsUpdate = true
    return copia
  }, [texturaCarregada])

  return (
    <mesh position={[0, -ESPESSURA_MESA / 2, 0]}>
      <boxGeometry args={[LARGURA_MESA, ESPESSURA_MESA, PROFUNDIDADE_MESA]} />
      <meshStandardMaterial attach="material-0" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-1" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-2" map={textura} />
      <meshStandardMaterial attach="material-3" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-4" color={COR_LATERAIS_MESA} />
      <meshStandardMaterial attach="material-5" color={COR_LATERAIS_MESA} />
    </mesh>
  )
}

interface AmbienteCenaProps {
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
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
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
  /** Peça sorteada corrente exibida na bandeja da Caixa (null = sem corrente, #143). */
  pecaCorrente?: PecaCorrente | null
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
  pecaCorrente = null,
}: AmbienteCenaProps) {
  // Peões não posicionados (celula === null) ficam em fileira sobre a Mesa,
  // lado oposto à zona da Caixa (-X). Índices preservam a ordem do estado.
  const peoesNaMesa = (estadoExibicao?.peoes ?? []).filter(
    (peao) => peao.celula === null,
  )

  return (
    <>
      {/* Vazio quase-preto delimitando a cena, com fog no mesmo tom para profundidade. */}
      <color attach="background" args={[COR_FUNDO]} />
      <fog attach="fog" args={[COR_FUNDO, 24, 70]} />
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
            />
            <Caixa
              iniciais={estadoExibicao.iniciais}
              pecaCorrente={pecaCorrente}
              estadoInteracao={estadoInteracao ?? estadoInteracaoVazio}
              onComando={onComando ?? noop}
              estadoPeoes={estadoPeoes}
              onPuxar={onPuxarPecaDaBandeja}
            />
            <TransicaoLimpeza posicionadas={estadoExibicao.posicionadas} />
            {peoesNaMesa.map((peao) => {
              const indiceGlobal = estadoExibicao.peoes.indexOf(peao)
              return (
                <PeaoPlaceholder
                  key={peao.peaoId}
                  cor={peao.cor}
                  position={peaoMesaParaMundo(indiceGlobal)}
                  selecionado={peao.peaoId === peaoSelecionadoId}
                  ativo={peao.peaoId === peaoAtivoId}
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
    </>
  )
}
