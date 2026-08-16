---
name: threejs-board-pieces
description: "Use when implementing or debugging Three.js board pieces: authoritative reconciliation, cell/world placement, fit previews, drag and drop, raycast selection, or move animations in frontend/web/src/game or components."
---

# Three.js Board Pieces

## Escopo

Trate a cena como uma projecao do estado autoritativo. Mantenha regras,
ocupacao, identidade e turno no estado do cliente, engine ou servidor; a cena
apenas exibe.

Um `fit check` responde se uma peca pode ocupar uma posicao candidata. Ele pode
produzir preview e intencao de movimento, mas a confirmacao da jogada pertence
ao engine ou servidor.

## Processo

### 1. Inspecionar

Localize o `package.json` real, o estado de jogo, a montagem da cena, o loop e
o ponto de entrada React. Confirme os caminhos no repositorio antes de editar.
Se ainda houver apenas esqueleto, defina o menor seam necessario sem inventar
scripts ou dependencias.

**Concluido quando:** o fluxo estado -> cena e o comando de verificacao existente
estao identificados, ou a ausencia deles esta registrada.

### 2. Definir autoridade e identidade

Use o id da peca como identidade do visual. O contrato minimo precisa expor id,
tipo, casa, dono e visibilidade, adaptado ao estado real do projeto. Mantenha
um `Map` de views para pecas individuais ou um mapa de `instanceId` para
`InstancedMesh`.

Cada campo visual mutavel deve ter uma origem no estado e um ponto de atualizacao
na cena. Estado visual temporario, como hover, selecao e preview de encaixe, fica
fora das regras do jogo.

**Concluido quando:** cada campo visual mutavel e cada estado temporario tem uma
origem, um dono e um ponto de atualizacao definidos.

### 3. Escolher a representacao

Leia `references/piece-rendering.md` ao implementar a representacao visual:
primitivas, `Group`, GLTF, coordenadas casa -> mundo ou `InstancedMesh`. Use
`Mesh`/`Group` por padrao para poucas pecas; use instancing quando a quantidade
e a geometria compartilhada justificarem a complexidade de picking e atualizacao.

**Concluido quando:** a escolha considera quantidade, variedade, picking,
animacao e ownership de geometria/material.

### 4. Definir o encaixe

Quando houver arraste, drop ou a pergunta "posso colocar esta peca aqui?", leia
`references/piece-fitting.md`. Defina uma consulta pura para a posicao candidata,
rotacao, ocupacao e tolerancia. O preview devolve um resultado tipado; o drop
emite uma intencao e nao transforma a cena em autoridade.

**Concluido quando:** uma consulta repetida com os mesmos dados produz o mesmo
resultado, e o caminho preview -> intencao -> confirmacao esta separado.

### 5. Reconciliar

Aplique o estado de forma idempotente: peca nova cria uma view, peca existente
atualiza casa/dono/visibilidade e peca removida sai da cena. Derive sempre a
posicao a partir da casa; compartilhe recursos somente quando o ciclo de vida
estiver definido.

**Concluido quando:** aplicar o mesmo estado duas vezes nao duplica views, nao
deixa orfaos e produz a mesma transformacao visual.

### 6. Adicionar interacao e animacao

Leia `references/piece-interaction.md` ao implementar raycast, hover, selecao,
drag, highlight ou movimento animado. Leia `references/piece-fitting.md` dentro do
branch de arraste e drop. A interacao devolve ids e candidatos para o estado/UI;
a animacao acompanha o destino recebido e aceita nova autoridade no meio do voo.

**Concluido quando:** cada evento visual retorna a peca e o candidato corretos,
o cancelamento limpa o gesto, e o fim da animacao coincide exatamente com a casa
do estado atual.

### 7. Verificar

Consulte a documentacao oficial da versao instalada antes de usar APIs de
Three.js ou React, conforme `frontend/AGENTS.md`. Rode os scripts existentes.
Quando houver app executavel, verifique build/typecheck, renderizacao de varias
pecas, um encaixe valido, um encaixe invalido, uma interacao real e console limpo.
Quando houver apenas esqueleto, valide o que existe e registre os checks
bloqueados sem simular evidencia.

**Concluido quando:** cada check aplicavel tem evidencia e cada check
inaplicavel tem uma razao concreta.
