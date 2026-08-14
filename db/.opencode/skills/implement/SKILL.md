---
name: implement
description: "Implementa um trabalho a partir de um pedido, spec, tickets ou documento de repasse."
disable-model-invocation: true
---

Implemente o trabalho descrito pelo usuário: um pedido, uma spec, tickets ou um documento de repasse.

O fluxo acontece em duas fases, cada uma em sua própria sessão:

1. **Planejamento**: `/implement <pedido|spec|tickets>` explora o repositório, carrega a skill `repasse`, gera um brief compacto em `.scratch/repasse/` e encerra sem tocar no código.
2. **Execução**: numa sessão nova (janela de contexto vazia), `/implement <caminho-do-repasse>.md` lê o brief e executa.

## Modo planejamento

Entrada é um pedido, spec ou tickets — não um repasse:

1. Explore o repositório e leia os artefatos relevantes (spec, tickets, `CONTEXT.md`, ADRs). Não altere código.
2. Pergunte ao usuário apenas se faltar uma decisão essencial para escrever um plano coerente.
3. Carregue a skill `repasse` (via ferramenta de skills) com o plano como contexto da conversa. Ela grava o brief e devolve o caminho.
4. Pare imediatamente. Informe o caminho completo e oriente o usuário:
   - abrir uma nova seção com `/new`;
   - executar `/implement <caminho-completo>` nessa seção vazia.

## Modo execução

Entrada é um caminho de arquivo `.md`:

1. Valide o arquivo: existe, é `.md`, está dentro do workspace atual e é um repasse (em `.scratch/repasse/` ou com a estrutura de repasse). Se não for um repasse, trate como entrada do modo planejamento.
2. Leia o brief por completo.
3. Confira a consistência com o estado atual do repositório: adapte caminhos e detalhes mecânicos. Se houver pendência bloqueadora, contradição ou mudança de escopo/comportamento, pergunte antes de editar.
4. Implemente diretamente, sem TDD. Escreva testes quando o usuário pedir ou quando forem necessários para validar a mudança.
5. Rode typechecking regularmente, os arquivos de teste relevantes durante o trabalho e a suíte completa uma vez ao final.
6. Use `/code-review` ao final, com o estado da branch antes da implementação como ponto fixo; o repasse é a fonte do eixo Spec.
7. Commite o trabalho na branch atual.
8. Mantenha o arquivo de repasse: ele é local (`.scratch/` está no `.gitignore`) e não vai ao remoto. Em falha, ele permanece para retomada.
