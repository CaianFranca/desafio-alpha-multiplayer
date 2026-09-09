/**
 * Overlay 3D da janela de Manipulação (experimental).
 *
 * Controles sobre a peça encaixada, todos como planos horizontais (vistos de
 * cima, flutuando acima da peça): seta LESTE gira horário, seta OESTE gira
 * anti-horário — as duas setas apontam para o norte (topo da textura) com a
 * curvatura espelhada (LESTE curva para OESTE; OESTE curva para LESTE) — e o
 * botão "OK" no sul finaliza a manipulação.
 *
 * Eventos:
 * - `onPointerDown` com `nativeEvent.stopPropagation()`: impede o pan da
 *   câmera de engatar (os handlers vivem no `canvas.parentElement` — ver
 *   `useCameraInterativa`); o clique da criação do browser continua normal.
 * - `onClick` com `stopPropagation()` (ThreeEvent): não vaza para o grupo de
 *   desseleção da cena.
 *
 * Só monta com `pecaEmManipulacaoId` apontando para uma peça posicionada —
 * ou seja, só PÓS-ENCAIXE (rotação pré-encaixe via teclas R/E permanece).
 */
import { useCallback, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'
import type { EstadoExibicaoTabuleiro } from '../tabuleiro/contrato'
import { celulaParaMundo } from '../tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../tabuleiro/interacao'
import {
  mapearFinalizarManipulacao,
  mapearGiro,
} from '../tabuleiro/interacao'
import { handlersDeCursor } from '../tabuleiro/cursor'

// ── Geometria do overlay ──
// Botões e setas são planos horizontais (vistos de cima), flutuando acima da
// peça. O topo da textura vira "norte" (mundo −Z) com a rotação −π/2 em X.
const ALTURA_OVERLAY = 0.35
const RAIO_BOTOES = 0.65
const OFFSET_OK = 1.0

const COR_DA_SETA = '#275331e1'
const COR_DO_OK = '#89bb61'
const COR_DO_TEXTO_OK = '#ffffff'

/**
 * Textura "OK" desenhada em canvas.
 */
function criarTexturaOK(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const raio = 32
  
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Botão Verde (Original)
  ctx.fillStyle = COR_DO_OK
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, raio)
  ctx.fill()

  ctx.fillStyle = COR_DO_TEXTO_OK
  ctx.font = 'bold 70px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('OK', canvas.width / 2, canvas.height / 2 + 4)

  const textura = new THREE.CanvasTexture(canvas)
  textura.colorSpace = THREE.SRGBColorSpace
  return textura
}

/**
 * Textura da Seta CURVADA desenhada em canvas — arco longo que contorna a borda
 * lateral externa da peça ("barriga" voltada para fora) e ponta estilizada na
 * base apontando para o SUL em direção ao canto inferior/centro da peça.
 *
 * Com `espelhada = true`, o canvas é invertido no eixo horizontal (X) para gerar
 * o lado oposto mantendo a curvatura externa e o direcionamento convergente no sul.
 * A ponta com reentrância na base sobrepõe o término do arco, garantindo encaixe
 * contínuo e sem emendas visíveis.
 */
function criarTexturaSeta(espelhada = false): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (espelhada) {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }

  const CORPO = '#275331e1'
  ctx.fillStyle = CORPO
  ctx.strokeStyle = CORPO

  // 1. Arco curvo descendo pelo lado de fora com barriga externa (para a esquerda)
  ctx.beginPath()
  ctx.lineWidth = 45
  ctx.lineCap = 'round'

  // Curva de Bézier: nasce no norte e desce para o sul
  ctx.moveTo(175, 82) // Cauda superior
  ctx.bezierCurveTo(45, 172, 45, 342, 160, 417) // Barriga externa arredondada
  ctx.stroke()

  // 2. Ponta da seta estilizada apontando para baixo / sul-sudeste
  ctx.beginPath()
  ctx.lineJoin = 'round'
  // Vértice da ponta (apontando para baixo)
  ctx.moveTo(200, 460)
  // Asa direita inferior
  ctx.lineTo(182, 374)
  // Chanfro interno / reentrância da base
  ctx.lineTo(152, 414)
  // Asa esquerda inferior
  ctx.lineTo(125, 444)
  ctx.closePath()
  ctx.fill()

  const textura = new THREE.CanvasTexture(canvas)
  textura.colorSpace = THREE.SRGBColorSpace
  return textura
}

interface ManipulacaoOverlayProps {
  estadoExibicao?: EstadoExibicaoTabuleiro | null
  estadoInteracao?: EstadoInteracaoTabuleiro | null
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
}

export function ManipulacaoOverlay({
  estadoExibicao,
  estadoInteracao = null,
  onComando,
}: ManipulacaoOverlayProps) {
  const pecaEmManipulacaoId = estadoInteracao?.pecaEmManipulacaoId ?? null
  const peca = pecaEmManipulacaoId
    ? (estadoExibicao?.posicionadas.find(
        (p) => p.pecaId === pecaEmManipulacaoId,
      ) ?? null)
    : null

  const texturaOK = useMemo(() => criarTexturaOK(), [])
  // Giro HORÁRIO (LESTE): usa a textura espelhada — a "barriga" da curvatura
  // dessa seta cai para o OESTE, leitura percebida como horária. O LESTE curva
  // para o OESTE (e vice-versa): setas inversas em relação à base.
  const texturaSetaOeste = useMemo(() => criarTexturaSeta(false), [])
  const texturaSetaLeste = useMemo(() => criarTexturaSeta(true), [])

  // Pan da câmera escuta `pointerdown` no `canvas.parentElement` (useCamera
  // Interativa): parar a propagação nativa aqui impede o arrasto de engatar.
  const impedirArrasto = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.nativeEvent.stopPropagation()
  }, [])

  if (peca === null) return null

  const pos = celulaParaMundo(peca.celula)
  const comandar = (comando: TabuleiroComandoDoCliente) => onComando?.(comando)
  const cursor = handlersDeCursor('pointer')

  return (
    <group position={[pos[0], pos[1] + ALTURA_OVERLAY, pos[2]]}>
      {/* Seta da Direita (Leste) */}
      <mesh
        position={[RAIO_BOTOES, 0, -0.05]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        renderOrder={51}
        onPointerDown={impedirArrasto}
        onClick={(e) => {
          e.stopPropagation()
          comandar(mapearGiro(peca.pecaId, 'horario'))
        }}
        {...cursor}
      >
        <planeGeometry args={[1.0, 1.5]} />
        <meshBasicMaterial
          map={texturaSetaLeste ?? undefined}
          color={COR_DA_SETA}
          transparent
          alphaTest={0.1}
          toneMapped={false}
        />
      </mesh>

      {/* Seta da Esquerda (Oeste) */}
      <mesh
        position={[-RAIO_BOTOES, 0, -0.05]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        renderOrder={51}
        onPointerDown={impedirArrasto}
        onClick={(e) => {
          e.stopPropagation()
          comandar(mapearGiro(peca.pecaId, 'anti_horario'))
        }}
        {...cursor}
      >
        <planeGeometry args={[1.0, 1.5]} />
        <meshBasicMaterial
          map={texturaSetaOeste ?? undefined}
          color={COR_DA_SETA}
          transparent
          alphaTest={0.1}
          toneMapped={false}
        />
      </mesh>

      {/* OK: Botão plano visto de cima, posicionado ao sul da peça. */}
      <mesh
        position={[0, 0, -OFFSET_OK]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        renderOrder={52}
        onPointerDown={impedirArrasto}
        onClick={(e) => {
          e.stopPropagation()
          comandar(mapearFinalizarManipulacao())
        }}
        {...cursor}
      >
        <planeGeometry args={[0.7, 0.35]} />
        <meshBasicMaterial
          map={texturaOK ?? undefined}
          color={texturaOK ? '#ffffff' : COR_DO_OK}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
