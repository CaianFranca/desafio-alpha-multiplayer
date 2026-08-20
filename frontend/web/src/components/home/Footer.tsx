import { footer } from './placeholders'

export function Footer() {
  return (
    <footer className="app-footer" role="contentinfo">
      <div className="footer-inner">
        <p className="footer-brand">{footer.brand}</p>
        <p className="footer-tagline">{footer.tagline}</p>
        <p className="footer-copyright">{footer.copyright}</p>
      </div>
    </footer>
  )
}
