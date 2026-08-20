import { footer } from './placeholders'

export function Footer() {
  return (
    <footer className="border-t border-white/5 py-10 px-8 text-center" role="contentinfo">
      <div className="max-w-7xl mx-auto">
        <p className="font-bold tracking-[.04em] mb-1">{footer.brand}</p>
        <p className="text-(--color-muted) text-sm mb-2">{footer.tagline}</p>
        <p className="text-(--color-muted) text-xs m-0">{footer.copyright}</p>
      </div>
    </footer>
  )
}
