import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../state/useAuth'
import { useSalaWebSocketContext } from '../../state/sala-web-socket-context'
import { criarSalaLabel, retornarParaSalaLabel } from '../auth/AuthActions'

const styleBotaoHeader =
  'border border-white/20 px-4 py-2 text-xs tracking-[0.18em] font-bold uppercase text-white hover:bg-white hover:text-black transition-colors'

// Rótulo do CTA criado com cantos retos (sem arredondamento) e fundo accent,
// espelhando o CtaLink primary — corrige a UX do header (critério #128).
const styleLinkCriarSala =
  'inline-block border-0 rounded-none bg-[var(--color-accent)] text-gray-800 cursor-pointer font-sans font-bold text-center hover:opacity-90 transition-opacity px-4 py-2 text-sm'

export function Header() {
  const { authState, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const emLobby = location.pathname.startsWith('/salas') || location.pathname.startsWith('/sala')
  const { sala } = useSalaWebSocketContext()
  const emSala = sala !== null

  // A navegação pós-logout fica aqui porque o AuthProvider está acima do
  // RouterProvider em main.tsx (o provider não tem acesso ao navigate).
  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-40 bg-[var(--color-background)] py-6 px-[clamp(1.5rem,5vw,5rem)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-(--color-accent) focus:text-gray-800 focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold">
        Pular para o conteúdo
      </a>
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 items-center gap-4">
        <Link className="w-fit font-extrabold tracking-[.04em] text-inherit no-underline justify-self-center sm:justify-self-start" to="/">Flicker of Sanity</Link>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-6 gap-y-3">
          {!emLobby && (
            <nav aria-label="Navegação principal" className="flex gap-6">
              <a href="#trailers" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Trailers</a>
              <a href="#historia" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">História</a>
              <a href="#caracteristicas" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Características</a>
              <a href="#objetivos" className="w-fit text-(--color-muted) text-sm hover:text-white transition-colors">Objetivos</a>
            </nav>
          )}
          {authState.status === 'authenticated' && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold">{authState.jogador.apelido}</span>
              {emLobby ? (
                <button type="button" onClick={() => navigate('/')} className={styleBotaoHeader}>
                  Voltar para o início
                </button>
              ) : (
                <Link to="/salas/criar" className={styleLinkCriarSala}>
                  {emSala ? retornarParaSalaLabel : criarSalaLabel}
                </Link>
              )}
              {/* Sair encerra a Sessão (logout); sair da Sala é ação do corpo da página. */}
              <button
                type="button"
                onClick={() => void handleLogout()}
                className={styleBotaoHeader}
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
