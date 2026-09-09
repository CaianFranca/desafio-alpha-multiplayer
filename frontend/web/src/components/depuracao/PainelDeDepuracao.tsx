/**
 * Painel de depuração em janela compacta (issue #340, "Modo Desenvolvedor").
 *
 * Janela fixa no canto superior direito (abaixo do botão flutuante de
 * on/off, que fica em z-[70] — o painel fica em z-[60], acima dos overlays
 * do app em z-50), fundo próprio distinto do fundo das linhas.
 * Filtro por nível (info/warn/error/todos),
 * botão Limpar e botão Copiar com campo numérico "últimos N logs" (N conta
 * entradas completas do buffer — nunca um log cortado no meio; vazio/0 =
 * copiar tudo); a cópia respeita o filtro ativo e sai em texto simples,
 * um registro por log (mensagens multilinha preservadas). Renderiza a
 * partir do coletor singleton —
 * o histórico existe desde o boot mesmo com o painel fechado.
 */

import { useMemo, useState, useEffect } from 'react'
import {
  entradas as entradasDoColetor,
  formatarLinha,
  limpar,
  subscrever,
  type EntradaDeDepuracao,
  type NivelDoDepurador,
} from '../../utils/coletorDeDepuracao'
import { corDoTexto, fundoDaFase } from './paletaDeDepuracao'

type FiltroDeNivel = NivelDoDepurador | 'todos'

const NIVEIS_DO_FILTRO: readonly { valor: FiltroDeNivel; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'info', rotulo: 'Info' },
  { valor: 'warn', rotulo: 'Warn' },
  { valor: 'error', rotulo: 'Error' },
]

export function PainelDeDepuracao() {
  const [lista, setLista] = useState<readonly EntradaDeDepuracao[]>(() => entradasDoColetor())
  const [filtro, setFiltro] = useState<FiltroDeNivel>('todos')
  const [quantidadeCopiar, setQuantidadeCopiar] = useState('')

  useEffect(() => {
    const desinscrever = subscrever((entrada) => {
      setLista((atual) => [...atual, entrada])
    })
    return desinscrever
  }, [])

  // Filtro por nível aplicado na exibição e na cópia (mesma lista filtrada).
  const filtradas = useMemo(
    () => (filtro === 'todos' ? lista : lista.filter((entrada) => entrada.nivel === filtro)),
    [lista, filtro],
  )

  const copiar = async () => {
    const n = Number.parseInt(quantidadeCopiar, 10)
    const recorte = Number.isFinite(n) && n > 0 ? filtradas.slice(-n) : filtradas
    const texto = recorte.map(formatarLinha).join('\n')
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      // Clipboard indisponível (permissão/jsdom): engole — cópia é best-effort.
    }
  }

  return (
    <div
      data-testid="painel-de-depuracao"
      // Janela compacta ancorada abaixo do botão flutuante (top-4 + altura do
      // botão ≈ top-14): o botão nunca fica sob o painel. Coluna flex garante
      // scroll interno apenas na lista (min-h-0 no <ol>).
      className="fixed right-4 top-14 z-[60] flex max-h-[50vh] w-[360px] flex-col bg-slate-950/95 p-4 font-mono text-xs"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-300">Modo Desenvolvedor</span>
        <label className="flex items-center gap-1 text-slate-400">
          Nível
          <select
            aria-label="Filtro por nível"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value as FiltroDeNivel)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-slate-200"
          >
            {NIVEIS_DO_FILTRO.map(({ valor, rotulo }) => (
              <option key={valor} value={valor}>{rotulo}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            limpar()
            // Resync local: o coletor não notifica limpeza (só novas entradas).
            setLista([])
          }}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
        >
          Limpar
        </button>
        <label className="flex items-center gap-1 text-slate-400">
          Últimos N logs
          <input
            aria-label="Últimos N logs a copiar"
            type="number"
            min={0}
            value={quantidadeCopiar}
            onChange={(evento) => setQuantidadeCopiar(evento.target.value)}
            className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-slate-200"
          />
        </label>
        <button
          type="button"
          onClick={() => void copiar()}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
        >
          Copiar
        </button>
      </div>
      <ol
        data-testid="linhas-do-painel"
        // min-h-0 permite o <ol> encolher dentro do max-h do painel; o
        // overflow-y-auto fica só na lista, toolbar sempre visível.
        className="min-h-0 space-y-0.5 overflow-y-auto"
      >
        {filtradas.map((entrada) => (
          <li
            key={entrada.id}
            data-testid="linha-de-depuracao"
            style={{
              color: corDoTexto(entrada.fonte, entrada.nivel),
              backgroundColor: fundoDaFase(entrada.fase),
            }}
            className="whitespace-pre-wrap break-all rounded px-1 py-0.5"
          >
            {formatarLinha(entrada)}
          </li>
        ))}
      </ol>
    </div>
  )
}
