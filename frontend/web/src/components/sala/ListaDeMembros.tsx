import { useMemo } from 'react'
import type { Sala } from '@flicker/shared'

interface Props {
  sala: Sala | null
  jogadorIdLocal?: string
  ehAnfitriao?: boolean
  onExpulsar?: (membroId: string) => void
}

function ordenarMembros(sala: Sala | null) {
  if (!sala) return []
  return [...sala.membros].sort((a, b) => a.ordemDeEntrada - b.ordemDeEntrada)
}

export function ListaDeMembros({ sala, jogadorIdLocal, ehAnfitriao, onExpulsar }: Props) {
  const membrosOrdenados = useMemo(() => ordenarMembros(sala), [sala])
  const total = 4
  const vagas = useMemo(() => Array.from({ length: total }, (_, i) => membrosOrdenados[i] ?? null), [membrosOrdenados])
  const ocupados = membrosOrdenados.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-[0.18em] uppercase text-white/60">Equipe</p>
        <span className="border border-[#c9a86a]/60 px-3 py-1 text-[10px] tracking-wider font-bold text-[#c9a86a] bg-[#c9a86a]/10">
          MEMBRO {ocupados} DE {total}
        </span>
      </div>

      <ul className="flex flex-col gap-3" aria-label="Lista de Membros">
        {vagas.map((membro, idx) => {
          if (membro) {
            const membroEhAnfitriao = sala?.anfitriaoId === membro.id
            return (
              <li
                key={membro.id}
                className={`flex items-center gap-4 p-4 bg-[#1e1e1e] border ${membroEhAnfitriao ? 'border-l-2 border-l-[#c9a86a] border-y-white/10 border-r-white/10' : 'border-white/10'}`}
              >
                <div className="w-8 h-8 border border-[#c9a86a] flex items-center justify-center text-[#c9a86a] shrink-0" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{membro.apelido}</p>
                  <p className="text-[10px] tracking-wider uppercase text-[#c9a86a]">
                    {membroEhAnfitriao ? 'Anfitrião' : 'Membro'} / {membro.presenca === 'conectado' ? 'Conectado' : 'Em reconexão'} {membro.prontidao ? '• Pronto' : ''}
                  </p>
                </div>
                {membro.prontidao && (
                  <span className="text-green-400 text-xs" aria-label="Pronto">✓</span>
                )}
                {/* ícone de prontidão no canto */}
                <div
                  className={`w-6 h-6 border flex items-center justify-center shrink-0 ${membro.prontidao ? 'border-green-500 text-green-400' : 'border-white/20 text-white/40'}`}
                  aria-label={membro.prontidao ? 'Membro pronto' : 'Membro não pronto'}
                >
                  <span className="text-[10px]">{membro.prontidao ? '✓' : '○'}</span>
                </div>
                {/* Expulsar: apenas o Anfitrião vê, e nunca no próprio Anfitrião */}
                {ehAnfitriao && onExpulsar && jogadorIdLocal !== undefined && membro.jogadorId !== jogadorIdLocal && (
                  <button
                    type="button"
                    onClick={() => onExpulsar(membro.id)}
                    className="border border-white/20 px-3 py-1 text-[10px] font-bold tracking-wider uppercase text-white/60 hover:text-red-400 hover:border-red-400/60 transition-colors shrink-0"
                  >
                    Expulsar
                  </button>
                )}
              </li>
            )
          }
          return (
            <li
              key={`vaga-${idx}`}
              className="flex items-center gap-4 p-4 bg-[#1a1a1a] border border-dashed border-white/15"
            >
              <div className="w-8 h-8 border border-dashed border-white/20 flex items-center justify-center text-white/30 shrink-0" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-white/60 text-sm">Aguardando Conexão...</p>
                <p className="text-[10px] tracking-wider uppercase text-white/30">Sinal Inexistente</p>
              </div>
              <span className="w-2 h-2 rounded-full bg-white/30 shrink-0" aria-hidden />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
