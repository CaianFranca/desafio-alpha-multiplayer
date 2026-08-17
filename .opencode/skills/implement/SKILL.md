---
name: implement
description: Planeja uma implementação e, após aprovação explícita, delega a execução a um subagente.
disable-model-invocation: true
---

# Implementação em duas fases

Use esta skill para transformar uma issue, spec ou ticket em uma mudança
executável. O plano fica somente no contexto da sessão e é enviado diretamente
ao subagente executor após a aprovação humana.

## Fase 1: planejar

1. Leia a issue, a spec, os ADRs, o `CONTEXT.md` e o `AGENTS.md` aplicável.
2. Explore o repositório para confirmar o estado atual e os pontos de impacto.
3. Valide bloqueios, área responsável, critérios de aceitação e comandos de
   validação.
4. Não edite código, não crie branches e não execute operações Git mutáveis.
5. Apresente exatamente um `Plano de Implementação` com esta estrutura:

```markdown
# Plano de Implementação

**Status:** aguardando aprovação

## Issue
- Principal: #123 Título da issue
- Relacionadas: nenhuma

## Objetivo

## Escopo
- Incluído:
- Fora do escopo:

## Decisões e Limites

## Estado Atual
- Arquivos e módulos relevantes:
- Comportamento existente:

## Execução
1. Passo concreto.
2. Passo concreto.

## Verificação
- Critério de aceitação:
- Comando ou teste:
- Evidência esperada:

## Riscos e Bloqueios

## Critérios de Conclusão
```

6. Pergunte de forma inequívoca: `Aprova este plano para execução?`
7. Se faltar uma decisão essencial, pare e pergunte antes de pedir aprovação.

## Fase 2: executar

Só entre nesta fase depois de uma aprovação explícita do plano completo.

1. Use o `task` para iniciar exatamente um subagente `executor`.
2. Envie no prompt o plano completo, a confirmação da aprovação e o diretório
   de trabalho atual. Não envie um caminho para arquivo intermediário.
3. O agente principal não implementa a mudança depois da delegação; aguarda o
   relatório do executor.
4. Se o executor encontrar uma contradição ou bloqueio, interrompa a execução e
   devolva a pergunta ao usuário sem reinterpretar o escopo.
5. Ao concluir, apresente o relatório recebido com branch, commit, validações,
   code-review e limitações. A criação da PR continua pertencendo ao `criar-pr`.

## Regras

- Não use `.scratch/` para transportar o plano.
- Uma alteração no plano depois da aprovação exige novo plano e nova aprovação.
- O plano deve referenciar artefatos existentes, sem copiar specs inteiras.
- Pendências de escopo, comportamento, contrato ou arquitetura bloqueiam a
  delegação.
