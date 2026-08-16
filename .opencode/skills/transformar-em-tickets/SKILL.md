---
name: transformar-em-tickets
description: Quebra um plano, spec ou a conversa atual em tickets tracer-bullet em português brasileiro, cada um declarando suas arestas de bloqueio, publicados no rastreador configurado.
disable-model-invocation: true
---

# Transformar em tickets

Quebre um plano, uma spec ou uma conversa em um conjunto de **tickets** — fatias verticais tracer-bullet, cada uma declarando os tickets que a **bloqueiam**.

## Regra principal de idioma

Escreva todo o conteúdo produzido em português brasileiro, incluindo títulos, descrições, critérios de aceitação, perguntas de validação, nomes de seções e templates dos tickets. Preserve em seu idioma original apenas identificadores que precisam ser exatos, como nomes de comandos, labels, nomes próprios, símbolos de código e contratos externos.

O rastreador de issues e o vocabulário das labels de triagem devem ter sido fornecidos — execute `/setup-matt-pocock-skills` se não tiver essas informações.

## Processo

### 1. Reunir contexto

Trabalhe com o que já estiver no contexto da conversa. Se o usuário passar uma referência como argumento (caminho de spec, número ou URL de issue), busque-a e leia o corpo completo e os comentários.

### 2. Explorar a base de código (opcional)

Se ainda não explorou a base de código, faça isso para entender o estado atual. Os títulos e as descrições dos tickets devem usar o vocabulário do glossário de domínio do projeto e respeitar os ADRs da área alterada.

Procure oportunidades de refatorar antes para facilitar a implementação. Primeiro torne a mudança fácil; depois faça a mudança fácil.

### 3. Esboçar fatias verticais

Divida o trabalho em tickets **tracer-bullet**.

<vertical-slice-rules>

- Cada fatia percorre um caminho estreito, mas COMPLETO, por todas as camadas (schema, API, UI e testes): é vertical, não uma fatia horizontal de uma única camada
- Uma fatia concluída pode ser demonstrada ou verificada por conta própria
- Cada fatia deve caber em uma única janela de contexto nova
- Qualquer refatoração preparatória deve ser feita primeiro

</vertical-slice-rules>

Dê a cada ticket suas **arestas de bloqueio**: os outros tickets que precisam ser concluídos antes que ele possa começar. Um ticket sem bloqueadores pode começar imediatamente.

**Refatorações amplas são a exceção à divisão vertical.** Uma **refatoração ampla** é uma mudança mecânica — renomear uma coluna ou alterar o tipo de um símbolo compartilhado — cujo **raio de impacto** alcança a base inteira, fazendo uma única edição quebrar milhares de pontos de chamada de uma vez e impedindo que qualquer fatia vertical permaneça verde. Não a force em um tracer-bullet; sequencie-a como **expandir–contrair**. Primeiro expanda: adicione a nova forma ao lado da antiga para não quebrar nada. Depois migre os pontos de chamada em lotes dimensionados pelo raio de impacto (por pacote ou diretório), cada lote em seu próprio ticket bloqueado pela expansão, mantendo a CI verde entre lotes porque a forma antiga ainda existe. Por fim, contraia: remova a forma antiga quando não restar nenhum chamador, em um ticket bloqueado por todos os lotes de migração. Quando nem os lotes puderem permanecer verdes sozinhos, mantenha a sequência, mas faça-os compartilhar uma branch de integração que bloqueie um ticket final de integração e verificação: o estado verde só é garantido nesse ticket final.

### 4. Validar com o usuário

Apresente a divisão proposta como uma lista numerada. Para cada ticket, mostre:

- **Título**: nome curto e descritivo
- **Bloqueado por**: quais outros tickets, se houver, precisam ser concluídos primeiro
- **O que entrega**: o comportamento fim a fim que este ticket torna possível

Pergunte ao usuário:

- A granularidade parece adequada? (ampla demais ou detalhada demais)
- As arestas de bloqueio estão corretas? Cada ticket depende apenas de tickets que realmente o impedem de começar?
- Algum ticket deve ser mesclado ou dividido novamente?

Itere até que o usuário aprove a divisão.

### 5. Publicar os tickets no rastreador configurado

Publique os tickets aprovados. **Como** fazer isso depende do rastreador configurado: os tickets são os mesmos nos dois casos; apenas o formato das arestas de bloqueio muda:

- **Arquivos locais** → escreva um arquivo por ticket em `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numerado a partir de `01` na ordem das dependências, com os bloqueadores primeiro. O campo "Bloqueado por" de cada arquivo deve listar os números ou títulos dos tickets dos quais ele depende. Use o template de ticket abaixo: um ticket por arquivo, nunca um único arquivo combinado.
- **Rastreador real de issues (GitHub, Linear etc.)** → delegue a publicação ao **subagente `criar-ticket`**, um subagente por ticket, executados em paralelo. Siga o fluxo do GitHub abaixo, adaptando os nomes se o rastreador for diferente.

Trabalhe na **fronteira**: qualquer ticket cujos bloqueadores tenham sido concluídos. Em uma cadeia puramente linear, isso significa seguir de cima para baixo.

Não feche nem modifique nenhuma issue pai.

### 5a. Publicar pelos subagentes `criar-ticket` (GitHub)

**Fase 1 — criação em paralelo.** Inicie um subagente `criar-ticket` por ticket aprovado, todos em um único lote paralelo. Cada subagente começa com contexto novo; por isso, inclua no prompt o **payload completo** do ticket: título, o que construir, critérios de aceitação, referência à issue pai (se houver) e os tickets que o bloqueiam como referências da divisão (`01`, `02` ou títulos), não números de issues, que ainda não existem. O subagente cria a issue com o corpo definido no `<issue-template>`, aplica a label `ready-for-agent` e retorna o número da issue.

**Fase 2 — conectar as arestas de bloqueio.** Colete todos os números retornados; antes de continuar, tente novamente ou corrija qualquer subagente que tenha falhado. Depois, para cada ticket com bloqueadores:

- Resolva o **id do banco de dados** de cada bloqueador: o `.id` numérico, não o `#number` nem o `node_id`: `gh api repos/<owner>/<repo>/issues/<n> --jq .id`.
- Publique a aresta nativa: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` (consulte `docs/agents/issue-tracker.md`).
- Quando as dependências nativas não estiverem disponíveis, edite o corpo da issue filha para que a linha "Bloqueado por" liste os `#<number>` reais: `gh issue edit <child> --body-file -`.

Somente depois de conectar as arestas os tickets terão identificadores reais; os corpos escritos na fase 1 devem referenciar intencionalmente a divisão, não os números finais.

<local-ticket-template>

# <NN> — <Título do ticket>

**O que construir:** o comportamento fim a fim que este ticket torna possível, da perspectiva do usuário, não uma lista de implementação por camada.

**Bloqueado por:** os números ou títulos dos tickets que bloqueiam este, ou "Nenhum — pode começar imediatamente".

**Status:** pronto para agente

- [ ] Critério de aceitação 1
- [ ] Critério de aceitação 2

</local-ticket-template>

<issue-template>

## Origem

Uma referência à issue pai no rastreador, caso a origem seja uma issue existente. Omita esta seção quando não houver issue pai.

## O que construir

O comportamento fim a fim que este ticket torna possível, da perspectiva do usuário, não uma implementação organizada por camadas.

## Critérios de aceitação

- [ ] Critério 1
- [ ] Critério 2

## Bloqueado por

- Uma referência a cada ticket bloqueador, ou "Nenhum — pode começar imediatamente".

</issue-template>

Em qualquer formato, evite caminhos específicos de arquivos e trechos de código, pois eles envelhecem rapidamente. Exceção: se um protótipo produziu um trecho que codifica uma decisão com mais precisão do que a prosa (máquina de estados, reducer, schema ou formato de tipo), inclua-o e registre brevemente que ele veio de um protótipo. Recorte apenas as partes que expressam decisões; não inclua uma demonstração funcional.
