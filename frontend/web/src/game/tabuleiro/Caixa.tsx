import {
  BANDEJA_LARGURA,
  BANDEJA_PROFUNDIDADE,
  CAIXA_ALTURA,
  CAIXA_LARGURA,
  CAIXA_PROFUNDIDADE,
  POSICAO_BANDEJA,
  POSICAO_CAIXA,
  POSICAO_INICIAIS,
  inicialIndiceParaLocal,
} from './contrato'
import type { PecaCorrente, PecaDaMesa } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'
import type { EstadoInteracaoTabuleiro } from './interacao'
import type { EstadoInteracaoPeoes } from './interacaoPeoes'
import {
  despacharCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaBandeja,
  mapearCliqueNaPecaDaMesa,
  puxadaVigenteNaBandeja,
} from './interacaoPeoes'
import type { TabuleiroComandoDoCliente } from '@flicker/shared'

interface CaixaProps {
  iniciais: readonly PecaDaMesa[]
  /** Peça sorteada corrente para exibição na bandeja (null = sem corrente). */
  pecaCorrente: PecaCorrente | null
  /** Estado de interação para destaque da Inicial selecionada. */
  estadoInteracao: EstadoInteracaoTabuleiro
  onComando: (comando: TabuleiroComandoDoCliente | null) => void
  /** Estado do ciclo: com pendências, o clique em Inicial fica silencioso (#143). */
  estadoPeoes?: EstadoInteracaoPeoes | null
  /**
   * Pull aceito na bandeja (fluxo #143/revisão #199): o pai persiste o id como
   * estado local; sem callback a bandeja fica inerte. O pull é silencioso
   * (issue #228): nenhum feedback visual nem sonoro.
   */
  onPuxar?: (recebidaId: string) => void
}

/**
 * Caixa sobre a mesa (issue #143): substitui a ficção antiga das 22 peças
 * expostas pela da Caixa — bloco fechado e opaco (o wire não expõe o
 * conteúdo da Caixa), bandeja de SLOT ÚNICO com a peça sorteada CORRENTE
 * (fluxo sequencial: uma peça por vez, do sorteio ao encaixe) e as 4 Peças
 * Iniciais em grade 2×2, clicáveis (fallback ST-09 → SELECIONAR_PECA).
 *
 * A corrente da bandeja é CLICÁVEL para puxar (revisão #199): só o dono do
 * ciclo puxa (espectador: clique silencioso, mas a corrente continua
 * visível) e o destaque emissivo reflete o pull vigente. O roteamento passa
 * pelo MESMO despachador do espelho DOM (`despacharCliqueNaPecaDaBandeja`).
 *
 * A cena é projeção idempotente do estado: as Iniciais vêm de `iniciais`, a
 * corrente de `pecaCorrente` (derivada no pai). Nenhuma regra vive aqui.
 */
export function Caixa({
  iniciais,
  pecaCorrente,
  estadoInteracao,
  onComando,
  estadoPeoes = null,
  onPuxar,
}: CaixaProps) {
  // A corrente exibida é puxável? O MESMO mapeador puro do clique decide
  // (inclui gate de espectador); o cursor espelha a clicabilidade na cena.
  const correntePuxavel =
    estadoPeoes !== null && mapearCliqueNaPecaDaBandeja(estadoPeoes) !== null
  // Destaque emissivo: pull vigente na bandeja (mesmo predicado do espelho).
  const puxada =
    pecaCorrente !== null &&
    estadoPeoes !== null &&
    puxadaVigenteNaBandeja(estadoPeoes)

  return (
    <group>
      {/* Caixa fechada e opaca: bloco solido com tampo rotulado (identifica a
          Caixa na mesa), sem nenhum conteudo exposto (decisao 2, #143). */}
      <group position={[POSICAO_CAIXA[0], POSICAO_CAIXA[1], POSICAO_CAIXA[2]]}>
        <mesh position={[0, CAIXA_ALTURA / 2, 0]}>
          <boxGeometry args={[CAIXA_LARGURA, CAIXA_ALTURA, CAIXA_PROFUNDIDADE]} />
          <meshStandardMaterial color="#241a12" />
        </mesh>
        <mesh position={[0, CAIXA_ALTURA + 0.02, 0]}>
          <boxGeometry args={[CAIXA_LARGURA * 0.92, 0.04, CAIXA_PROFUNDIDADE * 0.92]} />
          <meshStandardMaterial color="#3b2c1c" />
        </mesh>
      </group>

      {/* Bandeja de slot único com a peça sorteada corrente (some sem
          corrente). Clicável para puxar: destaque emissivo reflete o pull
          vigente (padrão `destacada` do placeholder). */}
      <group position={[POSICAO_BANDEJA[0], POSICAO_BANDEJA[1], POSICAO_BANDEJA[2]]}>
        <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BANDEJA_LARGURA, BANDEJA_PROFUNDIDADE]} />
          <meshStandardMaterial color="#1f1a18" transparent opacity={0.9} />
        </mesh>
        {pecaCorrente ? (
          <PecaPlaceholder
            tipo={pecaCorrente.tipo}
            orientacao={pecaCorrente.orientacao}
            position={[0, 0.02, 0]}
            destacada={puxada}
            cursor={correntePuxavel ? 'pointer' : 'default'}
            onClick={
              onPuxar
                ? () => {
                    // Clique na corrente → puxar (mesmo despachador do espelho
                    // DOM; gate de espectador no roteador, silencioso).
                    despacharCliqueNaPecaDaBandeja(estadoPeoes, {
                      onPuxar,
                    })
                  }
                : undefined
            }
          />
        ) : null}
      </group>

      {/* Peças Iniciais na frente da bandeja, em grade 2×2, clicáveis (ST-09). */}
      <group position={[POSICAO_INICIAIS[0], POSICAO_INICIAIS[1], POSICAO_INICIAIS[2]]}>
        {iniciais.map((peca, indice) => {
          const [lx, , lz] = inicialIndiceParaLocal(indice)
          const destacada = estadoInteracao.pecaSelecionadaId === peca.pecaId
          return (
            <PecaPlaceholder
              key={peca.pecaId}
              tipo={peca.tipo}
              orientacao={peca.orientacao}
              position={[lx, 0.02, lz]}
              destacada={destacada}
              cursor="pointer"
              onClick={() => {
                // Clique em Inicial na mesa → SELECIONAR_PECA (roteador puro,
                // compartilhado com o espelho DOM; silencioso com pendências).
                onComando(
                  mapearCliqueNaPecaDaMesa(estadoPeoes, estadoInteracao, peca.pecaId),
                )
              }}
            />
          )
        })}
      </group>
    </group>
  )
}
