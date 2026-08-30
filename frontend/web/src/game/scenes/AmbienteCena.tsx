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
import { Reserva } from '../tabuleiro/Reserva'
import type { EstadoExibicaoTabuleiro } from '../tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../tabuleiro/interacao'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

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
}

// Estado/flag nulos: quando a cena é montada sem canal de interação (não-DEV
// sem alvo não monta a cena; DEV sem alvo pode), componentes ficam inertes.
const estadoInteracaoVazio: EstadoInteracaoTabuleiro = {
  reserva: [],
  posicionadas: [],
  pecaSelecionadaId: null,
  pecaEmManipulacaoId: null,
}
function noop(): void {}

export function AmbienteCena({
  estadoExibicao,
  estadoInteracao = null,
  onComando,
}: AmbienteCenaProps) {
  return (
    <>
      {/* Vazio quase-preto delimitando a cena, com fog no mesmo tom para profundidade. */}
      <color attach="background" args={[COR_FUNDO]} />
      <fog attach="fog" args={[COR_FUNDO, 24, 70]} />
      <Iluminacao />
      <Mesa />
      {estadoExibicao ? (
        <>
          <Tabuleiro
            posicionadas={estadoExibicao.posicionadas}
            estadoInteracao={estadoInteracao ?? estadoInteracaoVazio}
            onComando={onComando ?? noop}
          />
          <Reserva
            reserva={estadoExibicao.reserva}
            estadoInteracao={estadoInteracao ?? estadoInteracaoVazio}
            onComando={onComando ?? noop}
          />
        </>
      ) : null}
    </>
  )
}
