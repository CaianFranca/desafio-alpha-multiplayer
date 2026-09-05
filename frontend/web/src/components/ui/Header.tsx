import type { MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../state/useAuth'
import { useSalaWebSocketContext } from '../../state/sala-web-socket-context'
import { criarSalaLabel, retornarParaSalaLabel } from '../auth/AuthActions'
import { rolarSecaoParaCentro } from '../../utils/rolagemDeSecao'

const styleBotaoSair = 'site-header__cta site-header__logout'
const styleVoltar = 'site-header__cta'
const styleCriarSala = 'site-header__cta site-header__cta--accent'

const secoesDoHeader = [
  { rotulo: 'Trailers', id: 'trailers' },
  { rotulo: 'História', id: 'historia' },
  { rotulo: 'Características', id: 'caracteristicas' },
  { rotulo: 'Objetivos', id: 'objetivos' },
] as const

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

  // Logo na Home volta para o hero com scroll suave; fora dela o Link
  // navega para "/" normalmente (que já abre no topo, onde está o hero).
  function irParaHero(event: MouseEvent<HTMLAnchorElement>) {
    if (location.pathname !== '/') return
    event.preventDefault()
    rolarSecaoParaCentro('hero', 'smooth')
  }

  // Âncoras apontam para seções da Home, com o topo da seção a 20% da
  // viewport. Na Home o scroll é suave; fora dela redireciona para "/#id"
  // (a HomePage rola de forma instantânea ao montar).
  function irParaSecao(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (location.pathname === '/') {
      event.preventDefault()
      rolarSecaoParaCentro(id, 'smooth')
      return
    }
    event.preventDefault()
    navigate(`/#${id}`)
  }

  return (
    <header className="site-header">
      <a href="#main-content" className="site-header__skip-link">
        Pular para o conteúdo
      </a>
      <div className="site-header__inner">
        <Link className="site-header__brand font-display" to="/" onClick={irParaHero}>FLICKER OF SANITY</Link>
        <div className="site-header__right">
          {mostrarNav && (
            <nav aria-label="Navegação principal" className="site-header__nav">
              {secoesDoHeader.map((secao) => (
                <a
                  key={secao.id}
                  href={`/#${secao.id}`}
                  onClick={(event) => irParaSecao(event, secao.id)}
                  className="site-header__nav-link"
                >
                  {secao.rotulo}
                </a>
              ))}
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
              <span className="site-header__nickname truncate">{authState.jogador.apelido}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
