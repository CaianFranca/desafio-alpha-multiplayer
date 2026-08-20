import { Link } from 'react-router-dom'

export function BackLink() {
  return (
    <Link to="/" className="inline-block border-2 border-(--color-muted) rounded-lg bg-transparent text-(--color-muted) cursor-pointer font-sans font-semibold px-5 py-3 text-center hover:border-white hover:text-white transition-colors">
      ← Voltar ao início
    </Link>
  )
}
