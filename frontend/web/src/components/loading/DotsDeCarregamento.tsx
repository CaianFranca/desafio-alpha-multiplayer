import { texturaDaPeca } from '../../game/tabuleiro/texturasDasPecas'

// Ordem dos dots do loading (#387): Gerador → Sala Médica → Portão de Saída → Espectro.
const DOTS_DO_CARREGAMENTO = ['gerador', 'sala_medica', 'portao_de_saida', 'espectro'] as const

interface DotsDeCarregamentoProps {
  /** Texto visível pequeno (ex.: "Carregando..."). Null omite o rótulo. */
  rotuloVisivel?: string | null
  /**
   * Nome anunciado ao leitor de tela (nó sr-only). Omita quando o texto
   * visível ao redor já nomeia a região (aguardando, header Conectando).
   */
  nomeAcessivel?: string | null
  /** Tamanho dos dots; mini serve ao header Conectando e ao aguardando. */
  tamanho?: 'padrao' | 'mini'
}

export function DotsDeCarregamento({ rotuloVisivel = null, nomeAcessivel = null, tamanho = 'padrao' }: DotsDeCarregamentoProps) {
  const dotsClassName =
    tamanho === 'mini'
      ? 'encaminhamento-carregando__dots encaminhamento-carregando__dots--mini'
      : 'encaminhamento-carregando__dots'
  return (
    <>
      {rotuloVisivel !== null ? (
        <p aria-hidden="true" className="encaminhamento-carregando__mensagem encaminhamento-carregando__mensagem--pequena">
          {rotuloVisivel}
        </p>
      ) : null}
      <span aria-hidden="true" className={dotsClassName}>
        {DOTS_DO_CARREGAMENTO.map((tipo) => (
          <span
            key={tipo}
            className="encaminhamento-carregando__dot"
            style={{ backgroundImage: `url(${texturaDaPeca(tipo).map})` }}
          />
        ))}
      </span>
      {nomeAcessivel !== null ? <span className="sr-only">{nomeAcessivel}</span> : null}
    </>
  )
}
