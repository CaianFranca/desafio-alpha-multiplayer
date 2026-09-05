import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { HudDaPartida } from '../components/partida/HudDaPartida'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import type { EstadoDaTela } from '../components/partida/partidaTelaMachine'
import {
  motivoDeRecusaDoEvento,
  textoDoAnuncioDeRecusa,
  tocarSomDeRecusa,
} from '../components/partida/somDeRecusa'
import { CAMINHO_SOM_SOMBRIO_LIMPEZA } from '../game/tabuleiro/animacao'
import { tocarSom } from '../game/audio/sons'
import type { MotivoDeRecusa } from '../components/partida/somDeRecusa'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { aplicarSnapshot } from '../game/tabuleiro/snapshot'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  estadoDeExibicaoDoModelo,
} from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente, SanidadePorPeao } from '../game/tabuleiro/reducao'
import { mapearGiro } from '../game/tabuleiro/interacao'
import type { EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { useAuth } from '../state/useAuth'
import { useSalaCodigoOptional } from '../state/sala-web-socket-context'
import type {
  ConfirmarPosicaoDoPeaoComando,
  EncerrarTurnoComando,
  EstadoDaPartidaSnapshot,
  PartidaComandoDoCliente,
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'

/** Comandos do canal: tabuleiro (ST-09), peões (ST-10) e turnos (ST-11, #118),
 * sem o jogadorId — injetado uma única vez em enviarComJogador. */
type ComandoDoCanal =
  | TabuleiroComandoDoCliente
  | PeaoComandoDoCliente
  | Omit<ConfirmarPosicaoDoPeaoComando, 'jogadorId'>
  | Omit<EncerrarTurnoComando, 'jogadorId'>

type AcaoDoModelo =
  | { type: 'EVENTO'; evento: Parameters<typeof reduzirEvento>[1] }
  | { type: 'APLICAR_SNAPSHOT'; snapshot: EstadoDaPartidaSnapshot }

function reduzirModelo(
  estado: EstadoDoTabuleiroNoCliente,
  acao: AcaoDoModelo,
): EstadoDoTabuleiroNoCliente {
  if (acao.type === 'APLICAR_SNAPSHOT') {
    return aplicarSnapshot(estado, acao.snapshot)
  }
  return reduzirEvento(estado, acao.evento)
}

interface PartidaPageProps {
  estadoInicial?: EstadoDaTela
  loader?: () => Promise<unknown>
}

export function PartidaPage({ estadoInicial, loader }: PartidaPageProps) {
  const [searchParams] = useSearchParams()
  const serverId = searchParams.get('serverId')
  const partidaId = searchParams.get('partidaId')
  const temAlvo = Boolean(serverId && partidaId)

  const { authState } = useAuth()
  const jogadorId =
    authState.status === 'authenticated' ? authState.jogador.id : null
  const navigate = useNavigate()
  const codigoDeSala = useSalaCodigoOptional()

  const { estado, resultado, motivo, carregar, tentarNovamente, partidaPreparada, partidaEmAndamento, partidaTerminada, falhar } =
    usePartidaTela({
      estadoInicial: !temAlvo ? 'falha' : estadoInicial,
      loader,
    })

  // ── Modelo local do tabuleiro (deltas + snapshot) ──
  const [modelo, despachar] = useReducer(reduzirModelo, undefined, criarEstadoInicialDoCliente)
  const despacharEvento = useCallback(
    (evento: Parameters<typeof reduzirEvento>[1]) => despachar({ type: 'EVENTO', evento }),
    [],
  )
  const aplicarSnapshotNoModelo = useCallback(
    (snapshot: EstadoDaPartidaSnapshot) => despachar({ type: 'APLICAR_SNAPSHOT', snapshot }),
    [],
  )
  // ── Som de recusa + anúncio ao leitor de tela (issue #228) ──
  // Único dono dos disparos: reage aos mesmos eventos do canal que antes
  // geravam flash, somente leitura do modelo. Aprovações/seleções/sorteios/
  // turnos ficam em silêncio (motivo null = "foi"). O id (nonce) remonta a
  // região viva a cada disparo (`key`), então repetições do MESMO motivo
  // re-anunciam — sem ele, texto idêntico + bail-out do setState calariam a
  // segunda recusa para o leitor de tela.
  const [anuncioDeRecusa, setAnuncioDeRecusa] = useState<{
    id: number
    motivo: MotivoDeRecusa
  } | null>(null)
  const proximoIdDeAnuncio = useRef(0)
  const tocarRecusa = useCallback((motivo: MotivoDeRecusa) => {
    tocarSomDeRecusa(motivo)
    proximoIdDeAnuncio.current += 1
    setAnuncioDeRecusa({ id: proximoIdDeAnuncio.current, motivo })
  }, [])

  // ── Trigger de limpeza para TransicaoLimpeza (issue #239, B1) ──
  // Evento-driven: só LIMPEZA_APLICADA dispara som/animação, snapshots não.
  const [limpezaTrigger, setLimpezaTrigger] = useState<{ pecasRemovidas: readonly string[]; key: number } | null>(null)
  const limpezaKeyRef = useRef(0)

  const estadoEmAndamento = temAlvo && estado === 'disponivel'
  const emResultado = estado === 'resultado'
  const emResultadoRef = useRef(emResultado)
  useEffect(() => {
    emResultadoRef.current = emResultado
  }, [emResultado])

  // ── Conexão do canal da partida (#156, ST-16 #180) ──
  const { enviar, conectar: reconectarSocket, desconectar } = usePartidaWebSocket({
    serverId,
    partidaId,
    onEvento: useCallback(
      (evento) => {
        if (evento.type === 'PARTIDA_TERMINADA') {
          // Snapshot já aplicado via ESTADO_DA_PARTIDA se houver; garante a
          // tela de resultado.
          // Motivo da derrota acompanha (#145-exp); payloads antigos sem o
          // campo chegam undefined → null (tela mantém texto genérico).
          partidaTerminada(evento.resultado, evento.motivo ?? null)
          return
        }
        if (evento.type === 'ESTADO_DA_PARTIDA') {
          aplicarSnapshotNoModelo(evento.snapshot)
          if (evento.snapshot.estado === 'terminada' && evento.snapshot.resultado) {
            partidaTerminada(evento.snapshot.resultado, evento.snapshot.motivo ?? null)
            return
          }
          if (evento.snapshot.estado === 'em_andamento') partidaEmAndamento()
          return
        }
        if (evento.type === 'PARTIDA_INICIADA') {
          partidaEmAndamento()
          return
        }
        // Após término, ignora eventos de jogo (partida em somente-leitura) — via ref para evitar stale closure
        if (emResultadoRef.current) return
        // Monstros e estados (ST-15, issue #174): ATAQUE e RESGATE são
        // projetados no modelo sem recarregar página. Só o ataque COM
        // penalidade (`estadosAplicados.length > 0`, issue #228) toca a
        // recusa — proteção que negou, gatilho sem vítimas e resgate ficam
        // em silêncio.
        if (evento.type === 'ATAQUE_RESOLVIDO' || evento.type === 'RESGATE_REALIZADO') {
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          if (evento.type === 'ATAQUE_RESOLVIDO') {
            const motivo = motivoDeRecusaDoEvento(evento)
            if (motivo !== null) tocarRecusa(motivo)
          }
          return
        }
        // Limpeza (issue #239, B1): evento-driven para TransicaoLimpeza — só
        // LIMPEZA_APLICADA dispara som/animação, snapshots não.
        if (evento.type === 'LIMPEZA_APLICADA') {
          if (evento.pecasRemovidas.length > 0) {
            limpezaKeyRef.current += 1
            setLimpezaTrigger({ pecasRemovidas: evento.pecasRemovidas, key: limpezaKeyRef.current })
            tocarSom(CAMINHO_SOM_SOMBRIO_LIMPEZA)
          }
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          return
        }
        // Promoção de tela só por admissão em_andamento, PARTIDA_INICIADA ou
        // ESTADO_DA_PARTIDA (em_andamento): eventos de turno avulsos não
        // abrem o tabuleiro sem snapshot — descreve a própria PR.
        despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
        // Som de recusa unificado (issue #228): erros do tabuleiro incluindo
        // FORA_DA_VEZ (#118), pendências e Caixa esgotada (#143/#151); seleção,
        // aprovação, sorteio, confirmação, limpeza e turnos em silêncio (null).
        const motivo = motivoDeRecusaDoEvento(evento)
        if (motivo !== null) tocarRecusa(motivo)
      },
      [aplicarSnapshotNoModelo, despacharEvento, partidaEmAndamento, partidaTerminada, tocarRecusa],
    ),
    onAdmissao: useCallback(
      (evento) => {
        if (evento.estado === 'preparada') partidaPreparada()
        else if (evento.estado === 'terminada') {
          // ADMISSAO_ACEITA não carrega resultado (shared/protocol.ts); o
          // snapshot ESTADO_DA_PARTIDA terminada que chega em seguida é a
          // fonte da verdade — não adivinhar 'derrota' aqui (vitória viraria derrota)
          return
        } else partidaEmAndamento()
      },
      [partidaPreparada, partidaEmAndamento],
    ),
    onFalhaDeConexao: useCallback(() => falhar(), [falhar]),
  })

  // Estado de exibição: exclusivamente do modelo quando disponível ou em resultado (tabuleiro congelado)
  const estadoExibicao = estadoEmAndamento || emResultado ? estadoDeExibicaoDoModelo(modelo) : null
  const estadoInteracao: EstadoDoTabuleiroNoCliente | null =
    estadoEmAndamento ? modelo : null

  const voltarASala = useCallback(() => {
    desconectar()
    if (codigoDeSala) navigate(`/sala/${codigoDeSala}`)
    else navigate('/salas/criar')
  }, [desconectar, navigate, codigoDeSala])

  // ── Injeção única de jogadorId (issue #91) — bloqueada após término ──
  const enviarComJogador = useCallback(
    (comando: ComandoDoCanal) => {
      if (jogadorId === null) return
      if (emResultado) return
      enviar({ ...comando, jogadorId } as PartidaComandoDoCliente)
    },
    [enviar, jogadorId, emResultado],
  )

  const onComando = useCallback(
    (comando: TabuleiroComandoDoCliente | null) => {
      if (comando === null) return
      enviarComJogador(comando)
    },
    [enviarComJogador],
  )

  // ── Comandos de Peão passam pelo mesmo ponto de injeção ──
  const onComandoPeao = enviarComJogador

  // ── Vez (issue #118): derivada uma vez; consome o gate do pull (#199) ──
  const minhaVez = !emResultado && jogadorId !== null && modelo.jogadorAtivoId === jogadorId

  // ── Percepção mínima de Sanidade e estados (ST-15, issue #174) ──
  // Sem controles completos; apenas indicadores no Ambiente de Jogo derivados
  // do snapshot + deltas de ATAQUE/RESGATE, sem recarregar página. Caminha
  // jogadorPorId × peaoPorJogador uma única vez (fonte também dos afetados).
  const sanidadePorPeao: SanidadePorPeao = useMemo(() => {
      const out: Record<string, { sanidade: number; emBaixaIluminacao: boolean; amedrontado: boolean }> = {}
      for (const [jogadorId, dados] of Object.entries(modelo.jogadorPorId)) {
        const peaoId = modelo.peaoPorJogador[jogadorId]
        if (peaoId) {
          out[peaoId] = {
            sanidade: dados.sanidade,
            emBaixaIluminacao: dados.emBaixaIluminacao,
            amedrontado: dados.amedrontado,
          }
        }
      }
      return out
    }, [modelo.jogadorPorId, modelo.peaoPorJogador])

  // ── Peões AFETADOS para o espelho de destinos (F1 #145-exp) ──
  // Predicado espelhado do engine (partida.ts:1484): Baixa Iluminação ∨
  // Amedrontado — único ponto onde a regra vive, sobre a projeção #174.
  // Alimenta a exceção de ocupação de resgate (+1 teto, #171) em
  // destinosConectadosDoPeao/mapearMovimentacao.
  const afetadosPorPeaoId: ReadonlySet<string> = useMemo(() => {
    const out = new Set<string>()
    for (const [peaoId, dados] of Object.entries(sanidadePorPeao)) {
      if (dados.emBaixaIluminacao || dados.amedrontado) out.add(peaoId)
    }
    return out
  }, [sanidadePorPeao])

  // ── Estado de interação dos peões (derivado do modelo) — indisponível em resultado ──
  const estadoInteracaoPeoes: EstadoInteracaoPeoes | null = useMemo(() => {
    if (emResultado) return null
    if (!temAlvo || !estadoEmAndamento) return null
    return {
      peoes: modelo.peoes,
      posicionadas: modelo.posicionadas,
      recebidasPendentes: modelo.recebidasPendentes,
      peaoSelecionadoId: modelo.peaoSelecionadoId,
      pecaSelecionadaId: modelo.pecaSelecionadaId,
      posicaoConfirmadaNoTurno: modelo.posicaoConfirmadaNoTurno,
      // Gate do pull na bandeja (revisão #199): só o dono do ciclo puxa; a
      // bandeja continua pública (as pendências vêm do broadcast sem filtro).
      donoDoCiclo: minhaVez,
      // Projeção dos afetados (exceção de resgate #171 no espelho de destinos).
      afetadosPorPeaoId,
    }
  }, [temAlvo, estadoEmAndamento, modelo, minhaVez, afetadosPorPeaoId])

  // ── Rejeição local do roteador (AC3): motivo → som de recusa + anúncio ──
  const onRejeicaoPeao = tocarRecusa

  // ── Turnos (issue #118): rodada, fase e peão do Jogador Ativo (minhaVez
  // derivada acima) — nulo em resultado ──
  const peaoProprioId =
    jogadorId !== null ? (modelo.peaoPorJogador[jogadorId] ?? null) : null
  const peaoAtivoId =
    modelo.jogadorAtivoId !== null
      ? (modelo.peaoPorJogador[modelo.jogadorAtivoId] ?? null)
      : null
  const peaoProprioPosicionado =
    peaoProprioId !== null &&
    modelo.peoes.some((p) => p.peaoId === peaoProprioId && p.celula !== null)
  type FaseDoTurno = 'permanecer' | 'confirmar' | 'encerrar' | null
  const faseDoTurno: FaseDoTurno = !minhaVez
    ? null
    : modelo.posicaoConfirmadaNoTurno
      ? 'encerrar'
      : modelo.rodada === 1
        ? peaoProprioPosicionado && modelo.recebidasPendentes.length === 0
          ? 'encerrar'
          : null
        : modelo.movimentouNoTurno
          ? 'confirmar'
          : 'permanecer'

  // ── Rotação: botões DOM (horário/anti-horário) + teclas R/E ──
  const pecaAlvoDeGiro = estadoInteracao
    ? (estadoInteracao.pecaEmManipulacaoId ?? estadoInteracao.pecaSelecionadaId)
    : null

  const girar = useCallback(
    (sentido: 'horario' | 'anti_horario') => {
      if (pecaAlvoDeGiro === null) return
      enviarComJogador(mapearGiro(pecaAlvoDeGiro, sentido))
    },
    [enviarComJogador, pecaAlvoDeGiro],
  )

  useEffect(() => {
    if (!estadoEmAndamento) return
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return
      if (e.key === 'r' || e.key === 'R') girar('horario')
      if (e.key === 'e' || e.key === 'E') girar('anti_horario')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [estadoEmAndamento, girar])

  const tentarNovamenteComConexao = useCallback(() => {
    desconectar()
    if (!temAlvo) {
      falhar()
      return
    }
    if (loader) {
      tentarNovamente()
    } else {
      carregar()
    }
    reconectarSocket()
  }, [carregar, tentarNovamente, desconectar, reconectarSocket, falhar, temAlvo, loader])

  // ── Comandos de turno (issue #118) — todos via enviarComJogador ──
  const permanecerNoTurno = useCallback(() => {
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'PERMANECER', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId])

  const confirmarPosicaoNoTurno = useCallback(() => {
    if (peaoProprioId === null) return
    enviarComJogador({ type: 'CONFIRMAR_POSICAO_DO_PEAO', peaoId: peaoProprioId })
  }, [enviarComJogador, peaoProprioId])

  const encerrarTurno = useCallback(() => {
    enviarComJogador({ type: 'ENCERRAR_TURNO' })
  }, [enviarComJogador])
  const [bordaPx, setBordaPx] = useState(0)

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <AmbienteDeJogo
        bordaPx={bordaPx}
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao}
        estadoInteracaoPeoes={estadoInteracaoPeoes}
        onComando={onComando}
        onComandoPeao={onComandoPeao}
        onRejeicaoPeao={onRejeicaoPeao}
        peaoSelecionadoIdServidor={modelo.peaoSelecionadoId}
        peaoAtivoId={peaoAtivoId}
        sanidadePorPeao={sanidadePorPeao}
        limpezaTrigger={limpezaTrigger}
      />
      <PartidaOverlays estado={estado} resultado={resultado} motivo={motivo} onRetry={tentarNovamenteComConexao} onVoltar={voltarASala} />
      {/*
        Anúncio de recusa restrito a leitores de tela (issue #228, história 8):
        região viva sempre presente; o texto atualiza a cada recusa (som +
        anúncio). Invisível para quem não usa leitor (`sr-only`). O `key` com
        o id do anúncio remonta o nó a cada disparo para que repetições do
        mesmo motivo re-anunciem; `data-anuncio-id` expõe o nonce aos testes.
      */}
      <div
        key={anuncioDeRecusa?.id ?? 'sem-anuncio'}
        data-testid="anuncio-de-recusa"
        data-motivo={anuncioDeRecusa?.motivo ?? undefined}
        data-anuncio-id={anuncioDeRecusa?.id ?? undefined}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {anuncioDeRecusa !== null ? textoDoAnuncioDeRecusa(anuncioDeRecusa.motivo) : ''}
      </div>
      {/*
        HUD definitivo da Partida (issue #226, spec pai #224): irmão de
        AmbienteDeJogo/PartidaMoldura no ponto mais alto, somente leitura do
        modelo existente (reducao.ts/snapshot.ts). Substitui os indicadores
        provisórios (rodada, caixa, jogador ativo em texto, lista de sanidade
        em texto, chips de geradores/cartão em texto) — sem card de Proteção.
      */}
      {(estadoEmAndamento || emResultado) ? (
        <HudDaPartida
          jogadorPorId={modelo.jogadorPorId}
          jogadorAtivoId={modelo.jogadorAtivoId}
          jogadorLocalId={jogadorId}
          geradoresLigados={modelo.geradoresLigados}
          cartaoDeAcessoObtido={modelo.cartaoDeAcessoObtido}
          emAndamento={estadoEmAndamento}
          emResultado={emResultado}
          partidaId={partidaId}
          onSair={voltarASala}
        />
      ) : null}
      {estadoEmAndamento && faseDoTurno !== null ? (
        // Botões de turno acima do card de Turno do HUD (inf-dir, #226).
        <div
          data-testid="controles-de-turno"
          className="pointer-events-auto absolute bottom-32 right-4 z-30 flex gap-2"
        >
          {faseDoTurno === 'permanecer' ? (
            <button
              type="button"
              data-testid="botao-permanecer"
              onClick={permanecerNoTurno}
              disabled={peaoProprioId === null}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Permanecer
            </button>
          ) : null}
          {faseDoTurno === 'confirmar' ? (
            <button
              type="button"
              data-testid="botao-confirmar-posicao"
              onClick={confirmarPosicaoNoTurno}
              disabled={peaoProprioId === null}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              Confirmar Posição
            </button>
          ) : null}
          {faseDoTurno === 'encerrar' ? (
            <button
              type="button"
              data-testid="botao-encerrar-turno"
              onClick={encerrarTurno}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
            >
              Encerrar Turno
            </button>
          ) : null}
        </div>
      ) : null}
      {estadoEmAndamento ? (
        // Controles de giro acima das conquistas do HUD (inf-centro, #226)
        // para não sobrepor as 4 conquistas redondas.
        <div
          data-testid="controles-de-giro"
          className="pointer-events-auto absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 gap-2"
        >
          <button
            type="button"
            data-testid="girar-anti-horario"
            onClick={() => girar('anti_horario')}
            disabled={pecaAlvoDeGiro === null}
            className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Girar ◀
          </button>
          <button
            type="button"
            data-testid="girar-horario"
            onClick={() => girar('horario')}
            disabled={pecaAlvoDeGiro === null}
            className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            Girar ▶
          </button>
        </div>
      ) : null}
      <PartidaMoldura onBordaChange={setBordaPx} />
    </div>
  )
}
