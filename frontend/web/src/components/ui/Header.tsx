import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../state/useAuth'
import { useSalaWebSocketContext } from '../../state/sala-web-socket-context'
import { criarSalaLabel, retornarParaSalaLabel } from '../auth/AuthActions'

const styleBotaoSair = 'site-header__cta site-header__logout'
const styleVoltar = 'site-header__cta'
const styleCriarSala = 'site-header__cta'

export function Header() {
  const { authState, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const emLobby = location.pathname.startsWith('/salas') || location.pathname.startsWith('/sala')
  const { sala } = useSalaWebSocketContext()
  const emSala = sala !== null
  const autenticado = authState.status === 'authenticated'
  // Âncoras só na Home sem sala (Visitante ou Jogador sem sala); em lobby ou
  // com sala o header foca nos CTAs (variações 3 e 4 da #211).
  const mostrarNav = !emLobby && !emSala

  // A navegação pós-logout fica aqui porque o AuthProvider está acima do
  // RouterProvider em main.tsx (o provider não tem acesso ao navigate).
  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <header className="site-header">
      <a href="#main-content" className="site-header__skip-link">
        Pular para o conteúdo
      </a>
      <div className="site-header__inner">
        <Link className="site-header__brand font-display" to="/">FLICKER OF SANITY</Link>
        <div className="site-header__right">
          {mostrarNav && (
            <nav aria-label="Navegação principal" className="site-header__nav">
              <a href="#historia" className="site-header__nav-link">História</a>
              <a href="#trailers" className="site-header__nav-link">Trailers</a>
              <a href="#caracteristicas" className="site-header__nav-link">Características</a>
              <a href="#objetivos" className="site-header__nav-link">Objetivos</a>
            </nav>
          )}
          {!autenticado && !emLobby && (
            <div className="site-header__guest">
              <Link to="/login" className="site-header__login cta-primary">Entrar</Link>
              <Link to="/cadastro" className="site-header__cta">Criar conta</Link>
            </div>
          )}
          {autenticado && (
            <div className="site-header__user">
              <span className="site-header__nickname truncate">{authState.jogador.apelido}</span>
              {emLobby ? (
                <button type="button" onClick={() => navigate('/')} className={styleVoltar}>
                  Voltar para o início
                </button>
              ) : (
                <Link to="/salas/criar" className={styleCriarSala}>
                  {emSala ? retornarParaSalaLabel : criarSalaLabel}
                </Link>
              )}
              {/* Sair encerra a Sessão (logout); sair da Sala é ação do corpo da página. */}
              <button
                type="button"
                onClick={() => void handleLogout()}
                className={styleBotaoSair}
              >
                Sair
                <img
                  src="/assets/door_open_icon.svg"
                  alt=""
                  aria-hidden="true"
                  className="site-header__logout-icon"
                />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
