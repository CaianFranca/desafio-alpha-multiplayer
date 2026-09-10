import { chaveCelula, selecionarPeaoNaExibicao } from '../../game/tabuleiro/contrato'
import type {
  Celula,
  PeaoDaExibicao,
  PeaoId,
  PecaCorrente,
  PecaDaMesa,
  PecaId,
  PecaPosicionada,
} from '../../game/tabuleiro/contrato'
import type { EstadoInteracaoTabuleiro } from '../../game/tabuleiro/interacao'
import type { EstadoInteracaoPeoes, MotivoDeRejeicaoLocal } from '../../game/tabuleiro/interacaoPeoes'
import {
  despacharCliqueDeCelula,
  despacharCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaMesa,
  puxadaVigenteNaBandeja,
} from '../../game/tabuleiro/interacaoPeoes'
import type {
  PeaoComandoDoCliente,
  TabuleiroComandoDoCliente,
} from '@flicker/shared'
import type { SanidadePorPeao } from '../../game/tabuleiro/reducao'
import type { EncaixeTrigger } from '../../game/tabuleiro/encaixe'

interface TabuleiroMirrorDOMProps {
  todasCelulas: readonly Celula[]
  ocupadasSet: ReadonlySet<string>
  /** Chaves das células iluminadas (mesma fonte da cena, issue #151). */
  iluminadasSet?: ReadonlySet<string>
  /** Peças Iniciais na mesa (mesma fonte da cena, issue #143). */
  iniciais: readonly PecaDaMesa[]
  /** Peça sorteada corrente na bandeja da Caixa (null = sem corrente, #143). */
  pecaCorrente?: PecaCorrente | null
  posicionadas: readonly PecaPosicionada[]
  peoes: readonly PeaoDaExibicao[]
  /** Peão selecionado (estado visual local espelhado da cena, issue #90). */
  peaoSelecionadoId: PeaoId | null
  /** Peão do Jogador Ativo da vez (data-ativo no espelho, #118). */
  peaoAtivoId?: PeaoId | null
  /** PecaIds destinos válidos do peão selecionado (mesma fonte do destaque). */
  destinosSet: ReadonlySet<PecaId>
  /**
   * Subconjunto de `destinosSet` com os destinos de RESGATE (exceção #171):
   * exposto como `data-resgate="true"` na peça — costura de teste do espelho;
   * a cena usa o mesmo set para o tom frio do destaque.
   */
  resgateSet?: ReadonlySet<PecaId>
  aoSelecionarPeao?: (peaoId: PeaoId) => void
  aoDesselecionar?: () => void
  /** Estado de interação ST-09 para o fallback de célula/peça da mesa (#91). */
  estadoInteracao?: EstadoInteracaoTabuleiro | null
  /** Estado do ciclo do peão: roteia cliques em células/pendências. */
  estadoPeoes?: EstadoInteracaoPeoes | null
  onComando?: (comando: TabuleiroComandoDoCliente | null) => void
  onComandoPeao?: (comando: PeaoComandoDoCliente) => void
  /** Rejeição local do roteador (guard pós-confirmação, AC3) → som de recusa no pai. */
  onRejeicaoPeao?: (motivo: MotivoDeRejeicaoLocal) => void
  /** Pull aceito na bandeja (fluxo #143/revisão #199) → estado local no pai. */
  onPuxar?: (recebidaId: string) => void
  /** Chaves das células-alvo de pendências ativas (mesma fonte da cena). */
  alvosPendentesSet?: ReadonlySet<string>
  /** Chaves das vagas disponíveis para a pendência corrente (#143, cena/espelho). */
  vagasSet?: ReadonlySet<string>
  /** Percepção mínima de Sanidade e estados (ST-15, issue #174) — peaoId → sanidade/estados. */
  sanidadePorPeao?: SanidadePorPeao
  /** Trigger de encaixe evento-driven (issue #241): espelha o voo mesa→célula. */
  encaixeTrigger?: EncaixeTrigger | null
}

/**
 * Espelho DOM do tabuleiro — seam de testes (a cena WebGL é caixa-preta no
 * jsdom). Deriva do MESMO estado que a cena: peões, seleção, conexões,
 * pendências de Recebimento, a Caixa (bloco opaco), a bandeja com a peça
 * sorteada corrente e as Peças Iniciais da mesa (issue #143); cliques passam
 * pelo MESMO roteador do ciclo (despacharCliqueDeCelula /
 * mapearCliqueNaPecaDaMesa, issues #91/#143).
 *
 * Os handlers de clique aqui só têm efeito em testes: em browser real o
 * overlay é `pointer-events-none` (os cliques passam para a cena, onde os
 * mesmos callbacks são disparados via raycast). Clicar um peão seleciona;
 * clicar célula/peça roteia pelo ciclo (comando) ou aplica o fallback ST-09;
 * clicar qualquer outra área desseleciona — espelhando a cena.
 */
export function TabuleiroMirrorDOM({
  todasCelulas,
  ocupadasSet,
  iluminadasSet = new Set<string>(),
  iniciais,
  pecaCorrente = null,
  posicionadas,
  peoes,
  peaoSelecionadoId,
  peaoAtivoId = null,
  destinosSet,
  resgateSet = new Set<PecaId>(),
  aoSelecionarPeao,
  aoDesselecionar,
  estadoInteracao = null,
  estadoPeoes = null,
  onComando,
  onComandoPeao,
  onRejeicaoPeao,
  onPuxar,
  alvosPendentesSet = new Set<string>(),
  vagasSet = new Set<string>(),
  sanidadePorPeao = {},
  encaixeTrigger = null,
}: TabuleiroMirrorDOMProps) {
  // Mesma derivação pura usada pela cena: resolve a peça sob o peão selecionado
  // (null quando o peão está sobre a Mesa ou sem peça → sem conexões destacadas).
  const selecao =
    peaoSelecionadoId !== null
      ? selecionarPeaoNaExibicao({ posicionadas, peoes }, peaoSelecionadoId)
      : null

  const aoClicarCelula = (celula: Celula, e: { stopPropagation(): void }) => {
    if (estadoInteracao === null) {
      // Sem canal de interação (mock DEV): deixa o clique borbulhar para a
      // raiz — comportamento de desseleção do #90.
      return
    }
    e.stopPropagation()
    despacharCliqueDeCelula(estadoPeoes, estadoInteracao, celula, {
      onComando,
      onComandoPeao,
      onRejeicao: onRejeicaoPeao
        ? (rejeicao) => onRejeicaoPeao(rejeicao.motivo)
        : undefined,
    })
  }

  const aoClicarPecaDaMesa = (pecaId: string) => {
    if (estadoInteracao === null) return
    // Mesmo roteador puro da cena (issue #143): clique em Inicial na mesa →
    // SELECIONAR_PECA (ST-09); silencioso com pendências / peça desconhecida.
    const comando = mapearCliqueNaPecaDaMesa(estadoPeoes, estadoInteracao, pecaId)
    if (comando === null) return
    onComando?.(comando)
  }

  return (
    <div
      data-testid="tabuleiro"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      onClick={aoDesselecionar}
    >
      {todasCelulas.map((celula) => {
        const chave = chaveCelula(celula)
        const ocupada = ocupadasSet.has(chave)
        const alvoPendente = alvosPendentesSet.has(chave)
        const vaga = vagasSet.has(chave)
        // Iluminação (issue #151): espelho DOM do MESMO set que ilumina a cena.
        const iluminada = iluminadasSet.has(chave)
        return (
          <div
            key={chave}
            data-testid="tabuleiro-celula"
            data-ocupada={ocupada ? 'true' : 'false'}
            data-linha={celula.linha}
            data-coluna={celula.coluna}
            data-alvo-pendente={alvoPendente ? 'true' : undefined}
            data-vaga={vaga ? 'true' : undefined}
            data-iluminada={iluminada ? 'true' : undefined}
            onClick={(e) => {
              aoClicarCelula(celula, e)
            }}
          />
        )
      })}
      {/* Caixa sobre a mesa (issue #143): bloco opaco (sem conteúdo exposto),
          bandeja de slot único com a corrente (clicável para PUXAR — revisão
          #199: mesmo despachador da cena; `data-puxada` expõe o estado local
          para os testes sem WebGL) e as Peças Iniciais clicáveis. */}
      <div data-testid="caixa">
        <div data-testid="caixa-bandeja">
          {pecaCorrente ? (
            <div
              data-testid="caixa-peca-sorteada"
              data-peca-id={pecaCorrente.pecaId}
              data-recebida-id={pecaCorrente.recebidaId}
              data-tipo={pecaCorrente.tipo}
              data-orientacao={pecaCorrente.orientacao}
              data-puxada={
                estadoPeoes !== null && puxadaVigenteNaBandeja(estadoPeoes)
                  ? 'true'
                  : 'false'
              }
              onClick={(e) => {
                // stopPropagation: a raiz desseleciona ao clicar área inerte.
                e.stopPropagation()
                despacharCliqueNaPecaDaBandeja(estadoPeoes, {
                  onPuxar,
                })
              }}
            />
          ) : null}
        </div>
        <div data-testid="caixa-iniciais">
          {iniciais.map((peca) => (
            <div
              key={peca.pecaId}
              data-testid="mesa-peca-inicial"
              data-tipo={peca.tipo}
              data-peca-id={peca.pecaId}
              onClick={(e) => {
                e.stopPropagation()
                aoClicarPecaDaMesa(peca.pecaId)
              }}
            />
          ))}
        </div>
      </div>
      {posicionadas.map((p) => (
        <div
          key={p.pecaId}
          data-testid="peca-posicionada"
          data-peca-id={p.pecaId}
          // Tipo derivado do modelo local (AC1 issue #145): prova de que peças
          // especiais entram no tabuleiro com o tipo correto no espelho DOM.
          data-tipo={p.tipo}
          // Voo do Encaixe (issue #241): a peça em voo carrega a origem
          // (mesa/bandeja) — costura de teste do espelho; a cena usa o mesmo
          // trigger para animar o voo mesa→célula.
          data-em-voo={encaixeTrigger?.pecaId === p.pecaId ? 'true' : undefined}
          data-origem-encaixe={
            encaixeTrigger?.pecaId === p.pecaId ? encaixeTrigger.origem : undefined
          }
          data-conectada={
            selecao ? (destinosSet.has(p.pecaId) ? 'true' : 'false') : undefined
          }
          data-resgate={resgateSet.has(p.pecaId) ? 'true' : undefined}
          data-selecionada={
            selecao ? (selecao.pecaId === p.pecaId ? 'true' : 'false') : undefined
          }
          // Janela de Manipulação 3D (experimental): costura de teste do
          // espelho — a cena WebGL é caixa-preta no jsdom; o estado vem da
          // mesma fonte (estadoInteracao.pecaEmManipulacaoId).
          data-manipulacao={
            estadoInteracao && estadoInteracao.pecaEmManipulacaoId === p.pecaId
              ? 'true'
              : undefined
          }
          onClick={(e) => {
            aoClicarCelula(p.celula, e)
          }}
        />
      ))}
      {estadoPeoes
        ? estadoPeoes.recebidasPendentes.map((r) => (
            <div
              key={r.recebidaId}
              data-testid="recebida-pendente"
              data-recebida-id={r.recebidaId}
              data-celula-alvo={r.celulaAlvo !== null ? chaveCelula(r.celulaAlvo) : undefined}
              data-peca-id={r.pecaId}
              data-vaga={r.vaga ?? undefined}
            />
          ))
        : null}
      <div data-testid="peoes">
        {peoes.map((peao) => {
          const percepcao = sanidadePorPeao[peao.peaoId]
          return (
            <div
              key={peao.peaoId}
              data-testid="peao"
              data-peao-id={peao.peaoId}
              data-cor={peao.cor}
              data-posicionado={peao.celula !== null ? 'true' : 'false'}
              data-selecionado={peao.peaoId === peaoSelecionadoId ? 'true' : 'false'}
              data-ativo={peao.peaoId === peaoAtivoId ? 'true' : 'false'}
              data-sanidade={percepcao ? String(percepcao.sanidade) : undefined}
              data-em-baixa={percepcao?.emBaixaIluminacao ? 'true' : undefined}
              data-amedrontado={percepcao?.amedrontado ? 'true' : undefined}
              onClick={(e) => {
                // stopPropagation: não deixar o clique chegar ao "clique fora"
                // da raiz, que desselecionaria na sequência.
                e.stopPropagation()
                aoSelecionarPeao?.(peao.peaoId)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
