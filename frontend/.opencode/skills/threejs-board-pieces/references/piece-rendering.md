# Piece Rendering

Leia esta referencia ao escolher ou implementar a representacao visual de uma
peca. Confirme as assinaturas da versao instalada no Context7 antes de copiar
uma API de Three.js.

## Contrato visual

Adapte o tipo ao estado real; estes campos sao apenas o minimo visual:

```ts
type PieceState = {
  id: string
  kind: string
  cell: { x: number; y: number }
  owner: string
  visible: boolean
}
```

O `id` vive em `userData.pieceId` para views individuais. Para instancing,
mantenha `instanceId -> pieceId` fora da geometria.

## Cell-to-world

Defina uma unica funcao para a convencao do tabuleiro. O exemplo usa X/Z para
a superficie e Y como altura:

```ts
function cellToWorld(cell: Cell, tileSize: number, origin: Vector3) {
  return new Vector3(
    origin.x + (cell.x + 0.5) * tileSize,
    origin.y,
    origin.z + (cell.y + 0.5) * tileSize,
  )
}
```

Confirme origem, eixo, centro da casa, escala e orientacao do tabuleiro antes
de posicionar pecas. A funcao deve ser pura e compartilhada pela peca e pelo
marcador de selecao.

## Mesh ou Group

Use `Group` quando uma peca tiver corpo, base e adornos. Crie geometrias e
materiais compartilhados por tipo/tema quando suas propriedades forem iguais;
o `Group` individual recebe somente transformacao e identidade.

```ts
function createPieceView(state: PieceState, resources: Resources) {
  const view = new Group()
  view.userData.pieceId = state.id
  view.add(new Mesh(resources.bodyGeometry, resources.materialFor(state.owner)))
  return view
}
```

Na reconciliacao, copie `cellToWorld(state.cell, ...)` para `view.position` e
aplique visibilidade, orientacao e aparencia do dono. O estado continua sendo
a fonte da casa.

## GLTF

Use GLTF quando a peca vier de asset. Carregue o asset fora da reconciliacao,
clone a cena para cada peca e normalize escala, origem e orientacao em uma
factory. Para modelos com esqueleto, use a estrategia de clone indicada pela
documentacao da versao instalada. A factory devolve uma view pronta; o loop de
estado nao conhece o loader.

## InstancedMesh

Use instancing quando muitas pecas compartilharem geometria e material. Agrupe
por combinacao que realmente compartilha esses recursos, atribua um slot estavel
por id e, em cada reconciliacao:

1. componha a matriz a partir da casa;
2. chame `setMatrixAt(slot, matrix)`;
3. marque `instanceMatrix.needsUpdate = true`;
4. mantenha o mapa de slot para id atualizado quando pecas entram ou saem.

Instancing exige uma estrategia explicita para slots livres, visibilidade,
aparencia por dono e picking. Um `Mesh` separado para marcador de selecao e
frequentemente mais simples que tentar alterar material de uma instancia.

## Ownership

Cada view deve ter um dono claro para geometria, material, textura e loader.
Dispose recursos que a view possui quando ela sai; recursos compartilhados sao
liberados somente quando o cache/factory deixa de usa-los. Remover um `Group` da
cena, sozinho, nao libera GPU.
