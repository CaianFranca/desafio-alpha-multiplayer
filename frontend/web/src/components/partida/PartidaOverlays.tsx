import { DotsDeCarregamento } from '../loading/DotsDeCarregamento'
import type {
  EstadoDaTela,
  MotivoDeDerrota,
  ResultadoDaPartida,
} from './partidaTelaMachine'

interface PartidaOverlaysProps {
  estado: EstadoDaTela
  resultado: ResultadoDaPartida | null
  /**
   * Motivo da derrota (#145-exp, espelho do wire/engine — partidaTelaMachine).
   * `null`/ausente (vitória ou payload antigo sem o campo): a derrota mantém
   * o texto genérico pré-#145-exp.
   */
  motivo?: MotivoDeDerrota | null
  onRetry: () => void
  onVoltar: () => void
  /**
   * Desistência própria (issue #290): quem desistiu não readmite (o servidor
   * rejeita com JOGADOR_NAO_NA_PARTIDA) — a falha vira terminal sem retry e
   * sem voltar-à-sala. Queda/logout mantém retry.
   */
  semRetry?: boolean
}

const baseClasses = 'absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80'

// Loading (carregando/aguardando): fundo sólido com o background do app —
// os dots substituem a tela de carregamento, sem vazar o cenário 3D.
const loadingClasses = 'absolute inset-0 z-10 flex items-center justify-center bg-background'

// O overlay de resultado fica ACIMA do HUD (z-40 > hud z-30) para a leitura
// do desfecho; os demais overlays seguem abaixo da moldura/HUD (issue #226).

// Textos sóbrios por motivo de derrota, no estilo do overlay; os nomes do
// domínio são os do engine (DesfechoDaPartida.motivo). Payload sem motivo
// (binário anterior) cai no texto genérico — defensivos, sem inventar causa.
const TEXTO_MOTIVO_DERROTA: Record<MotivoDeDerrota, string> = {
  caixa_esgotada: 'A Caixa esgotou antes de a equipe completar a fuga',
  equipe_amedrontada: 'A equipe perdeu toda a Sanidade',
  desistencia: 'Restou só você na partida',
}

export function PartidaOverlays({
  estado,
  resultado,
  motivo = null,
  onRetry,
  onVoltar,
  semRetry = false,
}: PartidaOverlaysProps) {
  if (estado === 'disponivel') {
    return null
  }

  if (estado === 'resultado') {
    const vitoria = resultado === 'vitoria'
    const detalhe = !vitoria && motivo !== null && motivo !== undefined
      ? TEXTO_MOTIVO_DERROTA[motivo]
      : 'A equipe não conseguiu escapar'
    return (
      <div
        data-testid="overlay-resultado"
        data-resultado={resultado ?? ''}
        data-motivo={!vitoria && motivo ? motivo : ''}
        role="status"
        className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-900/80"
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-white text-[length:var(--hud-display,1.5rem)] leading-8 font-bold">{vitoria ? 'Vitória!' : 'Derrota'}</p>
          <p className="text-zinc-400 text-[length:var(--hud-corpo,0.875rem)] leading-5">
            {vitoria ? 'A equipe escapou do sanatório' : detalhe}
          </p>
          <button
            type="button"
            data-testid="voltar-a-sala"
            onClick={onVoltar}
            className="pointer-events-auto rounded bg-amber-500 px-6 py-2 text-[length:var(--hud-corpo,0.875rem)] leading-5 font-medium text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Voltar à sala
          </button>
        </div>
      </div>
    )
  }

  if (estado === 'partidaNaoIniciada') {
    return (
      <div
        data-testid="overlay-partida-nao-iniciada"
        role="status"
        className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-900/80"
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-white text-2xl font-bold">Partida não iniciada</p>
          <p className="text-zinc-400 text-sm">
            Não houve Jogadores suficientes para iniciar a partida. A Sala foi reaberta.
          </p>
          <button
            type="button"
            data-testid="voltar-a-sala"
            onClick={onVoltar}
            className="pointer-events-auto rounded bg-amber-500 px-6 py-2 text-sm font-medium text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            Voltar à sala
          </button>
        </div>
      </div>
    )
  }

  if (estado === 'carregando') {
    return (
      <div data-testid="overlay-carregando" role="status" aria-label="Carregando" className={loadingClasses}>
        <div className="encaminhamento-carregando">
          <DotsDeCarregamento rotuloVisivel="Carregando..." />
        </div>
      </div>
    )
  }

  if (estado === 'aguardando') {
    return (
      <div data-testid="overlay-aguardando" role="status" aria-label="Aguardando partida" className={loadingClasses}>
        <div className="encaminhamento-carregando">
          <DotsDeCarregamento />
        </div>
      </div>
    )
  }

  // estado === 'falha'
  if (semRetry) {
    return (
      <div data-testid="overlay-falha" role="alert" className={baseClasses}>
        <div className="flex flex-col items-center gap-4">
          <p className="text-white text-[length:var(--hud-titulo,1.125rem)] leading-7">Falha ao carregar</p>
          <p data-testid="partida-desistencia-sem-retorno" className="text-zinc-400 text-[length:var(--hud-corpo,0.875rem)] leading-5">
            Você desistiu desta partida e não pode reassistir.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div data-testid="overlay-falha" role="alert" className={baseClasses}>
      <div className="flex flex-col items-center gap-4">
        <p className="text-white text-[length:var(--hud-titulo,1.125rem)] leading-7">Falha ao carregar</p>
        <button
          type="button"
          data-testid="partida-tentar-novamente"
          onClick={onRetry}
          className="pointer-events-auto rounded bg-amber-500 px-4 py-2 text-[length:var(--hud-corpo,0.875rem)] leading-5 font-medium text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          Tentar novamente
        </button>
        <button
          type="button"
          data-testid="voltar-a-sala"
          onClick={onVoltar}
          className="pointer-events-auto rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          Voltar à sala
        </button>
      </div>
    </div>
  )
}
