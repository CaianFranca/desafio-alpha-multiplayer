import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CodigoDeSalaCard } from '../components/sala/CodigoDeSalaCard'
import { LinkDiretoCard } from '../components/sala/LinkDiretoCard'
import { ListaDeMembros } from '../components/sala/ListaDeMembros'
import { AvisosDoLobby } from '../components/sala/AvisosDoLobby'
import { ChatDoLobby } from '../components/sala/ChatDoLobby'
import { ControlesDoAnfitriao } from '../components/sala/ControlesDoAnfitriao'
import { AuthContext } from '../state/auth-context'
import { useSalaWebSocketContext } from '../state/sala-web-socket-context'
import { CODIGO_DE_SALA_TAMANHO, normalizarCodigoDeSala } from '../utils/codigoDeSala'

export function SalaPage() {
  const { codigoDeSala: codigoParam } = useParams<{ codigoDeSala: string }>()
  const navigate = useNavigate()
  const { authState } = useContext(AuthContext)
  const jogadorId = authState.status === 'authenticated' ? authState.jogador.id : undefined
  const {
    sala,
    avisos,
    mensagensDeChat,
    jogadoresBloqueados,
    conectado,
    erro,
    criarSala,
    entrarNaSala,
    alternarProntidao,
    sairDaSala,
    enviarMensagemDeChat,
    expulsarMembro,
    desbloquearJogador,
    encerrarSala,
    iniciarPartida,
  } = useSalaWebSocketContext()
  const [codigoInput, setCodigoInput] = useState('')
  const conviteEnviadoRef = useRef<string | null>(null)
  const conectando = !conectado && !sala

  // Anfitrião: membro local identificado por jogadorId, comparado ao anfitriaoId da sala.
  const membroLocal = sala?.membros.find((m) => m.jogadorId === jogadorId) ?? null
  const ehAnfitriao = membroLocal !== null && sala !== null && sala.anfitriaoId === membroLocal.id

  // Sai da sala (SAIR_DA_SALA) e volta à tela de criar/entrar. Nunca encerra a Sessão.
  const sairDaSalaEComecarDeNovo = useCallback(() => {
    sairDaSala()
    navigate('/salas/criar')
  }, [sairDaSala, navigate])

  // Entrada por rota de Convite /sala/:codigoDeSala — envia apenas uma vez
  // por código normalizado, para não reentrar após sair da sala.
  useEffect(() => {
    if (!codigoParam || sala) return
    const codigo = normalizarCodigoDeSala(codigoParam)
    if (codigo && conviteEnviadoRef.current !== codigo) {
      conviteEnviadoRef.current = codigo
      entrarNaSala(codigo)
    }
  }, [codigoParam, sala, entrarNaSala])

  // Se o servidor rejeitar a entrada (ex.: SALA_NAO_ENCONTRADA), libera a ref
  // para permitir nova tentativa — sem reenviar sozinho enquanto houver erro.
  useEffect(() => {
    if (!erro || sala || !codigoParam) return
    const codigo = normalizarCodigoDeSala(codigoParam)
    if (codigo && conviteEnviadoRef.current === codigo) {
      conviteEnviadoRef.current = null
    }
  }, [erro, sala, codigoParam])

  const possuiSala = sala !== null

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[#111]">
      {/* Container bipartido */}
      <div className="max-w-[1100px] mx-auto px-6 lg:px-8 py-10 lg:py-12 flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-0 relative">
          {/* Coluna esquerda institucional */}
          <div className="flex flex-col justify-center gap-8 lg:pr-16 py-12 lg:py-20 lg:border-r lg:border-white/10 relative">
            <div className="flex flex-col gap-3">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#c9a86a] flex items-center gap-3">
                <span className="w-8 h-px bg-[#c9a86a]" aria-hidden />
                Protocolo de Isolamento
              </p>
              <h1 className="text-5xl font-light text-white tracking-tight">
                {possuiSala ? `Sala ${sala.codigoDeSala}` : 'Criar Sala'}
              </h1>
              <p className="text-white/60 text-sm leading-relaxed max-w-sm mt-2">
                Reúna sua equipe de 4 investigadores. O Monte Sérion aguarda. A sanidade é escassa, a cooperação é vital.
              </p>
            </div>

            {/* Ações da esquerda */}
            <div className="flex flex-col gap-4 max-w-sm">
              {!possuiSala ? (
                <>
                  <button
                    type="button"
                    onClick={criarSala}
                    disabled={conectando}
                    className="w-fit border border-white/20 px-8 py-3 text-sm tracking-[0.18em] uppercase text-white hover:bg-white hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-white"
                  >
                    Criar Sala →
                  </button>

                  <div className="flex flex-col gap-2 pt-6 border-t border-white/10">
                    <label htmlFor="codigo-entrada" className="text-[10px] tracking-[0.18em] uppercase text-white/60">
                      Entrar em Sala existente
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="codigo-entrada"
                        value={codigoInput}
                        onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
                        placeholder="Código de Sala"
                        maxLength={CODIGO_DE_SALA_TAMANHO}
                        className="flex-1 bg-[#1e1e1e] border border-white/15 px-3 py-2 text-sm tracking-[0.2em] uppercase text-white placeholder:text-white/30 focus:outline-none focus:border-[#c9a86a]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const codigo = normalizarCodigoDeSala(codigoInput)
                          if (codigo) entrarNaSala(codigo)
                        }}
                        disabled={conectando}
                        className="border border-[#c9a86a] text-[#c9a86a] px-4 py-2 text-xs font-bold tracking-wider uppercase hover:bg-[#c9a86a] hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#c9a86a]"
                      >
                        Entrar na Sala
                      </button>
                    </div>
                    {codigoParam && (
                      <p className="text-xs text-white/50">Convite detectado: {codigoParam.toUpperCase()}</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={alternarProntidao}
                    className="w-fit border border-[#c9a86a] bg-[#c9a86a]/10 text-[#c9a86a] px-8 py-3 text-sm tracking-[0.18em] uppercase hover:bg-[#c9a86a] hover:text-black transition-colors"
                  >
                    Alternar Prontidão
                  </button>
                  <button
                    type="button"
                    onClick={sairDaSalaEComecarDeNovo}
                    className="w-fit border border-white/20 px-8 py-3 text-sm tracking-[0.18em] uppercase text-white/70 hover:text-white hover:border-white/40 transition-colors"
                  >
                    Sair da Sala
                  </button>
                </>
              )}
              {erro && (
                <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2">
                  {erro}
                </p>
              )}
            </div>

            {/* Controles do Anfitrião + Chat: bloco inferior da coluna esquerda */}
            <div className="mt-auto pt-8 flex flex-col gap-6">
              {sala && (
                <>
                  <ControlesDoAnfitriao
                    sala={sala}
                    ehAnfitriao={ehAnfitriao}
                    jogadoresBloqueados={jogadoresBloqueados}
                    aoEncerrarSala={encerrarSala}
                    aoIniciarPartida={iniciarPartida}
                    aoDesbloquearJogador={desbloquearJogador}
                  />
                  <ChatDoLobby mensagens={mensagensDeChat} aoEnviar={enviarMensagemDeChat} />
                </>
              )}
            </div>

            {/* diamante divisor no centro (visível desktop) */}
            <div
              className="hidden lg:flex absolute top-1/2 -right-[7px] -translate-y-1/2 w-[14px] h-[14px] bg-[#111] border border-white/15 rotate-45 items-center justify-center"
              aria-hidden
            >
              <span className="w-1.5 h-1.5 bg-[#c9a86a] rotate-45" />
            </div>
          </div>

          {/* Coluna direita Ponto de Encontro */}
          <div className="flex flex-col gap-6 lg:pl-16 py-4 lg:py-8">
            {/* Cabeçalho ponto de encontro */}
            <div className="flex items-end justify-between border-b border-white/15 pb-3">
              <h2 className="text-2xl font-light tracking-[0.2em] uppercase text-white">Ponto de Encontro</h2>
              {conectando ? (
                <span className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-yellow-400">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" aria-hidden /> Conectando...
                </span>
              ) : (
                <span className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden /> Conectado
                </span>
              )}
            </div>

            {possuiSala ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CodigoDeSalaCard codigoDeSala={sala.codigoDeSala} />
                  <LinkDiretoCard link={sala.convite.link} />
                </div>

                <ListaDeMembros
                  sala={sala}
                  jogadorIdLocal={jogadorId}
                  ehAnfitriao={ehAnfitriao}
                  onExpulsar={expulsarMembro}
                />
                <AvisosDoLobby avisos={avisos} />
              </>
            ) : (
              <>
                {/* Estado vazio mostra cards desabilitados e vagas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-60">
                  <div className="border border-white/10 bg-[#1e1e1e] p-5">
                    <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Código de Sala</p>
                    <p className="text-sm text-white/30 mt-3">Crie uma sala para ver o código</p>
                  </div>
                  <div className="border border-white/10 bg-[#1e1e1e] p-5">
                    <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Link Direto</p>
                    <p className="text-sm text-white/30 mt-3">Link aparecerá aqui</p>
                  </div>
                </div>
                <ListaDeMembros sala={null} />
                <p className="text-xs text-white/40">Crie uma sala ou entre com um Código de Sala para começar.</p>
                {avisos.length > 0 && <AvisosDoLobby avisos={avisos} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
