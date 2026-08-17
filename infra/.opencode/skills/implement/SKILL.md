---
name: implement
description: "Planeja um trabalho a partir de um pedido, spec ou tickets e gera um documento de repasse."
disable-model-invocation: true
---

Planeje o trabalho descrito pelo usuário: um pedido, uma spec ou tickets.

O fluxo acontece em duas fases, cada uma em sua própria sessão e com uma entrada explícita:

1. **Planejamento**: `/implement <pedido|spec|tickets>` explora o repositório, carrega a skill `repasse`, gera um brief compacto em `.scratch/repasse/` e encerra sem tocar no código.
2. **Execução**: numa sessão nova, `/implement-exec <caminho-do-repasse>.md` delega a leitura e a execução ao subagente `implement-dev`.

Se o usuário fornecer apenas um caminho de repasse durante o planejamento, não execute o trabalho. Oriente o uso de `/implement-exec <caminho-completo>`.

## Modo planejamento

Entrada é um pedido, spec ou tickets — não um repasse:

1. Explore o repositório e leia os artefatos relevantes (spec, tickets, `CONTEXT.md`, ADRs). Não altere código.
2. Pergunte ao usuário apenas se faltar uma decisão essencial para escrever um plano coerente.
3. Carregue a skill `repasse` (via ferramenta de skills) com o plano como contexto da conversa. Ela grava o brief e devolve o caminho.
4. Pare imediatamente. Informe o caminho completo e oriente o usuário:
   - abrir uma nova seção com `/new`;
   - executar `/implement-exec <caminho-completo>` nessa seção vazia.
