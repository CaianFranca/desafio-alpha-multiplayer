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
import type { EstadoExibicaoTabuleiro, PecaCorrente } from '../../game/tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../../game/tabuleiro/interacao'
import type { PeaoComandoDoCliente, TabuleiroComandoDoCliente } from '@flicker/shared'
import {
  chaveCelula,
  destinosConectadosDoPeao,
  todasAsCelulas,
} from '../../game/tabuleiro/contrato'
import type { PeaoId } from '../../game/tabuleiro/contrato'
import type { EstadoVisualDoAtaque } from '../../game/tabuleiro/ataque'
import { TabuleiroMirrorDOM } from './TabuleiroMirrorDOM'
import {
  mapearCliqueNoPeao,
  mapearDesselecaoDePeao,
  peaoDeReferenciaDaSequencia,
  puxadaVigenteNaBandeja,
  vagasDisponiveisDoPeao,
} from '../../game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes, MotivoDeRejeicaoLocal, PendenciaNoCliente } from '../../game/tabuleiro/interacaoPeoes'
import type { SanidadePorPeao } from '../../game/tabuleiro/reducao'
import type { VooDoPeaoPendente } from '../../game/tabuleiro/vooDoPeao'
import type { LimpezaTrigger } from '../../game/scenes/TransicaoLimpeza'
import type { EncaixeTrigger } from '../../game/tabuleiro/encaixe'

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
   * (iniciais/posicionadas/peoes aplicados por evento) ou do mock DEV.
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
  /** Rejeição local do roteador (guard pós-confirmação, AC3) → som de recusa no pai. */
  onRejeicaoPeao?: (motivo: MotivoDeRejeicaoLocal) => void
  /** Peão selecionado vindo do modelo/servidor (null = nenhum). */
  peaoSelecionadoIdServidor?: PeaoId | null
  /** Peão do Jogador Ativo da vez (destaque, #118). */
  peaoAtivoId?: PeaoId | null
  /** Percepção mínima de Sanidade e estados (ST-15, issue #174) — peaoId → sanidade/estados. */
  sanidadePorPeao?: SanidadePorPeao
  /**
   * Voo pendente do peão (issue #242): overlay até o pouso; null = sem voo.
   * Desce até a cena, que avisa o pouso via `onVooAterrissou(nonce)`.
   */
  vooPendente?: VooDoPeaoPendente | null
  /** Pouso do voo concluído (nonce): a página limpa o pendente. */
  onVooAterrissou?: (nonce: number) => void
  /** Trigger de limpeza evento-driven (issue #239, B1) — só LIMPEZA_APLICADA dispara, snapshot não. */
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
   * N do roster para o teto do Portão (#284): obrigatório — o teto é o N
   * real de jogadores (clamp 2..4 no pai), nunca peoes.length (risco 5).
   */
  quantidadeDeJogadores: number
  /**
   * Estado visual do ataque (issue #385, follow-up): prop única (peça em
   * telegraph + reações do alcance + peça em disparo) — tudo null fora do
   * slot ativo (a cena 3D e o espelho DOM apagam sem marcas).
   */
  estadoVisualDoAtaque?: EstadoVisualDoAtaque | null
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
  sanidadePorPeao = {},
  vooPendente = null,
  onVooAterrissou,
  limpezaTrigger = null,
  encaixeTrigger = null,
  onFimEncaixe,
  emBaixaIluminacaoPorPeaoId = new Set<PeaoId>(),
  quantidadeDeJogadores,
  estadoVisualDoAtaque = null,
}: AmbienteDeJogoProps) {
  // ── Seleção de peão: o servidor é a autoridade total (issue #249) ──
  // Sem espelho local divergente: o highlight e o roteamento derivam da prop
  // `peaoSelecionadoIdServidor` (modelo + snapshot/eventos). A desseleção é
  // autoritativa — `aoDesselecionar` despacha DESELECIONAR_PEAO ao servidor e
  // o ack/snapshot reconcilia; nunca se limpa só no Local.
  const peaoSelecionadoIdLocal: PeaoId | null = peaoSelecionadoIdServidor ?? null

  // Clicar um peão seleciona via mapeador puro (com gate "Inicial primeiro" e
  // bloqueio de pendências); rejeição não altera nada (#91). Sem estado
  // otimista: o servidor confirma via PEAO_SELECIONADO.
  const aoSelecionarPeao = useCallback(
    (peaoId: PeaoId) => {
      if (estadoInteracaoPeoes && onComandoPeao) {
        const resultado = mapearCliqueNoPeao(estadoInteracaoPeoes, peaoId)
        if (resultado?.tipo === 'rejeicao') {
          onRejeicaoPeao?.(resultado.rejeicao.motivo)
          return
        }
        if (resultado?.tipo === 'comando') {
          onComandoPeao(resultado.comando)
        }
      }
    },
    [estadoInteracaoPeoes, onComandoPeao, onRejeicaoPeao],
  )
  const aoDesselecionar = useCallback(() => {
    if (estadoInteracaoPeoes && onComandoPeao) {
      const resultado = mapearDesselecaoDePeao(estadoInteracaoPeoes)
      if (resultado?.tipo === 'rejeicao') {
        onRejeicaoPeao?.(resultado.rejeicao.motivo)
        return
      }
      if (resultado?.tipo === 'comando') {
        onComandoPeao(resultado.comando)
      }
    }
  }, [estadoInteracaoPeoes, onComandoPeao, onRejeicaoPeao])

  // ── Caixa sobre a mesa (issue #143): corrente da bandeja e vagas ──
  // Pendências do ciclo (forma #138): a CORRENTE é a primeira sem vaga — a
  // única exibida na bandeja de slot único. Vagas disponíveis derivam do
  // mesmo roteador puro (`vagasDisponiveisDoPeao`) e destacam as células
  // enquanto há pendência sem vaga — fonte única cena + espelho DOM.
  const recebidasPendentes = estadoInteracaoPeoes?.recebidasPendentes ?? []

  // ── Pull da bandeja (fluxo aprovado na revisão #199) ──
  // Estado visual LOCAL, fora do modelo autoritativo: clicar a corrente
  // "puxa" a peça, e só então o clique em vaga escolhe a vaga para ela. O
  // pull é consumido quando a pendência sai da lista (encaixe, troca de
  // turno) — a próxima corrente exige novo pull. O reset é um update-de-
  // render na mesma fase, sem efeito colateral. A seleção do peão, ao
  // contrário do pull, é autoritativa do servidor (#249) e nunca é mesclada
  // aqui — o roteador usa o estado do modelo + pull.
  const [recebidaPuxadaId, setRecebidaPuxadaId] = useState<string | null>(null)
  if (
    recebidaPuxadaId !== null &&
    !recebidasPendentes.some((r) => r.recebidaId === recebidaPuxadaId)
  ) {
    setRecebidaPuxadaId(null)
  }
  // Estado do ciclo com o pull mesclado (issue #249): roteador, cena e
  // espelho veem a mesma fonte — o modelo autoritativo + pull local; a
  // seleção vem do servidor (snapshot/eventos), nunca de espelho divergente.
  // O pull nunca vai ao wire (segue local até ESCOLHER_VAGA).
  const estadoPeoesComPuxada: EstadoInteracaoPeoes | null =
    estadoInteracaoPeoes !== null
      ? { ...estadoInteracaoPeoes, recebidaPuxadaId }
      : null

  const alvosPendentesSet = new Set<string>(
    recebidasPendentes
      // Sem vaga escolhida, célula-alvo é null — sem alvo a destacar.
      .map((r) => (r.celulaAlvo !== null ? chaveCelula(r.celulaAlvo) : null))
      .filter((k): k is string => k !== null),
  )
  const corrente: PendenciaNoCliente | null =
    recebidasPendentes.find((r) => r.vaga === null) ?? null
  const pecaCorrente: PecaCorrente | null =
    corrente !== null
      ? {
          recebidaId: corrente.recebidaId,
          pecaId: corrente.pecaId,
          tipo: corrente.tipoDaPeca,
          orientacao: corrente.orientacao ?? 0,
        }
      : null
  // Gate experimental da janela de Manipulação 3D: durante a manípulação a
  // bandeja fica oculta (a próxima corrente só volta após o OK). Vale para
  // cena e espelho — fonte única dessa derivação de exibição.
  const manipulacaoAtiva = estadoInteracao?.pecaEmManipulacaoId != null
  const pecaCorrenteNaBandeja: PecaCorrente | null = manipulacaoAtiva
    ? null
    : pecaCorrente
  // O destaque de vaga segue o clique: só aparece com a corrente PUXADA
  // (alvo inválido sem pull não reage — padrão #91; espectador nunca puxa,
  // logo nunca vê vaga destacada). A vigência do pull vem do predicado puro
  // compartilhado com cena e espelho.
  const vagasSet = new Set<string>(
    estadoPeoesComPuxada !== null &&
      peaoDeReferenciaDaSequencia(estadoPeoesComPuxada) !== null &&
      puxadaVigenteNaBandeja(estadoPeoesComPuxada)
      ? vagasDisponiveisDoPeao(estadoPeoesComPuxada).map((v) => chaveCelula(v.celula))
      : [],
  )

  // O mapeador puro decide o pull (gate de espectador incluso); o pai só
  // persiste o resultado como estado local.
  const aoPuxarPecaDaBandeja = useCallback((recebidaId: string) => {
    setRecebidaPuxadaId(recebidaId)
  }, [])

  const todasCelulas = todasAsCelulas()
  const ocupadasSet = new Set(
    estadoExibicao?.posicionadas.map((p) => chaveCelula(p.celula)) ?? [],
  )
  // Células iluminadas (issue #151): mesmo padrão de alvosPendentesSet/
  // destinosSet — chave "linha:coluna" derivada uma vez no pai, fonte única
  // para o destaque na cena e para data-iluminada no espelho DOM.
  const iluminadasSet = new Set<string>(
    (estadoExibicao?.celulasIluminadas ?? []).map((celula) => chaveCelula(celula)),
  )
  // Destinos válidos do peão selecionado: mesmo conjunto deriva destaque/cursor
  // na cena e data-conectada no espelho DOM (fonte única de verdade). Após a
  // Confirmação de Posição os destinos somem — o peão está travado no turno
  // (guard AC3 do roteador; a regra vive em um só lugar). A projeção de
  // afetados (exceção de resgate #171) vem do estado do ciclo, derivado do
  // modelo; Monstros posicionados saem dos destinos (espelho do engine).
  const destinosDoPeao =
    estadoExibicao &&
    peaoSelecionadoIdLocal !== null &&
    !estadoInteracaoPeoes?.posicaoConfirmadaNoTurno
      ? destinosConectadosDoPeao(
          estadoExibicao.posicionadas,
          estadoExibicao.peoes,
          peaoSelecionadoIdLocal,
          estadoInteracaoPeoes?.afetadosPorPeaoId,
          quantidadeDeJogadores,
          estadoInteracaoPeoes?.pecaDoInicioDoTurnoId,
        )
      : []
  const destinosSet = new Set<string>(destinosDoPeao.map((d) => d.peca.pecaId))
  // Subconjunto de resgate: só muda o tom do destaque (cena) e o
  // `data-resgate` (espelho); o clique segue emitindo o mesmo MOVER_PEAO.
  const resgateSet = new Set<string>(
    destinosDoPeao.filter((d) => d.tipo === 'resgate').map((d) => d.peca.pecaId),
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
        // Sombras ligadas (auto-sombra da caixa/cesta + sombra na Mesa).
        shadows
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
          bordaPx={bordaPx}
          estadoExibicao={estadoExibicao}
          estadoInteracao={estadoInteracao}
          onComando={onComando}
          peaoSelecionadoId={peaoSelecionadoIdLocal}
          peaoAtivoId={peaoAtivoId}
          destinosSet={destinosSet}
          resgateSet={resgateSet}
          iluminadasSet={iluminadasSet}
          onSelecionarPeao={aoSelecionarPeao}
          onDesselecionar={aoDesselecionar}
          estadoPeoes={estadoPeoesComPuxada}
          onComandoPeao={onComandoPeao}
          onRejeicaoPeao={onRejeicaoPeao}
          onPuxarPecaDaBandeja={aoPuxarPecaDaBandeja}
          alvosPendentesSet={alvosPendentesSet}
          vagasSet={vagasSet}
          pecaCorrente={pecaCorrenteNaBandeja}
          vooPendente={vooPendente}
          onVooAterrissou={onVooAterrissou}
          limpezaTrigger={limpezaTrigger}
          encaixeTrigger={encaixeTrigger}
          onFimEncaixe={onFimEncaixe}
          emBaixaIluminacaoPorPeaoId={emBaixaIluminacaoPorPeaoId}
          estadoVisualDoAtaque={estadoVisualDoAtaque}
        />
      </Canvas>
      {estadoExibicao ? (
        <TabuleiroMirrorDOM
          todasCelulas={todasCelulas}
          ocupadasSet={ocupadasSet}
          iluminadasSet={iluminadasSet}
          iniciais={estadoExibicao.iniciais}
          pecaCorrente={pecaCorrenteNaBandeja}
          posicionadas={estadoExibicao.posicionadas}
          peoes={estadoExibicao.peoes}
          peaoSelecionadoId={peaoSelecionadoIdLocal}
          peaoAtivoId={peaoAtivoId}
          destinosSet={destinosSet}
          resgateSet={resgateSet}
          aoSelecionarPeao={aoSelecionarPeao}
          aoDesselecionar={aoDesselecionar}
          estadoInteracao={estadoInteracao}
          estadoPeoes={estadoPeoesComPuxada}
          onComando={onComando}
          onComandoPeao={onComandoPeao}
          onRejeicaoPeao={onRejeicaoPeao}
          onPuxar={aoPuxarPecaDaBandeja}
          alvosPendentesSet={alvosPendentesSet}
          vagasSet={vagasSet}
          sanidadePorPeao={sanidadePorPeao}
          encaixeTrigger={encaixeTrigger}
          estadoVisualDoAtaque={estadoVisualDoAtaque}
        />
      ) : null}
    </div>
  )
}
