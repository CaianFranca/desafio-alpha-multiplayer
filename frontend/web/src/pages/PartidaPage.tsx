import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AmbienteDeJogo } from '../components/partida/AmbienteDeJogo'
import { PartidaMoldura } from '../components/partida/PartidaMoldura'
import { PartidaOverlays } from '../components/partida/PartidaOverlays'
import { usePartidaTela } from '../components/partida/usePartidaTela'
import type { EstadoDaTela } from '../components/partida/partidaTelaMachine'
import { FlashOverlay } from '../components/partida/FlashOverlay'
import { usePartidaWebSocket } from '../hooks/usePartidaWebSocket'
import { useRequerOrientacaoLandscape } from '../hooks/useOrientacaoCelular'
import { OverlayOrientacao } from '../components/partida/OverlayOrientacao'
import { aplicarSnapshot } from '../game/tabuleiro/snapshot'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  estadoDeExibicaoDoModelo,
} from '../game/tabuleiro/reducao'
import type { EstadoDoTabuleiroNoCliente, SanidadePorPeao } from '../game/tabuleiro/reducao'
import { mapearGiro, FLASH_AMBAR, FLASH_BRANCO, FLASH_VERMELHO } from '../game/tabuleiro/interacao'
import type { FlashFeedback } from '../game/tabuleiro/interacao'
import { mapearEventoPeaoParaFeedback } from '../game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoPeoes } from '../game/tabuleiro/interacaoPeoes'
import { HEX_COR_PEAO, ALVO_GERADORES_LIGADOS } from '../game/tabuleiro/contrato'
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
  const [flash, setFlash] = useState<FlashFeedback | null>(null)

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
          // Snapshot já aplicado via ESTADO_DA_PARTIDA se houver; garante tela
          // Limpa estados pendentes de interação: flash de erro não deve permanecer
          setFlash(null)
          // Motivo da derrota acompanha (#145-exp); payloads antigos sem o
          // campo chegam undefined → null (tela mantém texto genérico).
          partidaTerminada(evento.resultado, evento.motivo ?? null)
          return
        }
        if (evento.type === 'ESTADO_DA_PARTIDA') {
          aplicarSnapshotNoModelo(evento.snapshot)
          if (evento.snapshot.estado === 'terminada' && evento.snapshot.resultado) {
            setFlash(null)
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
        // projetados no modelo e geram feedback mínimo sem recarregar página.
        if (evento.type === 'ATAQUE_RESOLVIDO' || evento.type === 'RESGATE_REALIZADO') {
          despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
          if (evento.type === 'ATAQUE_RESOLVIDO') {
            // Feedback perceptível para ataque (issue #174): vermelho quando há
            // penalidade (Baixa/Amedrontado/sanidade), branco quando a Proteção
            // negou o ataque (protegidos>0 sem estadosAplicados), âmbar quando o
            // gatilho dispara sem vítimas (saída com alcance vazio). A limpeza de
            // monstros fora da iluminação é o mesmo LIMPEZA_APLICADA branco.
            if (evento.estadosAplicados.length > 0) {
              setFlash({ ...FLASH_VERMELHO })
            } else if (evento.protegidos.length > 0) {
              setFlash({ ...FLASH_BRANCO })
            } else if (evento.atacantes.length > 0) {
              setFlash({ ...FLASH_AMBAR })
            } else {
              setFlash({ ...FLASH_BRANCO })
            }
          } else {
            setFlash({ ...FLASH_BRANCO })
          }
          return
        }
        // Promoção de tela só por admissão em_andamento, PARTIDA_INICIADA ou
        // ESTADO_DA_PARTIDA (em_andamento): eventos de turno avulsos não
        // abrem o tabuleiro sem snapshot — descreve a própria PR.
        despacharEvento(evento as Parameters<typeof reduzirEvento>[1])
        // Feedback unificado: cobre eventos de tabuleiro, peão, turno (#118)
        // e limpeza (#151 — inclui limpeza de monstros removidos pela
        // iluminação, issue #174). Branco para aprovação/seleção; vermelho para
        // ERRO_DO_TABULEIRO (motivo específico para pendências); âmbar para
        // FORA_DA_VEZ; TURNO_INICIADO/TURNO_ENCERRADO não geram flash (null).
        if (evento.type === 'CELULAS_ILUMINADAS') {
          return
        }
        if (evento.type === 'LIMPEZA_APLICADA') {
          setFlash({ ...FLASH_BRANCO })
          return
        }
        const feedback = mapearEventoPeaoParaFeedback(
          evento as Parameters<typeof mapearEventoPeaoParaFeedback>[0],
        )
        if (feedback !== null) setFlash({ ...feedback })
      },
      [aplicarSnapshotNoModelo, despacharEvento, partidaEmAndamento, partidaTerminada],
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

  // ── Flash local (revisão #199): mesma fonte para o pull na bandeja; a
  // rejeição de peão (vermelho/âmbar do roteador) segue o mesmo caminho. ──
  const exibirFlash = useCallback((feedback: FlashFeedback) => {
    setFlash({ ...feedback })
  }, [])
  const onRejeicaoPeao = exibirFlash

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

  // ── Chip Jogador Ativo (apelido/cor do snapshot, #156) ──
  const jogadorAtivoDados =
    modelo.jogadorAtivoId !== null ? modelo.jogadorPorId[modelo.jogadorAtivoId] ?? null : null

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

  const limparFlash = useCallback(() => setFlash(null), [])

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
  const requerOrientacao = useRequerOrientacaoLandscape()
  const [bordaPx, setBordaPx] = useState(0)

  return (
    <div className="relative min-h-[calc(100vh-5rem)] w-full overflow-hidden">
      <AmbienteDeJogo
        bordaPx={bordaPx}
        estadoExibicao={estadoExibicao}
        estadoInteracao={estadoInteracao}
        estadoInteracaoPeoes={estadoInteracaoPeoes}
        onComando={onComando}
        onComandoPeao={onComandoPeao}
        onRejeicaoPeao={onRejeicaoPeao}
        onFlash={exibirFlash}
        peaoSelecionadoIdServidor={modelo.peaoSelecionadoId}
        peaoAtivoId={peaoAtivoId}
        sanidadePorPeao={sanidadePorPeao}
      />
      <PartidaOverlays estado={estado} resultado={resultado} motivo={motivo} onRetry={tentarNovamenteComConexao} onVoltar={voltarASala} />
      <FlashOverlay flash={flash} onClear={limparFlash} />
      {(emResultado || estadoEmAndamento) && modelo.rodada !== null ? (
        <div
          data-testid="indicador-rodada"
          className="pointer-events-none absolute right-4 top-4 z-30 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-200"
        >
          Rodada {modelo.rodada}
        </div>
      ) : null}
      {estadoEmAndamento && modelo.pecasRestantesNaCaixa !== null ? (
        // Contagem da Caixa no HUD (issue #145): baseline do snapshot +
        // decremento ao vivo em PECA_SORTEADA. Oculta enquanto null (antes do
        // primeiro ESTADO_DA_PARTIDA nunca se mostra contagem inventada).
        <div
          data-testid="contagem-caixa"
          className="pointer-events-none absolute right-4 top-12 z-30 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-200"
        >
          Caixa: {modelo.pecasRestantesNaCaixa}
        </div>
      ) : null}
      {(estadoEmAndamento || emResultado) && jogadorAtivoDados ? (
        <div
          data-testid="chip-jogador-ativo"
          data-cor={jogadorAtivoDados.cor}
          data-sanidade={String(jogadorAtivoDados.sanidade)}
          data-em-baixa={jogadorAtivoDados.emBaixaIluminacao ? 'true' : undefined}
          data-amedrontado={jogadorAtivoDados.amedrontado ? 'true' : undefined}
          className="pointer-events-none absolute left-4 top-4 z-30 flex items-center gap-2 rounded bg-zinc-900/80 px-3 py-1 text-sm text-zinc-100"
          style={{ borderLeft: `4px solid ${HEX_COR_PEAO[jogadorAtivoDados.cor] ?? '#fff'}` }}
        >
          <span>{jogadorAtivoDados.apelido}</span>
          <span data-testid="chip-sanidade" className="text-xs text-zinc-300">
            {jogadorAtivoDados.sanidade}/3
          </span>
          {jogadorAtivoDados.emBaixaIluminacao ? (
            <span data-testid="chip-baixa-iluminacao" className="text-xs text-amber-300" title="Baixa Iluminação">
              ◐
            </span>
          ) : null}
          {jogadorAtivoDados.amedrontado ? (
            <span data-testid="chip-amedrontado" className="text-xs text-red-400" title="Amedrontado">
              ⚠
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Percepção mínima de todos os jogadores (issue #174): sem controles
          completos — apenas 4 chips com sanidade/estados no Ambiente de Jogo.
          O chip do Jogador Ativo acima é o destaque da vez; esta lista é a
          visão “cada Jogador” exigida no critério, sem barras/painéis. */}
      {(estadoEmAndamento || emResultado) && Object.keys(modelo.jogadorPorId).length > 0 ? (
        <div
          data-testid="indicadores-sanidade"
          className="pointer-events-none absolute left-4 top-16 z-30 flex flex-col gap-1"
        >
          {Object.entries(modelo.jogadorPorId).map(([jid, dados]) => (
            <div
              key={jid}
              data-testid="indicador-sanidade-jogador"
              data-jogador-id={jid}
              data-sanidade={String(dados.sanidade)}
              data-em-baixa={dados.emBaixaIluminacao ? 'true' : undefined}
              data-amedrontado={dados.amedrontado ? 'true' : undefined}
              data-cor={dados.cor}
              className="flex items-center gap-2 rounded bg-zinc-900/70 px-2 py-0.5 text-xs text-zinc-200"
              style={{ borderLeft: `3px solid ${HEX_COR_PEAO[dados.cor] ?? '#fff'}` }}
            >
              <span>{dados.apelido}</span>
              <span>{dados.sanidade}/3</span>
              {dados.emBaixaIluminacao ? <span title="Baixa Iluminação">◐</span> : null}
              {dados.amedrontado ? <span title="Amedrontado">⚠</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {estadoEmAndamento ? (
        // Chips de Objetivo Global na moldura (issue #145, spec pai ST-12):
        // overlay IRMÃO sobre a moldura — o PartidaMoldura é decoração
        // aria-hidden, os chips são informativos (aria-label) e nunca captam
        // ponteiro. Fonte: modelo local (baseline do snapshot + derivação ao
        // vivo pelos eventos existentes; sem novos eventos de conquista).
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-2">
          <div
            data-testid="chip-geradores-ligados"
            role="status"
            data-geradores={modelo.geradoresLigados.length}
            aria-label={`Geradores ligados: ${modelo.geradoresLigados.length} de ${ALVO_GERADORES_LIGADOS}`}
            className={`rounded bg-zinc-900/80 px-3 py-1 text-sm ${
              modelo.geradoresLigados.length >= ALVO_GERADORES_LIGADOS
                ? 'text-amber-300'
                : 'text-zinc-200'
            }`}
          >
            Geradores {modelo.geradoresLigados.length}/{ALVO_GERADORES_LIGADOS}
          </div>
          <div
            data-testid="chip-cartao-de-acesso"
            role="status"
            data-obtido={modelo.cartaoDeAcessoObtido ? 'true' : 'false'}
            aria-label={
              modelo.cartaoDeAcessoObtido
                ? 'Cartão de Acesso obtido'
                : 'Cartão de Acesso ainda não obtido'
            }
            className={`rounded bg-zinc-900/80 px-3 py-1 text-sm ${
              modelo.cartaoDeAcessoObtido ? 'text-emerald-300' : 'text-zinc-500'
            }`}
          >
            Cartão de Acesso
          </div>
        </div>
      ) : null}
      {estadoEmAndamento && faseDoTurno !== null ? (
        <div
          data-testid="controles-de-turno"
          className="pointer-events-auto absolute bottom-6 right-6 z-30 flex gap-2"
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
        <div
          data-testid="controles-de-giro"
          className="pointer-events-auto absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2"
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
      {requerOrientacao ? <OverlayOrientacao /> : null}
      <PartidaMoldura onBordaChange={setBordaPx} />
    </div>
  )
}
