# Workflow do Projeto

Este é o fluxo para transformar um item priorizado do backlog em uma entrega
revisada.

## Comece aqui

- **PO:** prioriza o item, explica o problema e confirma as decisões de produto.
- **Scrum Master:** conduz a sessão, executa as skills de spec e tickets e
  acompanha os bloqueios.
- **Dev:** avalia a viabilidade, implementa tickets desbloqueados, testa e
  revisa a mudança.

O fluxo é:

```text
backlog priorizado
  -> entrevista
  -> spec e tickets
  -> implementação
  -> code-review
  -> PR e merge
```

O projeto precisa ter GitHub Issues disponível e os participantes precisam ter
acesso ao repositório. Consulte [SETUP.md](SETUP.md) para detalhes de ambiente.

## Papéis

| Papel | Responsabilidade |
| --- | --- |
| **PO** | Define prioridade, explica o problema e valida decisões de produto. |
| **Scrum Master** | Conduz o processo, registra decisões, cria spec e tickets e remove bloqueios. |
| **Dev** | Avalia viabilidade, implementa, testa e executa o code-review. |

O Scrum Master não é assignee de ticket de implementação. Tickets de entrega
devem ser assumidos por devs.

## Skills

| Skill | Uso |
| --- | --- |
| `/entrevistar-com-docs` | Entrevistar o grupo e registrar decisões de domínio e arquitetura. |
| `/transformar-em-spec` | Publicar a conversa consolidada como spec no GitHub Issues. |
| `/transformar-em-tickets` | Dividir a spec em tickets e declarar bloqueios. |
| `/implement` | Planejar e executar um ticket em sua própria branch. |
| `/code-review` | Revisar a mudança nos eixos Standards e Spec. |
| `/triagem` | Organizar bugs e pedidos que chegam fora do fluxo. |

A entrevista, a spec e os tickets pertencem à mesma seção. Não limpe o
contexto entre essas etapas.

## Fluxo

### 1. Priorizar o item

O PO define a prioridade. O Scrum Master confirma que o objetivo está claro,
reúne as pessoas necessárias e trata um item por vez.

### 2. Conduzir a entrevista

O Scrum Master abre uma única sessão e conduz o grupo. O PO valida decisões de
produto; os devs apontam riscos, alternativas e restrições.

Consulte o [roteiro da entrevista](GRILLING-SESSION.md).

### 3. Publicar spec e tickets

Depois da entrevista, o Scrum Master executa, na mesma seção:

1. `/transformar-em-spec`
2. `/transformar-em-tickets`

Não há aprovação final separada. A confirmação do PO durante a entrevista
valida as decisões que serão publicadas.

A seção só termina quando spec e tickets forem publicados ou quando uma falha
for registrada com uma pendência explícita.

### 4. Organizar os bloqueios

Cada ticket declara quais tickets o bloqueiam. O dev começa por um ticket sem
bloqueadores abertos e informa bloqueios ao Scrum Master. Não crie tickets
improvisados para contornar dependências.

### 5. Implementar um ticket

Cada ticket usa uma branch própria e segue `/implement`:

1. Leia o ticket, a spec, os ADRs e o `AGENTS.md` da área.
2. Execute `/implement` em modo de planejamento. O repasse fica em
   `.scratch/repasse/` e não altera o código.
3. Em uma nova seção, execute `/implement` juntamente com o caminho do arquivo do repasse `/implement .scratch/repasse/repasse2026..`.
4. Sincronize a branch e confirme que ela é `feature/...`.
5. Implemente e adicione os testes necessários.
6. Rode typechecking, testes relevantes e a suíte completa ao final.

Consulte também o `AGENTS.md` da área alterada:

- [Frontend](frontend/AGENTS.md)
- [Backend](backend/AGENTS.md)
- [Infra](infra/AGENTS.md)
- [Banco de dados](db/AGENTS.md)

TDD não é obrigatório. A referência é o ticket, a spec, as decisões da
entrevista e o comportamento observável.

### 6. Revisar e entregar

Antes do commit e do merge, execute `/code-review` usando como ponto fixo o
estado da branch antes da implementação.

- **Standards:** a mudança segue as convenções do repositório?
- **Spec:** a mudança implementa o ticket e a spec?

Resolva os achados, commite na branch e abra ou atualize a PR. Ao terminar,
abra uma nova seção limpa para o próximo ticket.

## Regras de organização

- **Fundação primeiro:** o primeiro bloco prepara scaffold, serviços, CI e
  convenções e desbloqueia o restante do time.
- **Um ticket, uma área:** não misture frontend, backend, banco e proxy no
  mesmo ticket.
- **Contrato separado:** OpenAPI deve ser um ticket próprio para permitir
  trabalho paralelo. Migrations pertencem ao ticket do backend ou do fluxo de
  dados que as exige.
- **Branch e PR:** cada ticket tem branch própria, PR própria e code-review
  antes do merge.
- **Bloqueios reais:** um ticket só entra na fronteira de trabalho quando seus
  bloqueadores estiverem fechados.

```text
[fundação]
    |
    v
[contrato OpenAPI] ----> [tela frontend]
       |
       +---------------> [endpoint backend]
```

Bugs e pedidos fora do fluxo passam por `/triagem`.

## Encerramento da sessão

Confirme que:

- o problema e o objetivo foram entendidos;
- o PO confirmou as decisões de produto;
- os devs apontaram restrições técnicas relevantes;
- as decisões essenciais foram resolvidas;
- a spec e os tickets foram publicados;
- os bloqueios foram registrados;
- qualquer falha de publicação ficou explícita.

Depois, encerre a seção e abra outra limpa para o próximo item.
