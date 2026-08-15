# Piece Interaction

Leia esta referencia ao implementar raycast, hover, selecao, highlight ou
movimento visual. A interacao produz eventos para o estado/UI; ela nao valida
movimentos nem altera a autoridade do jogo.

## Raycast

Converta o pointer para NDC usando o rect do canvas e use o mesmo camera rig da
cena. Para uma view individual, suba dos filhos atingidos ate o `Object3D` que
carrega `userData.pieceId`:

```ts
const hit = raycaster.intersectObjects(pieceRoots, true)[0]
const id = hit && findPieceRoot(hit.object)?.userData.pieceId
```

Para `InstancedMesh`, leia `intersection.instanceId` e consulte o mapa de slots.
O mapa precisa refletir a reconciliacao corrente antes de emitir o evento.

## Hover e selecao

Mantenha `hoveredId` e `selectedId` fora da regra do jogo. Para uma peca
individual, destaque emissivo ou material derivado. Para instancing, prefira um
marcador/outline separado na casa selecionada; isso evita material por
instancia e deixa a limpeza deterministica.

Ao sair ou trocar de peca, remova o destaque anterior antes de aplicar o novo.
Clique e hover devem emitir ids, nao referencias que o estado nao conhece.

## Movimento

Anime apenas a transformacao visual entre `cellToWorld(previousCell)` e
`cellToWorld(nextCell)`. Guarde o alvo atual da animacao, nao uma casa escondida
no mesh. Um loop simples pode interpolar a posicao atual para o destino com
easing e, ao concluir, copiar exatamente o vetor destino.

Quando chegar estado novo durante a animacao:

1. leia a casa nova como destino autoritativo;
2. use a posicao visual corrente como inicio;
3. substitua o alvo anterior;
4. finalize no vetor derivado da casa nova.

Assim uma atualizacao mid-flight prevalece sem duplicar pecas ou inventar uma
posicao persistida na cena.

## React lifecycle

Crie renderer, scene, camera, listeners e loop dentro de um lifecycle controlado
por `ref`. Reconciliacoes recebem estado novo e reutilizam a cena existente.
Remova listeners, pare o loop e descarte recursos no cleanup do owner do canvas.
Evite criar um renderer ou uma geometria a cada render React.

## Verificacao

Para um app executavel, prove o caminho com pelo menos uma peca individual e,
se usado, um `InstancedMesh`: hover/clique retornam o id correto, movimento
termina na casa derivada e remocao nao deixa view ou listener orfao. Para um
esqueleto sem scripts, valide tipos/helpers disponiveis e registre a interacao
como bloqueada pela ausencia de runtime.
