---
name: threejs-board-pieces
description: "Implementa pecas de tabuleiro em Three.js: criar e sincronizar visuais, converter casas para coordenadas 3D, animar movimentos, selecionar por raycast ou destacar pecas. Use para o renderer do tabuleiro em frontend/web/src/game ou components."
---

# Three.js Board Pieces

## Processo

Trate a cena como uma projecao do estado autoritativo. Mantenha regras,
ocupacao, identidade e turno no estado do cliente, engine ou servidor; a cena
apenas exibe.

### 1. Inspecionar

Localize o `package.json` real, o estado de jogo, a montagem da cena, o loop e
o ponto de entrada React. Confirme os caminhos no repositorio antes de editar.
Se ainda houver apenas esqueleto, defina o menor seam necessario sem inventar
scripts ou dependencias.

**Concluido quando:** o fluxo estado -> cena e o comando de verificacao existente
estao identificados, ou a ausencia deles esta registrada.

### 2. Definir o contrato

Use o id da peca como identidade do visual. O contrato minimo precisa expor id,
tipo, casa, dono e visibilidade, adaptado ao estado real do projeto. Mantenha
um `Map` de views para pecas individuais ou um mapa de `instanceId` para
`InstancedMesh`.

**Concluido quando:** cada campo visual mutavel tem uma origem no estado e um
ponto de atualizacao na cena.

### 3. Escolher a representacao

Leia `references/piece-rendering.md` ao implementar a representacao visual:
primitivas, `Group`, GLTF, coordenadas casa -> mundo ou `InstancedMesh`. Use
`Mesh`/`Group` por padrao para poucas pecas; use instancing quando a quantidade
e a geometria compartilhada justificarem a complexidade de picking e atualizacao.

**Concluido quando:** a escolha considera quantidade, variedade, picking,
animacao e ownership de geometria/material.

### 4. Reconciliar

Aplique o estado de forma idempotente: peca nova cria uma view, peca existente
atualiza casa/dono/visibilidade e peca removida sai da cena. Derive sempre a
posicao a partir da casa; compartilhe recursos somente quando o ciclo de vida
estiver definido.

**Concluido quando:** aplicar o mesmo estado duas vezes nao duplica views, nao
deixa orfaos e produz a mesma transformacao visual.

### 5. Adicionar branches visuais

Leia `references/piece-interaction.md` ao implementar raycast, hover, selecao,
highlight ou movimento animado. A interacao devolve o id para o estado/UI; a
animacao acompanha o destino recebido e aceita nova autoridade no meio do voo.

**Concluido quando:** cada evento visual retorna a peca correta e o fim da
animacao coincide exatamente com a casa do estado atual.

### 6. Verificar

Consulte a documentacao oficial da versao instalada antes de usar APIs de
Three.js ou React, conforme `frontend/AGENTS.md`. Rode os scripts existentes.
Quando houver app executavel, verifique build/typecheck, renderizacao de varias
pecas, uma interacao real e console limpo. Quando houver apenas esqueleto,
valide o que existe e registre os checks bloqueados sem simular evidencia.

**Concluido quando:** cada check aplicavel tem evidencia e cada check
inaplicavel tem uma razao concreta.
