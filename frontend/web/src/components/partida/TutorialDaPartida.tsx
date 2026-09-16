/**
 * Tutorial da Partida em carrossel (issue #434).
 *
 * Modal central sobre a Partida com 13 slides, 1 mídia por slide (base de 5
 * da spec, com o desmembramento autorizado: posicionar em 2 slides,
 * Especiais em 5 slides, Vulto em 2 slides e Espectro em 2 slides com Perda
 * de Sanidade, pela legibilidade no modo compacto): Posicionar Peça de
 * Caminho, Conexão obrigatória, Movimentar Peão, Gerador, Sala do Diretor,
 * Sala Médica, Proteção, Portão de Saída, Vulto, Baixa Iluminação, Espectro,
 * Perda de Sanidade e Objetivo.
 * A ordem dos tópicos e a cobertura seguem a spec, sem desbloqueio
 * progressivo — todos os slides existem desde o início, sem badge.
 *
 * Copy curta no glossário canônico (`CONTEXT.md`): Peça de Caminho, Conexão,
 * Peão, Movimentação, Iluminação, Peça Especial (Gerador, Sala do Diretor,
 * Sala Médica, Portão de Saída), Conquista, Monstro (O Vulto, O Espectro),
 * Alcance, Ataque, Baixa Iluminação, Sanidade, Amedrontado, Proteção,
 * Cartão de Acesso, Objetivo Global, Caixa, Primeiro Turno e Confirmação
 * de Posição.
 *
 * Variante escura da referência (`como_tutorial_deve_ser.jpeg`, ModalTutorial2):
 * fundo escuro, título central, botão "Próximo →" âmbar. Mídias servidas pelo
 * duto canônico (`frontend/web/media/tutorial/` → `/media/tutorial/`, via
 * `comBase`), cada uma com texto alternativo.
 *
 * Block da cena: com o modal aberto EM ANDAMENTO um backdrop cobre a tela
 * engolindo cliques (X, clique no backdrop ou Escape minimizam para o botão
 * no HUD) — o jogo NÃO pausa, só o input para. No RESULTADO não há backdrop
 * nem trap de Tab (os botões de Vitória/Derrota seguem clicáveis); Escape
 * minimiza sempre, em qualquer estado. O gate de teclado da cena
 * (R/E/Espaço/Enter) vive na PartidaPage, que lê o estado aberto.
 *
 * Em viewport compacto de paisagem (#230) o modal mantém a mesma moldura em
 * versão mínima (largura limitada, mídia com altura máxima e rolagem interna
 * do slide) — sem reorganizar o carrossel.
 */

import { useEffect, useRef } from 'react'
import { useViewportCompacto } from '../../hooks/useViewportCompacto'
import { SLIDES_DO_TUTORIAL_DA_PARTIDA } from './conteudoDoTutorialDaPartida'

interface TutorialDaPartidaProps {
  aberto: boolean
  /** Slide atual (0-based); o carrossel nunca re-renderiza a cena. */
  indice: number
  aoFechar: () => void
  aoIrPara: (indice: number) => void
  /**
   * Bloqueio da cena: true em andamento (backdrop + trap de Tab ativos),
   * false no Resultado (sem backdrop, sem trap — só Escape minimiza). A
   * página passa `estadoEmAndamento`.
   */
  bloqueiaCena?: boolean
  /** Força/deriva o modo compacto paisagem-celular (issue #230). */
  compacto?: boolean | null
}

export function TutorialDaPartida({
  aberto,
  indice,
  aoFechar,
  aoIrPara,
  bloqueiaCena = true,
  compacto = null,
}: TutorialDaPartidaProps) {
  const dialogoRef = useRef<HTMLDivElement | null>(null)
  const emModoCompacto = useViewportCompacto(compacto)
  const total = SLIDES_DO_TUTORIAL_DA_PARTIDA.length
  const indiceSeguro = Math.min(Math.max(indice, 0), total - 1)
  const slide = SLIDES_DO_TUTORIAL_DA_PARTIDA[indiceSeguro]!
  const ehUltimo = indiceSeguro === total - 1

  // Foco gerenciado: abrir move o foco ao diálogo; Escape minimiza SEMPRE
  // (atalho, não bloqueio) e devolve o foco ao botão do HUD; Tab circula SÓ
  // dentro do diálogo quando `bloqueiaCena` (em andamento). No Resultado
  // (`bloqueiaCena=false`) não há trap: os botões de Vitória/Derrota seguem
  // alcançáveis por teclado.
  useEffect(() => {
    if (!aberto) return
    dialogoRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        aoFechar()
        document.querySelector<HTMLElement>('[data-testid="hud-tutorial"]')?.focus()
        return
      }
      if (!bloqueiaCena) return
      if (e.key !== 'Tab') return
      const dialogo = dialogoRef.current
      if (!dialogo) return
      const focaveis = [...dialogo.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )]
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]!
      const ultimo = focaveis[focaveis.length - 1]!
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, aoFechar, bloqueiaCena])

  // Minimizado ≡ botão no HUD: sem estado minimizado separado, o painel
  // desmonta e o botão do HUD reabre de onde parou.
  if (!aberto) return null

  const irParaAnterior = () => aoIrPara(Math.max(indiceSeguro - 1, 0))
  const irParaProximo = () => aoIrPara(Math.min(indiceSeguro + 1, total - 1))

  return (
    <div
      data-testid="tutorial-da-partida"
      data-compacto={emModoCompacto ? 'true' : 'false'}
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center p-4"
    >
      {bloqueiaCena ? (
        <div
          data-testid="tutorial-backdrop"
          data-compacto={emModoCompacto ? 'true' : 'false'}
          onClick={aoFechar}
          aria-hidden="true"
          className="absolute inset-0 bg-zinc-950/60"
        />
      ) : null}
      <div
        ref={dialogoRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial da Partida"
        data-testid="tutorial-dialogo"
        className={`relative flex max-h-full w-full flex-col border border-[#504533] bg-[#1C140E] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_32px_rgba(0,0,0,0.6)] focus:outline-none ${
          emModoCompacto ? 'max-w-md' : 'max-w-xl'
        }`}
      >
        <button
          type="button"
          data-testid="tutorial-fechar"
          onClick={aoFechar}
          aria-label="Fechar tutorial"
          className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-zinc-300 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <span aria-hidden="true" className="text-xl leading-none">×</span>
        </button>
        <h2
          data-testid="tutorial-titulo"
          className="px-8 pt-4 text-center font-display text-base font-semibold uppercase tracking-[0.22em] text-zinc-100"
        >
          {slide.titulo}
        </h2>
        {/*
          Região viva do slide (história 13): o conteúdo anuncia a troca via
          aria-live; o `key` remonta o nó a cada navegação para repetições
          re-anunciarem. O anúncio sr-only dedicado repete "Slide X de N" para
          leitores que coalescem a região principal.
        */}
        <div
          key={indiceSeguro}
          data-testid="tutorial-slide"
          data-indice={String(indiceSeguro)}
          data-total={String(total)}
          role="group"
          aria-roledescription="slide"
          aria-label={`Slide ${indiceSeguro + 1} de ${total}: ${slide.titulo}`}
          aria-live="polite"
          aria-atomic="true"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-3"
        >
          <p className="text-center text-sm leading-relaxed text-zinc-200">{slide.texto}</p>
          <div className="flex flex-col items-center gap-3">
            {slide.midias.map((midiaAtual) => (
              <img
                key={midiaAtual.src}
                src={midiaAtual.src}
                alt={midiaAtual.alt}
                data-testid="tutorial-midia"
                draggable={false}
                className={`w-full rounded border border-[#504533] object-contain ${
                  emModoCompacto ? 'max-h-36' : 'max-h-64'
                }`}
              />
            ))}
          </div>
        </div>
        <div
          data-testid="tutorial-anuncio"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {`Slide ${indiceSeguro + 1} de ${total}: ${slide.titulo}`}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#504533] bg-[rgba(0,0,0,0.6)] px-4 py-2.5">
          <button
            type="button"
            data-testid="tutorial-anterior"
            onClick={irParaAnterior}
            disabled={indiceSeguro === 0}
            aria-label="Slide anterior"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-3 text-lg leading-none text-zinc-200 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <div
            data-testid="tutorial-indicadores"
            role="group"
            aria-label="Slides do tutorial"
            className="flex items-center gap-1.5"
          >
            {SLIDES_DO_TUTORIAL_DA_PARTIDA.map((slideAtual, i) => (
              <button
                key={slideAtual.titulo}
                type="button"
                data-testid="tutorial-indicador"
                data-indice={String(i)}
                data-atual={i === indiceSeguro ? 'true' : 'false'}
                onClick={() => aoIrPara(i)}
                aria-label={`Ir para o slide ${i + 1}: ${slideAtual.titulo}`}
                aria-current={i === indiceSeguro ? 'true' : undefined}
                className={`min-h-[44px] min-w-[24px] px-1 focus-visible:outline-2 focus-visible:outline-amber-500 ${
                  i === indiceSeguro ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {i === indiceSeguro ? '●' : '○'}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="tutorial-proxima"
            onClick={irParaProximo}
            disabled={ehUltimo}
            aria-label="Próximo slide"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-3 text-lg leading-none text-zinc-200 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className="flex justify-center px-4 pb-4">
          <button
            type="button"
            data-testid="tutorial-proximo"
            onClick={() => {
              if (ehUltimo) aoFechar()
              else irParaProximo()
            }}
            className="min-h-[44px] rounded bg-amber-500 px-6 py-2 text-sm font-semibold uppercase tracking-[0.14em] text-zinc-900 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500"
          >
            {ehUltimo ? 'Começar a jogar' : 'Próximo →'}
          </button>
        </div>
      </div>
    </div>
  )
}
