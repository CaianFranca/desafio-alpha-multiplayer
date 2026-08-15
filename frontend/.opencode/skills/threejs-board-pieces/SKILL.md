---
name: threejs-board-pieces
description: "Renderiza e manipula peças do tabuleiro 3D em Three.js (Flicker of Sanity): escolha de representação (BoxGeometry/primitivas/InstancedMesh), criação e sincronização de meshes com o estado autoritativo do jogo, posicionamento em casas, animação de movimento, seleção via raycast, destaque e interação (clique, hover, drag). Use ao trabalhar com peças/peões do tabuleiro em frontend/web/src/game ou components: renderizar, sincronizar com o estado do jogo, ou interagir com peças."
---

# Peças do Tabuleiro — Three.js

## Propósito

Renderizar e manipular as peças do tabuleiro na cena
Three.js do frontend. A cena é um espelho visual do estado do jogo, nunca a
fonte das regras.

## Regra autoritativa

O estado do tabuleiro — posição, ocupação, dono, turno — é discreto e
autoritativo e vive fora da cena (estado do cliente / `packages/engine`). A
cena Three.js é uma projeção desse estado; nada nela define regra, colisão,
identidade ou sincronização multiplayer. Estratégia sugerida em
`docs/research/marching-cubes-3d-board-games.md`: casas e peças com
`BoxGeometry`/primitivas + `InstancedMesh`; Marching Cubes somente para
efeitos orgânicos ou volumétricos (poças, slime, portais), nunca para peças.

## Passos

### 1. Inspecionar o ambiente

Identifique onde vive o estado autoritativo, onde a cena é montada
(`frontend/web/src/game`, `components`), o loop de render e a versão do
Three.js no `package.json`.

**Critério de conclusão:** o fluxo estado → cena atual e a versão do Three.js
estão mapeados.

### 2. Verificar a API no Context7

Antes de usar API de Three.js (`InstancedMesh`, `Raycaster`, `Matrix4`,
`Object3D`) ou React, consulte as docs oficiais no Context7 informando a lib e
versão, conforme `frontend/AGENTS.md`.

**Critério de conclusão:** toda assinatura usada foi conferida contra a
versão instalada.

### 3. Definir o contrato peça ↔ cena

Cada peça do estado tem um objeto visual correspondente, ligado por id (ex.:
`mesh.userData.id`). Para cada campo do estado que muda (casa, visibilidade,
dono), existe um ponto de atualização na cena.

**Critério de conclusão:** nenhum campo visual do estado fica sem ponto de
atualização.

### 4. Escolher a representação

- Muitas peças com mesma geometria e material: `InstancedMesh` (cada instância
  via `composeMatrix`/`setMatrixAt` + `instanceMatrix.needsUpdate = true`).
- Peças únicas, poucas ou com formatos distintos: `Mesh`/`Group` com
  primitivas ou asset 3D.
- A posição de cena é sempre derivada da casa, nunca armazenada no mesh.

**Critério de conclusão:** peças idênticas compartilham instancing; nenhuma
peça usa mesh de Marching Cubes.

### 5. Reconciliação visual

Um sistema/componente recebe o estado e aplica à cena de forma idempotente:
peça nova → cria; removida → descarta (remove do instancing, `dispose` de
geometria/material); casa alterada → atualiza transform. Aplicar o mesmo
estado duas vezes produz a mesma cena.

**Critério de conclusão:** a segunda aplicação do mesmo estado não duplica
nem deixa peças órfãs.

### 6. Interação (raycast, destaque)

`Raycaster` do pointer sobre os meshes → id da peça → estado. O destaque da
seleção (emissivo, outline ou marcador) muda apenas o visual, nunca o estado.

**Critério de conclusão:** hover/clique retornam o id correto, inclusive com
instancing.

### 7. Animar movimento

Transições entre casas são visuais e rodam no loop com easing; o destino vem
do estado. Estado mudando no meio da animação prevalece.

**Critério de conclusão:** no fim da animação a peça está exatamente na casa;
mudança de estado mid-flight é respeitada sem posição "lembrada".

### 8. Verificar

Build/typecheck sem erro; cena com múltiplas peças instanciadas renderiza
todas; interação real (clique seleciona o id certo); reconciliação sem
duplicatas; console sem erros.

**Critério de conclusão:** os cinco checks passam; qualquer falha é corrigida
antes de terminar.

## Fora de escopo

Regras de movimento, legalidade, ocupação, colisão, identidade e
sincronização multiplayer pertencem ao estado autoritativo (engine/backend),
não à cena Three.js.
