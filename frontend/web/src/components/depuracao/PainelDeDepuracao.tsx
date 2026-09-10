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
 *
 * Legibilidade (Top 3 da análise UX): quebra só quando a palavra não cabe
 * ([overflow-wrap:anywhere] — nunca break-all, que destrói UUIDs e JSON
 * indentado); cada entrada com borda esquerda na cor da fonte, prefixo
 * (timestamp/contexto) neutro e badge da fonte colorida; entrada
 * multi-linha com divisória inferior. Auto-scroll condicional: rola ao fim
 * só se o usuário já estava no fundo — senão pill "N novas linhas" rola ao
 * clicar. Contador do buffer (X/500) no toolbar.
 */

import { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
  CAPACIDADE_DO_BUFFER,
  entradas as entradasDoColetor,
  formatarLinha,
  formatarTimestamp,
  limpar,
  subscrever,
  type EntradaDeDepuracao,
  type NivelDoDepurador,
} from '../../utils/coletorDeDepuracao'
import { CORES_DA_FONTE, bordaDaFonte, corDoTexto, fundoDaFase } from './paletaDeDepuracao'
import { estaNoFundo } from './rolagemDaLista'

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
  const [novasNaoVistas, setNovasNaoVistas] = useState(0)
  const referenciaDaLista = useRef<HTMLOListElement>(null)

  // Chegada de entrada com o usuário no fundo → rolar após o render; fora do
  // fundo → contar para a pill. A decisão é tomada ANTES do setState (o
  // subscriber roda fora do ciclo de render; o scroll pós-render usa a flag).
  const rolarAoFimPendente = useRef(false)
  useEffect(() => {
    const desinscrever = subscrever((entrada) => {
      if (estaNoFundo(referenciaDaLista.current)) {
        rolarAoFimPendente.current = true
      } else {
        setNovasNaoVistas((quantidade) => quantidade + 1)
      }
      setLista((atual) => [...atual, entrada])
    })
    return desinscrever
  }, [])

  // Abre o painel ancorado no fim (histórico existente no boot). Layout effect:
  // scroll antes do paint — sem flash do topo.
  useLayoutEffect(() => {
    const elemento = referenciaDaLista.current
    if (elemento !== null) elemento.scrollTop = elemento.scrollHeight
  }, [])

  // Consome a flag pós-render: o <ol> só existe montado, e o scroll com o
  // novo conteúdo já no DOM não é sobrescrito pelo layout seguinte. Layout
  // effect pelo mesmo motivo do efeito de montagem (antes do paint).
  useLayoutEffect(() => {
    if (!rolarAoFimPendente.current) return
    rolarAoFimPendente.current = false
    const elemento = referenciaDaLista.current
    if (elemento !== null) elemento.scrollTop = elemento.scrollHeight
  }, [lista])

  const rolarAoFim = () => {
    const elemento = referenciaDaLista.current
    if (elemento !== null) elemento.scrollTop = elemento.scrollHeight
    setNovasNaoVistas(0)
  }

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
        <span
          data-testid="contador-do-buffer"
          className="text-slate-500"
          title="Entradas no buffer anelado"
        >
          {lista.length}/{CAPACIDADE_DO_BUFFER}
        </span>
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
            setNovasNaoVistas(0)
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
        ref={referenciaDaLista}
        data-testid="linhas-do-painel"
        // min-h-0 permite o <ol> encolher dentro do max-h do painel; o
        // overflow-y-auto fica só na lista, toolbar sempre visível. Volta ao
        // fundo manualmente (scroll do usuário) zera a pill de novas linhas.
        onScroll={() => {
          if (estaNoFundo(referenciaDaLista.current)) setNovasNaoVistas(0)
        }}
        className="min-h-0 space-y-1 overflow-y-auto"
      >
        {filtradas.map((entrada) => {
          // Heurística de multi-linha: só a mensagem pode ter \n (prefixo não).
          const multiLinha = entrada.mensagem.includes('\n')
          return (
            <li
              key={entrada.id}
              data-testid="linha-de-depuracao"
              style={{
                color: corDoTexto(entrada.fonte, entrada.nivel),
                backgroundColor: fundoDaFase(entrada.fase),
                borderLeftColor: bordaDaFonte(entrada.fonte),
              }}
              className={`border-l-[3px] whitespace-pre-wrap rounded px-1 py-0.5 [overflow-wrap:anywhere]${multiLinha ? ' border-b border-slate-800/50' : ''}`}
            >
              {/* Prefixo neutro; badge da fonte na cor dela; mensagem herda
                  a cor de nível/fonte do <li>. Texto em spans separados, mas
                  a cópia continua no formato canônico via formatarLinha. */}
              <span className="text-slate-500">[{formatarTimestamp(entrada.registradoEm)}]</span>
              {' '}
              <span style={{ color: CORES_DA_FONTE[entrada.fonte] }}>[{entrada.fonte}]</span>
              {entrada.contexto !== null && <span className="text-slate-500"> [{entrada.contexto}]</span>}
              {' '}
              {entrada.mensagem}
            </li>
          )
        })}
      </ol>
      {novasNaoVistas > 0 && (
        <button
          type="button"
          data-testid="pill-novas-linhas"
          onClick={rolarAoFim}
          className="absolute bottom-2 right-4 z-10 rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-slate-200 hover:bg-slate-700"
        >
          ↓ {novasNaoVistas} {novasNaoVistas === 1 ? 'nova linha' : 'novas linhas'}
        </button>
      )}
    </div>
  )
}
