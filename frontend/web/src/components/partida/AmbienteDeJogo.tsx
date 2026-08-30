import { Canvas } from '@react-three/fiber'
import {
  FOV_CAMERA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  descreverCameraFixa,
} from '../../game/ambiente/contrato'
import { AmbienteCena } from '../../game/scenes/AmbienteCena'
import { useCameraInterativa } from '../../hooks/useCameraInterativa'
import {
  chaveCelula,
  criarEstadoExibicaoMock,
  todasAsCelulas,
} from '../../game/tabuleiro/contrato'
import type { EstadoDaTela } from './partidaTelaMachine'

const cameraFixa = descreverCameraFixa(LARGURA_MESA, PROFUNDIDADE_MESA, FOV_CAMERA)

interface CameraRigProps {
  bordaPx?: number
}

function CameraRig({ bordaPx = 0 }: CameraRigProps) {
  useCameraInterativa({ bordaPx })
  return null
}

interface AmbienteDeJogoProps {
  bordaPx?: number
  estado?: EstadoDaTela | null
}

export function AmbienteDeJogo({ bordaPx = 0, estado = null }: AmbienteDeJogoProps) {
  const estadoExibicao = estado === 'disponivel' ? criarEstadoExibicaoMock() : null
  const todasCelulas = todasAsCelulas()
  const ocupadasSet = new Set(
    estadoExibicao?.posicionadas.map((p) => chaveCelula(p.celula)) ?? [],
  )

  return (
    <div
      data-testid="ambiente-de-jogo"
      role="img"
      aria-label="Ambiente de Jogo"
      className="absolute inset-0 h-full w-full"
      style={{ touchAction: 'none' }}
    >
      <Canvas
        camera={{ fov: FOV_CAMERA, position: cameraFixa.posicao }}
        frameloop="demand"
        // Alpha desativado: o canvas é opaco e o vazio vem do clear do fundo.
        // Com alpha ativo, o alpha da textura vaza para o compositor (issue #75).
        gl={{ alpha: false }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        fallback={
          <div
            data-testid="ambiente-canvas-fallback"
            className="absolute inset-0 h-full w-full"
          />
        }
      >
        <CameraRig bordaPx={bordaPx} />
        <AmbienteCena estadoExibicao={estadoExibicao} />
      </Canvas>
      {/* Mirror DOM para testes (jsdom sem WebGL): expõe 49 células + 22 reserva quando disponivel */}
      {estadoExibicao ? (
        <div data-testid="tabuleiro" aria-hidden="true" className="pointer-events-none absolute inset-0">
          {todasCelulas.map((celula) => {
            const ocupada = ocupadasSet.has(chaveCelula(celula))
            return (
              <div
                key={chaveCelula(celula)}
                data-testid="tabuleiro-celula"
                data-ocupada={ocupada ? 'true' : 'false'}
                data-linha={celula.linha}
                data-coluna={celula.coluna}
              />
            )
          })}
          <div data-testid="reserva">
            {estadoExibicao.reserva.map((peca) => (
              <div
                key={peca.pecaId}
                data-testid="reserva-peca"
                data-tipo={peca.tipo}
                data-peca-id={peca.pecaId}
              />
            ))}
          </div>
          {estadoExibicao.posicionadas.map((p) => (
            <div key={p.pecaId} data-testid="peca-posicionada" data-peca-id={p.pecaId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
