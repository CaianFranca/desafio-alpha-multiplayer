import { footer } from './placeholders'
import { useGatilhoDoModoDesenvolvedor } from '../../hooks/useGatilhoDoModoDesenvolvedor'

export function Footer() {
  // Gatilho escondido (issue #340, "Modo Desenvolvedor"): 5 cliques ≤3s no
  // logo Ginga ativam o modo. O clique no Ginga não navega mais — o gesto
  // substitui o link externo.
  const { lidarComClique } = useGatilhoDoModoDesenvolvedor()
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand-block">
            <p className="site-footer__brand">{footer.brand}</p>
            <p className="site-footer__tagline">{footer.tagline}</p>
          </div>
          <div className="site-footer__logos" aria-label="Parceiros">
            {footer.logos.map((logo) => {
              const logoClass = `site-footer__logo${
                logo.alt === 'Cummins'
                  ? ' site-footer__logo--cummins'
                  : logo.alt === 'Ginga'
                    ? ' site-footer__logo--ginga'
                    : ' site-footer__logo--alpha'
              }`
              const img = <img src={logo.src} alt={logo.alt} className={logoClass} />
              return 'href' in logo && logo.href ? (
                <a
                  key={logo.alt}
                  href={logo.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={logo.alt}
                >
                  {img}
                </a>
              ) : (
                // Gatilho do Modo Desenvolvedor (issue #340): o logo Ginga
                // (o único sem `href`) é o `<a>` do gesto escondido (5 cliques
                // ≤3s). `preventDefault` sempre — a partir do gesto o link
                // não navega.
                <a key={logo.alt} href="#" onClick={lidarComClique} aria-label={logo.alt}>
                  {img}
                </a>
              )
            })}
          </div>
        </div>
        <p className="site-footer__copyright">{footer.copyright}</p>
      </div>
    </footer>
  )
}
