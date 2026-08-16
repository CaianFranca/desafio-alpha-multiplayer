# Piece Fitting

Use esta referencia ao responder se uma peca pode ocupar uma posicao candidata,
ao criar preview de drop ou ao enviar uma intencao de colocacao.

## Limite

Um `fit check` compara uma peca, uma pose e o estado do tabuleiro. A consulta
deve ser pura: ela nao move a peca autoritativa, nao altera ocupacao e nao
confirma uma jogada. A confirmacao pertence ao engine ou servidor.

## Contrato

Adapte os tipos ao estado real do projeto. O contrato minimo precisa representar
identidade, posicao, orientacao e o resultado da comparacao:

```ts
type PlacementCandidate = {
  pieceId: string
  cell: Cell
  rotation: number
}

type FitResult = {
  valid: boolean
  candidate: PlacementCandidate
  reason?: 'out-of-bounds' | 'occupied' | 'overlap' | 'illegal'
}
```

`reason` explica o preview local. A regra final pode rejeitar a intencao por
motivos que apenas o estado autoritativo conhece.

## Fluxo

1. Intersecte o ponteiro com o plano ou superficie jogavel usando a camera e o
   canvas atuais.
2. Converta a intersecao para a convencao de celulas compartilhada por tabuleiro,
   marcador e peca.
3. Normalize a rotacao para uma orientacao suportada.
4. Derive o footprint ou volume ocupado pela peca nessa pose.
5. Verifique limites, ocupacao e sobreposicao conforme o contrato do jogo.
6. Emita um `FitResult` para o preview sem alterar a autoridade.
7. No drop, emita uma intencao com `pieceId`, celula e rotacao; aguarde a
   confirmacao autoritativa antes de considerar a colocacao concluida.

O preview e a confirmacao devem usar a mesma convencao de coordenadas e o mesmo
footprint. Uma peca invalida permanece na origem visual definida pelo gesto ou
retorna por uma animacao de rejeicao.

## Estrategias

Escolha a representacao mais simples que preserve a regra do tabuleiro:

- Para tabuleiros discretos, precompute o footprint por tipo e rotacao e compare
  celulas ocupadas. Mascaras de bits ajudam quando muitas poses sao consultadas.
- Para formas simples em 3D, use uma fase ampla com `AABB` ou `OBB` e uma fase
  estreita apenas quando houver intersecao candidata.
- Para formas complexas, use uma representacao de ocupacao ou distancia que
  possa ser amostrada com tolerancia definida pelo jogo.

Baseie a legalidade na representacao de ocupacao ou colisao definida pelo
contrato do jogo. Use o mesh renderizado para feedback visual; geometria
detalhada, escala visual, filtros de material e oclusao sao apenas apresentacao.

## Gestos e autoridade

Durante o arraste, mantenha o estado do gesto separado do estado confirmado:

- `draggingId` identifica a peca capturada.
- `candidate` representa a pose sob o ponteiro.
- `preview` representa o ultimo `FitResult` calculado.
- `pending` representa uma intencao aguardando resposta.

Pointer cancel, perda de foco, troca de turno e desconexao encerram o gesto ou
marcam a intencao como pendente conforme o protocolo real. Uma mensagem atrasada
cede a um estado mais novo; use revision, sequencia ou tick quando o protocolo
fornecer esse campo.

## Performance

Mantenha o `fit check` deterministico e sem alocacoes desnecessarias no caminho
de `pointermove`. Cache footprints, orientacoes e dados imutaveis por tipo de
peca. Atualize o preview somente quando a celula, rotacao, estado de ocupacao ou
tolerancia relevante mudar.

## Verificacao

Cubra pelo menos origem, borda, fora do tabuleiro, celula ocupada, rotacao,
tolerancia, peca invalida e peca valida. Verifique tambem que preview nao muda
o estado, drop emite uma unica intencao, rejeicao restaura a view e confirmacao
termina exatamente na pose autoritativa.
