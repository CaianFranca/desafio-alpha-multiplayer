---
name: transformar-em-spec
description: Transforma a conversa atual em uma spec em português brasileiro e a publica no rastreador de issues do projeto — sem entrevista, apenas síntese do que já foi discutido.
disable-model-invocation: true
---

Esta skill usa o contexto da conversa atual e o entendimento da base de código para produzir uma spec. Não entreviste o usuário: sintetize apenas o que já foi discutido.

## Regra principal de idioma

Escreva todo o conteúdo produzido em português brasileiro, incluindo título, seções, histórias de usuário, decisões, critérios, notas e o corpo publicado no rastreador. Preserve em seu idioma original apenas identificadores que precisam ser exatos, como nomes de comandos, labels, nomes próprios, símbolos de código e contratos externos.

## Processo

1. Explore o repositório para entender o estado atual da base de código, caso ainda não tenha feito isso. Use na spec o vocabulário do glossário de domínio do projeto e respeite os ADRs da área alterada.

2. Esboce os seams nos quais a funcionalidade será testada. Prefira seams existentes a novos seams. Use o seam mais alto possível. Se novos seams forem necessários, proponha-os no ponto mais alto possível. Quanto menos seams houver na base de código, melhor: o número ideal é um.

Confirme com o usuário se esses seams correspondem às expectativas dele.

3. Escreva a spec usando o template abaixo e publique-a no rastreador de issues do projeto. Aplique a label de triagem `ready-for-agent`; não é necessária triagem adicional.

<spec-template>

## Declaração do problema

O problema enfrentado pelo usuário, descrito da perspectiva dele.

## Solução

A solução para o problema, descrita da perspectiva do usuário.

## Histórias de usuário

Uma lista LONGA e numerada de histórias de usuário. Cada história deve seguir o formato:

1. Como <ator>, quero <funcionalidade>, para que <benefício>

<user-story-example>
1. Como cliente de um banco digital, quero ver o saldo das minhas contas, para que eu possa tomar decisões mais conscientes sobre meus gastos
</user-story-example>

Essa lista deve ser bastante abrangente e cobrir todos os aspectos da funcionalidade.

## Decisões de implementação

Uma lista das decisões de implementação tomadas. Ela pode incluir:

- Os módulos que serão criados ou modificados
- As interfaces desses módulos que serão modificadas
- Esclarecimentos técnicos feitos pelo desenvolvedor
- Decisões arquiteturais
- Alterações de schema
- Contratos de API
- Interações específicas

Não inclua caminhos específicos de arquivos nem trechos de código. Eles podem ficar desatualizados rapidamente.

Exceção: se um protótipo produziu um trecho que codifica uma decisão com mais precisão do que a prosa (máquina de estados, reducer, schema ou formato de tipo), inclua-o na decisão relevante e registre brevemente que ele veio de um protótipo. Recorte apenas as partes que expressam decisões; não inclua uma demonstração funcional.

## Decisões de testes

Uma lista das decisões de testes tomadas. Inclua:

- Uma descrição do que caracteriza um bom teste: testar apenas comportamento externo, não detalhes de implementação
- Quais módulos serão testados
- Referências de testes existentes, como testes semelhantes na base de código

## Fora do escopo

Uma descrição do que está fora do escopo desta spec.

## Observações adicionais

Quaisquer outras observações sobre a funcionalidade.

</spec-template>
