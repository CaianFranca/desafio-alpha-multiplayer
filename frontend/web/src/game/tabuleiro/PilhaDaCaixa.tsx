import { POSICAO_CAIXA, PILHA_DA_CAIXA } from './contrato'
import { PecaPlaceholder } from './PecaPlaceholder'

/**
 * Pilha da Caixa: 4 peças de caminho em montinho dentro da caixa aberta —
 * a ficção de que as peças vêm da Caixa. Cada peça tem posição, giro Y e
 * inclinação próprios (controle manual total no seam). Puramente visual:
 * sem `onClick` (inerte — o clique cai na Mesa e desseleciona, como antes),
 * fora do wire e fora do espelho DOM.
 */
export function PilhaDaCaixa() {
  return (
    <group
      position={[POSICAO_CAIXA[0], POSICAO_CAIXA[1], POSICAO_CAIXA[2]]}
    >
      {PILHA_DA_CAIXA.map((peca, indice) => (
        <group
          key={`${peca.tipo}-${indice}`}
          position={[peca.posicao[0], peca.posicao[1], peca.posicao[2]]}
          rotation={[peca.inclinacao[0], 0, peca.inclinacao[1]]}
        >
          <PecaPlaceholder
            tipo={peca.tipo}
            orientacao={peca.orientacao}
            cursor="default"
            semRelevoEEmissao
          />
        </group>
      ))}
    </group>
  )
}
