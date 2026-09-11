import type { EstadoDoEncaminhamento } from '../../hooks/useSalaWebSocket'

interface Props {
  encaminhamento: EstadoDoEncaminhamento
  onFechar: () => void
}

export function AvisoEncaminhamento({ encaminhamento, onFechar }: Props) {
  const { fase, mensagem } = encaminhamento
  if (fase !== 'recusada' && fase !== 'falhou') return null
  const titulo = fase === 'recusada' ? 'Partida recusada' : 'Falha ao preparar a partida'

  return (
    <div role="alert" data-testid="aviso-encaminhamento" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-amber-900">{titulo}</p>
          <p className="mt-1 text-sm text-amber-800">{mensagem ?? 'Tente novamente.'}</p>
          <p className="mt-2 text-sm text-amber-700">A Sala permanece aberta — você pode tentar iniciar novamente quando todos estiverem prontos.</p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          data-testid="fechar-aviso"
          className="shrink-0 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 shadow hover:bg-amber-100"
        >
          Fechar
        </button>
      </div>
    </div>
  )
}
