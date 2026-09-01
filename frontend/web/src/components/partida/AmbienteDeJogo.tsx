import { useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  FOV_CAMERA,
  LARGURA_MESA,
  PROFUNDIDADE_MESA,
  descreverCameraFixa,
} from '../../game/ambiente/contrato'
import { AmbienteCena } from '../../game/scenes/AmbienteCena'
import { useCameraInterativa } from '../../hooks/useCameraInterativa'
import type { EstadoExibicaoTabuleiro } from '../../game/tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../../game/tabuleiro/interacao'
import type { FlashFeedback } from '../../game/tabuleiro/interacao'
import type { PeaoComandoDoCliente, RecebidaId, TabuleiroComandoDoCliente } from '@flicker/shared'
import {
  chaveCelula,
  destinosConectadosDoPeao,
  todasAsCelulas,
} from '../../game/tabuleiro/contrato'
import type { PeaoId } from '../../game/tabuleiro/contrato'
import { TabuleiroMirrorDOM } from './TabuleiroMirrorDOM'
import { mapearCliqueNoPeao } from '../../game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../../game/tabuleiro/interacaoPeoes'

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
  /**
   * Estado de exibição da cena. Antes era derivado de `criarEstadoExibicaoMock()`
   * quando o estado da tela era 'disponivel'; agora vem do modelo do cliente
   * (reserva/posicionadas/peoes aplicados por evento) ou do mock DEV.
   */
  estadoExibicao?: EstadoExibicaoTabuleiro | null
  /** Estado de interação do tabuleiro (seleção/manipulação) para cursor e destaques. */
  estadoInteracao?: EstadoInteracaoTabuleiro | null
  /** Estado de interação dos peões (derivado do modelo para mapeamento de cliques). */
  estadoInteracaoPeoes?: EstadoInteracaoPeoes | null
  /** Callback de comando de tabuleiro (null = sem ação) → enviar ao WS. */
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
  /** Callback de comando de peão (com jogadorId já injetado pelo pai). */
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
  /** Callback de rejeição de peão (flash vermelho). */
  onRejeicaoPeao?: (feedback: FlashFeedback) => void
  /** Peão selecionado vindo do modelo/servidor (null = nenhum). */
  peaoSelecionadoIdServidor?: PeaoId | null
  /** Peão do Jogador Ativo da vez (destaque, #118). */
  peaoAtivoId?: PeaoId | null
}

export function AmbienteDeJogo({
  bordaPx = 0,
  estadoExibicao = null,
  estadoInteracao = null,
  estadoInteracaoPeoes = null,
  onComando,
  onComandoPeao,
  onRejeicaoPeao,
  peaoSelecionadoIdServidor = null,
  peaoAtivoId = null,
}: AmbienteDeJogoProps) {
  // ── Seleção de peão: o servidor é a autoridade ──
  // `peaoSelecionadoIdLocal` espelha o servidor, mas permite desseleção visual
  // por clique em área inerte (sem comando de desseleção no ciclo). A seleção
  // do servidor é aplicada à renderização sempre que o valor muda (padrão
  // "ajustar estado quando a prop muda", sem efeito).
  const [peaoSelecionadoIdLocal, setPeaoSelecionadoIdLocal] = useState<PeaoId | null>(peaoSelecionadoIdServidor)
  const [servidorAnterior, setServidorAnterior] = useState<PeaoId | null>(peaoSelecionadoIdServidor)
  if (peaoSelecionadoIdServidor !== servidorAnterior) {
    setServidorAnterior(peaoSelecionadoIdServidor)
    // Nova seleção do servidor re-estabelece a autoridade sobre o estado local.
    setPeaoSelecionadoIdLocal(peaoSelecionadoIdServidor)
  }

  // Clicar um peão seleciona (ou emite comando ao servidor se disponível);
  // clicar destino inerte/Mesa/vazio desseleciona. A seleção otimista acontece
  // APÓS o mapeamento: rejeição (pendências bloqueando outro peão) não altera
  // a seleção local (#91 — antes selecionava antes de mapear).
  const aoSelecionarPeao = useCallback(
    (peaoId: PeaoId) => {
      if (estadoInteracaoPeoes && onComandoPeao) {
        const resultado = mapearCliqueNoPeao(estadoInteracaoPeoes, peaoId)
        if (resultado?.tipo === 'rejeicao') {
          onRejeicaoPeao?.(resultado.rejeicao.feedback)
          return
        }
        if (resultado?.tipo === 'comando') {
          onComandoPeao(resultado.comando)
        }
      }
      setPeaoSelecionadoIdLocal(peaoId)
    },
    [estadoInteracaoPeoes, onComandoPeao, onRejeicaoPeao],
  )
  const aoDesselecionar = useCallback(() => {
    setPeaoSelecionadoIdLocal(null)
  }, [])

  // ── Foco local de pendências de Recebimento (#91, decisão 1) ──
  // Dono do foco: clicar célula-alvo de pendência SEM tipo foca a pendência;
  // clicar peça da Reserva envia ESCOLHER_TIPO para a focada. O foco é
  // validado contra as pendências vigentes (pendência resolvida/tipada ou
  // lista vazia derrubam o foco — derivação, sem efeito de reset).
  const [recebidaFocadaId, setRecebidaFocadaId] = useState<RecebidaId | null>(null)
  const aoFocarPendencia = useCallback((recebidaId: RecebidaId) => {
    setRecebidaFocadaId(recebidaId)
  }, [])
  const recebidasPendentes = estadoInteracaoPeoes?.recebidasPendentes ?? []
  const focadaVigente =
    recebidasPendentes.find(
      (r) => r.recebidaId === recebidaFocadaId && r.pecaId === null,
    ) ?? null
  const recebidaFocadaVigenteId: RecebidaId | null = focadaVigente?.recebidaId ?? null
  // Alvos de pendências ativas: mesmo padrão do destinosSet (chaves derivadas
  // no pai, fonte única para cena e espelho DOM). Forma nova (#138): sem vaga
  // escolhida, celulaAlvo é null — não gera alvo.
  const alvosPendentesSet = new Set<string>(
    recebidasPendentes
      // Forma nova (#138): célula-alvo ainda indefinida (null) até a escolha
      // da vaga — sem alvo a destacar nesta pendência.
      .map((r) => (r.celulaAlvo !== null ? chaveCelula(r.celulaAlvo) : null))
      .filter((k): k is string => k !== null),
  )
  const alvoFocadoKey: string | null =
    focadaVigente && focadaVigente.celulaAlvo !== null
      ? chaveCelula(focadaVigente.celulaAlvo)
      : null

  const todasCelulas = todasAsCelulas()
  const ocupadasSet = new Set(
    estadoExibicao?.posicionadas.map((p) => chaveCelula(p.celula)) ?? [],
  )
  // Destinos válidos do peão selecionado: mesmo conjunto deriva destaque/cursor
  // na cena e data-conectada no espelho DOM (fonte única de verdade).
  const destinosSet = new Set<string>(
    estadoExibicao && peaoSelecionadoIdLocal !== null
      ? destinosConectadosDoPeao(
          estadoExibicao.posicionadas,
          estadoExibicao.peoes,
          peaoSelecionadoIdLocal,
        ).map((peca) => peca.pecaId)
      : [],
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
        // Clique fora de qualquer objeto da cena também desseleciona (#90).
        onPointerMissed={aoDesselecionar}
        fallback={
          <div
            data-testid="ambiente-canvas-fallback"
            className="absolute inset-0 h-full w-full"
          />
        }
      >
        <CameraRig bordaPx={bordaPx} />
        <AmbienteCena
          estadoExibicao={estadoExibicao}
          estadoInteracao={estadoInteracao}
          onComando={onComando}
          peaoSelecionadoId={peaoSelecionadoIdLocal}
          peaoAtivoId={peaoAtivoId}
          destinosSet={destinosSet}
          onSelecionarPeao={aoSelecionarPeao}
          onDesselecionar={aoDesselecionar}
          estadoPeoes={estadoInteracaoPeoes}
          onComandoPeao={onComandoPeao}
          alvosPendentesSet={alvosPendentesSet}
          alvoFocadoKey={alvoFocadoKey}
          recebidaFocadaId={recebidaFocadaVigenteId}
          aoFocarPendencia={aoFocarPendencia}
        />
      </Canvas>
      {estadoExibicao ? (
        <TabuleiroMirrorDOM
          todasCelulas={todasCelulas}
          ocupadasSet={ocupadasSet}
          reserva={estadoExibicao.reserva}
          posicionadas={estadoExibicao.posicionadas}
          peoes={estadoExibicao.peoes}
          peaoSelecionadoId={peaoSelecionadoIdLocal}
          peaoAtivoId={peaoAtivoId}
          destinosSet={destinosSet}
          aoSelecionarPeao={aoSelecionarPeao}
          aoDesselecionar={aoDesselecionar}
          estadoInteracao={estadoInteracao}
          estadoPeoes={estadoInteracaoPeoes}
          onComando={onComando}
          onComandoPeao={onComandoPeao}
          recebidaFocadaId={recebidaFocadaVigenteId}
          aoFocarPendencia={aoFocarPendencia}
          alvosPendentesSet={alvosPendentesSet}
          alvoFocadoKey={alvoFocadoKey}
        />
      ) : null}
    </div>
  )
}
