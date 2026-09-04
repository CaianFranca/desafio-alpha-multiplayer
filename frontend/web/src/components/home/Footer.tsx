import { footer } from './placeholders'

export function Footer() {
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
                <span key={logo.alt}>{img}</span>
              )
            })}
          </div>
        </div>
        <p className="site-footer__copyright">{footer.copyright}</p>
      </div>
    </footer>
  )
}
